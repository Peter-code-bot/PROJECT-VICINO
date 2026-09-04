"use client";

import { CACHE_INMUTABLE } from "@/lib/storage/cache";
import { useState, useRef } from "react";
import dynamic from "next/dynamic";
import Image from "next/image";
import { CATEGORIES, DELIVERY_OPTIONS } from "@vicino/shared";

const DeliveryMap = dynamic(() => import("@/components/map/delivery-map"), { ssr: false });
const ProductMediaCropper = dynamic(
  () => import("@/components/product/product-media-cropper").then((m) => m.ProductMediaCropper),
  { ssr: false },
);
import { createProduct, updateProductFull } from "./actions";
import { createClient } from "@/lib/supabase/client";
import { hapticMedium } from "@/lib/haptics";
import { Loader2, Store, PackageOpen, CheckCircle2, ImagePlus, X, Search, ChevronDown, Star, ChevronLeft, Play } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { esNavegacionDeNext } from "@/lib/next-navigation-error";
import { generateVideoThumbnail } from "@/lib/video-thumbnail";
import { fileToDataURL } from "@/lib/crop-image";
import * as Sentry from "@sentry/nextjs";
import { toast } from "sonner";
import type { CropResult } from "@/components/product/product-media-cropper";

import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  rectSortingStrategy,
  useSortable
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

type Mode = "create" | "edit";

export interface CategorySelection {
  slug: string;
  is_primary: boolean;
}

export interface ProductInitialValues {
  id: string;
  titulo: string;
  descripcion: string;
  precio: number | null;
  modo_precio?: string | null;
  tipo: "producto" | "servicio";
  // MP#08 #5c-2: editar page lee el pivote y envia el array de 1..3 categorias
  // con la primary marcada. Para productos pre-5c-1 sin filas en el pivote
  // (caso borde improbable post-29ccefe), editar/page.tsx hace fallback a
  // [{slug: product.categoria, is_primary: true}] desde el TEXT.
  categories: CategorySelection[];
  ubicacion?: string | null;
  delivery_radius_km?: number | null;
  /** Coordenadas guardadas, para hidratar el mapa al editar. */
  ubicacion_lat?: number | null;
  ubicacion_lng?: number | null;
  tipo_entrega: string;
  estado?: string | null;
  color?: string | null;
  precio_negociable: boolean;
  allow_appointments: boolean;
  appointment_start_time?: string | null;
  appointment_end_time?: string | null;
  appointment_duration_minutes?: number | null;
  imagen_principal?: string | null;
  galeria_imagenes: string[];
}

interface ProductFormProps {
  userId: string;
  mode?: Mode;
  initialValues?: ProductInitialValues;
  sellerInactive?: boolean;
}

const VIDEO_EXT_RE = /\.(mp4|webm|mov)$/i;
function isVideoUrl(url: string): boolean {
  return VIDEO_EXT_RE.test(url.split("?")[0] ?? "");
}

/** Segundos de un video, leidos del metadata. */
async function duracionDeVideo(file: File): Promise<number> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement("video");
    let listo = false;
    // Si el metadata no llega, NO bloqueamos la subida: es preferible dejar
    // pasar un video raro que impedirle publicar a alguien por un contenedor
    // que el navegador no sabe medir.
    const terminar = (segundos: number) => {
      if (listo) return;
      listo = true;
      clearTimeout(reloj);
      URL.revokeObjectURL(url);
      resolve(segundos);
    };
    const reloj = setTimeout(() => terminar(NaN), 5000);
    v.preload = "metadata";
    v.onloadedmetadata = () => terminar(v.duration);
    v.onerror = () => terminar(NaN);
    v.src = url;
  });
}

/** Postgres devuelve `time` como "HH:MM:SS"; el select usa "HH:MM". */
function toHHMM(t: string | null | undefined, fallback: string): string {
  if (!t) return fallback;
  return t.slice(0, 5);
}

type ExistingMedia = { id: string; kind: "existing"; url: string; isVideo: boolean };
type PendingMedia = { id: string; kind: "pending"; file: File; preview: string; isVideo: boolean; coverPreview?: string; };
type MediaItem = ExistingMedia | PendingMedia;

/** Item queued for cropping before being added to media[] */
type CropQueueItem = { file: File; src: string; isVideo: boolean };

const MAX_VIDEO_SEGUNDOS = 10;

function SortableMediaItem({
  item,
  index,
  onRemove,
}: {
  item: MediaItem;
  index: number;
  onRemove: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 10 : 1,
  };

  const previewSrc = item.kind === "pending" ? item.preview : item.url;
  const hasCoverPreview = item.kind === "pending" && item.coverPreview;

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={cn(
        "relative w-20 h-20 rounded-xl overflow-hidden border group select-none touch-none bg-background",
        isDragging ? "border-primary/50 shadow-lg scale-105" : "border-border/50",
      )}
    >
      {item.isVideo && !hasCoverPreview ? (
        <video src={previewSrc} className="w-full h-full object-cover pointer-events-none" />
      ) : (
        <Image src={hasCoverPreview ? item.coverPreview! : previewSrc} alt={`Preview ${index + 1}`} fill className="object-cover pointer-events-none" />
      )}
      <button
        type="button"
        onPointerDown={(e) => {
          // Evita que el drag and drop se inicie al presionar el botón de eliminar
          e.stopPropagation();
        }}
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/60 flex items-center justify-center opacity-100 transition-opacity z-20 hover:bg-black/80 shadow-sm backdrop-blur-md cursor-pointer"
      >
        <X className="w-3.5 h-3.5 text-white" />
      </button>
      {index === 0 && (
        <span className="absolute bottom-1 left-1 rounded bg-[color:var(--brand)] px-1.5 py-0.5 text-[9px] font-medium text-white z-10 pointer-events-none">
          Portada
        </span>
      )}
      {item.isVideo && (
        <div className="absolute bottom-1 right-1 rounded-sm bg-black/60 p-0.5 pointer-events-none z-10 backdrop-blur-md">
          <Play className="w-3 h-3 text-white fill-white" />
        </div>
      )}
    </div>
  );
}

// El schema exige exactamente una primaria. Cuando desaparece la que lo era
// —al quitarla a mano o al descartarla por cambio de tipo— hay que promover
// otra. Recibe la lista YA filtrada; con lista vacia no hay nada que
// promover y el usuario tendra que elegir.
function ensureOnePrimary(list: CategorySelection[]): CategorySelection[] {
  if (list.length === 0) return list;
  const found = list.findIndex((c) => c.is_primary);
  const primaryIdx = found === -1 ? 0 : found;
  return list.map((c, i) =>
    c.is_primary === (i === primaryIdx) ? c : { ...c, is_primary: i === primaryIdx },
  );
}

// Al cambiar el tipo de publicacion, las categorias del tipo contrario dejan
// de tener sentido. Se descartan esas y se conservan las compatibles: perder
// selecciones validas por un toggle es peor que el bug. Un slug sin meta en
// CATEGORIES tambien cae — el zod del servidor lo rechazaria igual y en los
// chips ni se pinta, asi que arrastrarlo solo produce un error invisible.
function filterCategoriesByTipo(
  list: CategorySelection[],
  tipo: "producto" | "servicio",
): CategorySelection[] {
  return ensureOnePrimary(
    list.filter((sel) => {
      const meta = CATEGORIES.find((c) => c.slug === sel.slug);
      return !!meta && (meta.type === tipo || meta.type === "otro");
    }),
  );
}

export function ProductForm({ userId, mode = "create", initialValues, sellerInactive = false }: ProductFormProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const submittingRef = useRef(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [tipoSeleccionado, setTipoSeleccionado] = useState<"producto" | "servicio">(
    initialValues?.tipo ?? "producto",
  );
  // MP#08 #5c-2: state multi-select (max 3, exactly 1 primary). El validator
  // del servidor enforza la regla via zod; aqui mantenemos las invariantes
  // como UX (bloqueo de submit + ocultar opciones invalidas del dropdown).
  const [categories, setCategories] = useState<CategorySelection[]>(
    initialValues?.categories ?? [],
  );
  const [estado, setEstado] = useState<string>(initialValues?.estado ?? "");
  const [color, setColor] = useState<string>(initialValues?.color ?? "");
  const [categorySearch, setCategorySearch] = useState("");
  const [categoryOpen, setCategoryOpen] = useState(false);
  // lat/lng nacen de lo guardado cuando se edita. Antes arrancaban en 0,0
   // siempre, y por eso el mapa salia en blanco al editar.
  const [locationData, setLocationData] = useState({
    lat: initialValues?.ubicacion_lat ?? 0,
    lng: initialValues?.ubicacion_lng ?? 0,
    address: initialValues?.ubicacion ?? "",
    radius: initialValues?.delivery_radius_km ?? 5,
  });
  const [precioNegociable, setPrecioNegociable] = useState(initialValues?.precio_negociable ?? false);
  const [modoPrecio, setModoPrecio] = useState(initialValues?.modo_precio ?? "precio");
  const [allowAppointments, setAllowAppointments] = useState(initialValues?.allow_appointments ?? false);
  const [apptStart, setApptStart] = useState(
    toHHMM(initialValues?.appointment_start_time, "09:00"),
  );
  const [apptEnd, setApptEnd] = useState(
    toHHMM(initialValues?.appointment_end_time, "18:00"),
  );
  const [apptDuration, setApptDuration] = useState(
    initialValues?.appointment_duration_minutes != null
      ? String(initialValues.appointment_duration_minutes)
      : "60",
  );
  const [media, setMedia] = useState<MediaItem[]>(
    (initialValues?.galeria_imagenes ?? []).map((url) => ({
      id: url,
      kind: "existing" as const,
      url,
      isVideo: isVideoUrl(url),
    })),
  );
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // In-flight thumbnail generations, keyed by source File. The upload path
  // awaits the matching promise before deciding whether to upload a thumb,
  // so a fast submit during background generation no longer silently drops
  // the thumbnail. Resolved promises also stay cached so this is a no-op
  // wait when the work has already finished.
  const pendingThumbsRef = useRef<Map<File, Promise<Blob | null>>>(new Map());

  // Crop queue — files waiting to pass through the cropper modal
  const [cropQueue, setCropQueue] = useState<CropQueueItem[]>([]);
  const [cropIndex, setCropIndex] = useState(0);
  const cropperOpen = cropQueue.length > 0 && cropIndex < cropQueue.length;
  const currentCropItem = cropperOpen ? cropQueue[cropIndex]! : null;

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      setMedia((items) => {
        const oldIndex = items.findIndex((i) => i.id === active.id);
        const newIndex = items.findIndex((i) => i.id === over.id);
        return arrayMove(items, oldIndex, newIndex);
      });
    }
  }

  async function handleImageSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (media.length + files.length > 5) {
      toast.error("Máximo 5 archivos", { duration: 2000 });
      return;
    }
    for (const f of files) {
      const isVid = f.type.startsWith("video/");
      // 50 MB = file_size_limit del bucket product-media (migracion
      // 20260521000010). Si se sube este numero hay que subir el bucket ANTES:
      // al reves, el archivo viaja entero y muere al llegar.
      // Toast y no setError: el banner de error vive al principio del formulario
      // y aqui estamos junto al selector, muy por debajo. En el telefono el
      // vendedor no llegaba a verlo nunca y el archivo parecia no entrar solo.
      if (isVid && f.size > 50 * 1024 * 1024) {
        toast.error(`${f.name} pesa demasiado. El maximo es 50 MB.`, { duration: 2000 });
        return;
      }
      if (isVid) {
        const segundos = await duracionDeVideo(f);
        // Number.isFinite descarta NaN e Infinity de una vez. Un contenedor sin
        // duracion medible pasa; el tope de 50MB sigue siendo el freno duro.
        if (Number.isFinite(segundos) && segundos > MAX_VIDEO_SEGUNDOS) {
          toast.error(
            `Máx. ${MAX_VIDEO_SEGUNDOS} segundos`,
            { duration: 2000 },
          );
          return;
        }
      }
      if (!isVid && f.size > 5 * 1024 * 1024) {
        toast.error(`${f.name} pesa demasiado. El maximo es 5 MB.`, { duration: 2000 });
        return;
      }
    }
    setError("");

    // Build crop queue: convert each file to a previewable src
    const queueItems: CropQueueItem[] = [];
    for (const file of files) {
      const isVid = file.type.startsWith("video/");
      // Images need a data URL for the canvas-based crop;
      // videos use an object URL that react-easy-crop plays inline.
      const src = isVid ? URL.createObjectURL(file) : await fileToDataURL(file);
      queueItems.push({ file, src, isVideo: isVid });
    }
    setCropQueue(queueItems);
    setCropIndex(0);
  }

  /** Called when the user confirms crop on one item in the queue */
  function handleCropResult(result: CropResult) {
    if (result.type === "image") {
      const preview = URL.createObjectURL(result.blob);
      // El discriminante sale del propio object URL, que ya lleva un uuid
      // dentro, en vez de Date.now(). Da lo mismo para la unicidad y ademas
      // quita la llamada impura que el compilador de React marcaba aqui: esta
      // funcion vive en el cuerpo del componente y el compilador no puede
      // demostrar que solo se llama desde un manejador de eventos.
      // Del nombre solo se lee la extension (el split(".").pop() de mas abajo).
      const file = new File([result.blob], `cropped-${preview.slice(-12)}.jpg`, { type: "image/jpeg" });
      setMedia((prev) => [...prev, { id: preview, kind: "pending", file, preview, isVideo: false }]);
    } else {
      // Video: keep the original file, store crop area for thumbnail generation
      const preview = URL.createObjectURL(result.file);
      const coverPreview = result.portada ? URL.createObjectURL(result.portada) : undefined;
      setMedia((prev) => [
        ...prev,
        {
          id: preview,
          kind: "pending",
          file: result.file,
          preview,
          coverPreview,
          isVideo: true,
        },
      ]);
      // Si el vendedor encuadro la portada en el modal, esa es la buena: ya
      // viene recortada 1:1. El generateVideoThumbnail solo queda de respaldo
      // para el camino que no pasa por el encuadre.
      const thumbPromise: Promise<Blob | null> = result.portada
        ? Promise.resolve(result.portada)
        : generateVideoThumbnail(result.file, result.segundoPortada).catch((err) => {
            console.warn("video thumbnail generation failed", result.file.name, err);
            return null;
          });
      pendingThumbsRef.current.set(result.file, thumbPromise);
    }
    advanceCropQueue();
  }

  /**
   * Descartar el archivo actual sin anadirlo a media[]. Es la salida del
   * recortador para imagen, ahora que el recorte 1:1 es obligatorio.
   */
  function handleCropCancel() {
    const item = cropQueue[cropIndex];
    // Solo el video usa object URL; para imagen la src es un data URL y
    // revocarla no aplica.
    if (item?.isVideo) URL.revokeObjectURL(item.src);
    advanceCropQueue();
  }

  function advanceCropQueue() {
    const nextIndex = cropIndex + 1;
    if (nextIndex >= cropQueue.length) {
      // Queue exhausted — clean up
      setCropQueue([]);
      setCropIndex(0);
    } else {
      setCropIndex(nextIndex);
    }
  }

  function removeMedia(index: number) {
    setMedia((prev) => {
      const item = prev[index];
      if (item && item.kind === "pending") {
        URL.revokeObjectURL(item.preview);
        if (item.coverPreview) URL.revokeObjectURL(item.coverPreview);
        pendingThumbsRef.current.delete(item.file);
      }
      // Existing items: the actual Storage cleanup happens server-side AFTER
      // the UPDATE confirms (see updateProductFull). Removing from state here
      // only marks the URL for diff calculation.
      return prev.filter((_, i) => i !== index);
    });
  }

  // Returns the final ordered gallery (existing URLs preserved + new uploads in their place).
  async function uploadMediaAndBuildGallery(): Promise<string[]> {
    if (media.length === 0) return [];
    setUploading(true);
    const supabase = createClient();
    const timestamp = Date.now();
    const finalUrls: string[] = new Array(media.length);
    
    // Preparar tareas síncronamente conservando orden y asignando posiciones
    let pendingIdx = 0;
    const uploadTasks: (() => Promise<void>)[] = [];

    for (let i = 0; i < media.length; i++) {
      const item = media[i]!;
      if (item.kind === "existing") {
        finalUrls[i] = item.url;
        continue;
      }

      const ext = item.file.name.split(".").pop() ?? "jpg";
      const path = `${userId}/${timestamp}-${pendingIdx}.${ext}`;
      const currentPendingIdx = pendingIdx;
      pendingIdx++;
      const itemIndex = i; // capturar el index de este loop

      uploadTasks.push(async () => {
        const { error: uploadErr } = await supabase.storage
          .from("product-media")
          .upload(path, item.file, { cacheControl: CACHE_INMUTABLE });

        if (uploadErr) {
          if (
            uploadErr.status === 401 || uploadErr.status === 403 ||
            uploadErr.statusCode === "401" || uploadErr.statusCode === "403"
          ) {
            throw new Error("Tu sesión expiró. Vuelve a iniciar sesión para subir imágenes.");
          }
          throw new Error(`Error subiendo imagen ${itemIndex + 1}: ${uploadErr.message}`);
        }

        const { data: urlData } = supabase.storage
          .from("product-media")
          .getPublicUrl(path);

        finalUrls[itemIndex] = urlData.publicUrl;

        // Best-effort thumbnail upload for videos. Path mirrors the
        // derivedThumbnailUrl convention in lib/video-thumbnail.ts so the
        // gallery can resolve thumbs without a DB lookup. We await any
        // pending background generation here so a fast submit (before the
        // canvas decode finishes) still ships the thumbnail when it
        // ultimately resolves. A failure (rejection or upload error) is
        // logged but does not abort the product upload — display falls
        // back to <video #t=0.1> for missing thumbs.
        if (item.isVideo) {
          const pending = pendingThumbsRef.current.get(item.file);
          let thumbBlob: Blob | null = null;
          if (pending) {
            // Race the pending generation against an 8s timeout. Canvas decode
            // typically completes in <1s; 4K sources take ~2-3s. 8s is safe
            // margin while bailing on hangs (e.g., WebView legacy Android,
            // corrupted source, codecs that never fire loadeddata/seeked).
            // Since thumbnails are best-effort, blocking submission is worse
            // than skipping the thumb — display falls back to <video #t=0.1>.
            const THUMB_GENERATION_TIMEOUT_MS = 8000;
            try {
              thumbBlob = await Promise.race([
                pending,
                new Promise<never>((_, reject) =>
                  setTimeout(
                    () => reject(new Error("thumbnail generation timed out")),
                    THUMB_GENERATION_TIMEOUT_MS,
                  ),
                ),
              ]);
            } catch (thumbGenErr) {
              // Se sigue sin miniatura a proposito: el video ya se subio y la
              // capa de render cae a <video #t=0.1>. Lo que NO puede pasar es que
              // el fallo desaparezca: sin esto, la miniatura queda en 404 y nadie
              // se entera nunca de que la generacion viene fallando.
              Sentry.captureException(thumbGenErr, {
                tags: { action: "productForm", step: "video_thumbnail" },
                level: "warning",
              });
            }
          }
          if (thumbBlob) {
            const thumbPath = `${userId}/${timestamp}-${currentPendingIdx}_thumb.jpg`;
            const { error: thumbErr } = await supabase.storage
              .from("product-media")
              .upload(thumbPath, thumbBlob, {
                contentType: "image/jpeg",
                cacheControl: CACHE_INMUTABLE,
              });
            if (thumbErr) {
              // Diagnostic only — product upload already succeeded.
              console.warn(`thumbnail upload failed for video ${itemIndex + 1}: ${thumbErr.message}`);
            }
          }
        }
      });
    }

    // NOTA: Con la concurrencia, si una subida falla después de que otras
    // ya completaron, quedarán archivos huérfanos en el bucket.
    // Esto se tolera por ahora.
    
    // Ejecutar máximo 3 tareas a la vez para no saturar conexiones móviles
    const results: Promise<void>[] = [];
    const executing = new Set<Promise<void>>();
    let hasError = false;

    for (const task of uploadTasks) {
      if (hasError) break; // abortar early submission loop
      const p = task().catch((err) => {
        hasError = true;
        setUploading(false); // set to false on error fast path
        throw err;
      });
      results.push(p);
      const e = p.catch(() => {}).finally(() => executing.delete(e));
      executing.add(e);
      if (executing.size >= 3) {
        await Promise.race(executing);
      }
    }
    await Promise.all(results);

    setUploading(false);
    return finalUrls;
  }

  function validarAntesDeEnviar(): string | null {
    if (mode === "create" && locationData.lat === 0 && locationData.lng === 0) {
      return "Selecciona una ubicación en el mapa para tu publicación";
    }
    // MP#08 #5c-2: validacion cliente del array de categorias. El zod del
    // servidor enforza la misma regla; este check ahorra un round-trip y
    // muestra el error en linea sin tocar la red.
    if (categories.length === 0) {
      return "Selecciona al menos una categoría";
    }
    if (categories.filter((c) => c.is_primary).length !== 1) {
      return "Marca exactamente una categoría como principal";
    }
    // La ventana de disponibilidad tiene que dar para al menos una cita.
    // Sin esto se guarda un rango invalido (ej. 12:00 a.m. a 12:00 a.m.) y
    // el calendario resultante no ofrece ni un horario, sin avisar nada.
    if (allowAppointments) {
      const [startH = 0, startM = 0] = apptStart.split(":").map(Number);
      const [endH = 0, endM = 0] = apptEnd.split(":").map(Number);
      const startMinutes = startH * 60 + startM;
      const endMinutes = endH * 60 + endM;
      if (endMinutes - startMinutes < Number(apptDuration)) {
        return "Tu horario de citas no alcanza para una sola cita. Revisa la hora de inicio, la de fin y la duración.";
      }
    }
    return null;
  }

  async function handleSubmit(formData: FormData) {
    if (submittingRef.current) return;

    // A4 sub-fase 4.1 (codex follow-up): haptic Medium DESPUES de validar
    // ambos checks (count + primary). Asi no suena en envio fallido.
    void hapticMedium();
    submittingRef.current = true;
    setError("");
    try {
      const finalUrls = await uploadMediaAndBuildGallery();
      formData.set("imagen_principal", finalUrls[0] ?? "");
      formData.set("galeria_imagenes", JSON.stringify(finalUrls));

      if (mode === "edit" && initialValues) {
        // Compute removed URLs = initial gallery minus surviving existing URLs.
        // Pending uploads don't count (they had no DB presence).
        const originalUrls = initialValues.galeria_imagenes ?? [];
        const survivingExistingUrls = media
          .filter((m): m is ExistingMedia => m.kind === "existing")
          .map((m) => m.url);
        const removedUrls = originalUrls.filter((u) => !survivingExistingUrls.includes(u));
        formData.set("removed_urls", JSON.stringify(removedUrls));

        const result = await updateProductFull(initialValues.id, formData);
        if (result?.error) {
          setError(result.error);
          setLoading(false);
          submittingRef.current = false;
        }
        // success: updateProductFull redirects to /seller/listings
      } else {
        const result = await createProduct(formData);
        if (result?.error) {
          setError(result.error);
          setLoading(false);
          submittingRef.current = false;
        }
      }
    } catch (err) {
      if (esNavegacionDeNext(err)) throw err;
      setError(err instanceof Error ? err.message : "Error al subir imágenes");
      setLoading(false);
      submittingRef.current = false;
    }
  }

  const isEdit = mode === "edit";

  return (
    <>
      <div className="mb-6 flex items-center gap-3">
        <Link
          href={isEdit ? "/seller/listings" : "/"}
          className="w-9 h-9 rounded-xl bg-[color:var(--bg-elev-2)] flex items-center justify-center shrink-0 transition-colors hover:bg-[color:var(--card-2)]"
          aria-label={isEdit ? "Volver a mis publicaciones" : "Volver al inicio"}
        >
          <ChevronLeft className="w-5 h-5" />
        </Link>
        <h1 className="flex-1 font-heading text-xl font-bold text-[color:var(--fg)]">
          {isEdit ? "Editar publicación" : "Publicar producto"}
        </h1>
        <button
          type="button"
          onClick={() => {
            const form = formRef.current;
            if (!form) return;
            if (!form.reportValidity()) return;
            const err = validarAntesDeEnviar();
            if (err) {
              setError(err);
              return;
            }
            setError("");
            setLoading(true);
            form.requestSubmit();
          }}
          disabled={loading || uploading}
          className="min-w-[8rem] justify-center shrink-0 inline-flex items-center gap-2 rounded-full bg-[color:var(--brand)] px-4 py-2 text-sm font-semibold text-white transition-all hover:bg-[color:var(--brand-dark)] active:scale-[0.97] disabled:pointer-events-none disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-[color:var(--brand-tint-strong)]"
        >
          {loading || uploading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              {isEdit ? "Guardando…" : "Publicando…"}
            </>
          ) : isEdit ? (
            "Guardar"
          ) : (
            "Publicar"
          )}
        </button>
      </div>

      {sellerInactive && (
        <div className="mb-8 animate-scale-in rounded-2xl bg-[rgba(212,168,83,0.18)] p-5 text-sm text-[color:var(--fg)] shadow-[inset_0_0_0_1px_rgba(212,168,83,0.30)]">
          <p className="mb-1 font-semibold text-[color:var(--trust-gold)]">
            Tu perfil de vendedor está inactivo
          </p>
          <p className="text-[color:var(--fg-muted)]">
            Para publicar productos, necesitas activar el modo vendedor en{" "}
            <Link
              href="/perfil"
              className="font-semibold text-[color:var(--brand-hi)] underline transition-colors hover:text-[color:var(--brand)]"
            >
              tu perfil
            </Link>
            .
          </p>
        </div>
      )}

      <form
        ref={formRef}
        action={handleSubmit}
        className="rounded-3xl product-card-custom p-6 md:p-8 space-y-6 animate-scale-in"
      >
      {error && (
        <div className="rounded-xl bg-[rgba(255,59,48,0.10)] p-4 text-sm text-[color:var(--danger)] shadow-[inset_0_0_0_1px_rgba(255,59,48,0.30)]">
          <p className="flex items-center gap-2 font-semibold">
            <span className="text-lg">⚠️</span> {error}
          </p>
        </div>
      )}

      {/* Tipo Toggle / Locked Display */}
      {isEdit ? (
        <div className="space-y-3 pb-4 border-b border-border/40">
          <label className="text-sm font-semibold tracking-wide uppercase text-muted-foreground/80">Tipo de publicación</label>
          <div className="flex items-center gap-3 rounded-2xl product-card-custom p-4">
            {tipoSeleccionado === "producto" ? (
              <PackageOpen className="h-5 w-5 text-[color:var(--fg)]" />
            ) : (
              <Store className="h-5 w-5 text-[color:var(--fg)]" />
            )}
            <div className="flex-1">
              <p className="text-sm font-semibold text-[color:var(--fg)]">
                {tipoSeleccionado === "producto" ? "Producto físico" : "Servicio local"}
              </p>
              <p className="text-xs text-[color:var(--fg-muted)] mt-0.5">
                No se puede cambiar después de publicar.
              </p>
            </div>
          </div>
          <input type="hidden" name="tipo" value={tipoSeleccionado} />
        </div>
      ) : (
        <div className="space-y-3 pb-4 border-b border-border/40">
          <label className="text-sm font-semibold tracking-wide uppercase text-muted-foreground/80">¿Qué tipo de publicación es?</label>
          <div className="grid grid-cols-2 gap-3">
            <label className="group relative cursor-pointer">
              <input
                type="radio"
                name="tipo"
                value="producto"
                checked={tipoSeleccionado === "producto"}
                onChange={() => {
                  setTipoSeleccionado("producto");
                  // "Reservación" solo existe para servicios; al cambiar a
                  // producto la opcion desaparece del select y el estado
                  // quedaria apuntando a un value inexistente.
                  if (modoPrecio === "reservacion") setModoPrecio("precio");
                  setCategories((prev) => filterCategoriesByTipo(prev, "producto"));
                }}
                className="peer sr-only"
              />
              <div className={cn(
                "flex flex-col items-center justify-center rounded-2xl p-4 transition-all duration-200",
                tipoSeleccionado === "producto"
                  ? "bg-white text-black"
                  : "product-card-custom text-[color:var(--fg-muted)] hover:opacity-90"
              )}>
                <PackageOpen className={cn("mb-2 h-6 w-6 transition-colors", tipoSeleccionado === "producto" ? "text-black" : "text-[color:var(--fg-muted)]")} />
                <span className="text-sm font-semibold">Producto físico</span>
              </div>
              {tipoSeleccionado === "producto" && (
                <div className="absolute right-3 top-3 text-black">
                  <CheckCircle2 className="h-4 w-4" />
                </div>
              )}
            </label>

            <label className="group relative cursor-pointer">
              <input
                type="radio"
                name="tipo"
                value="servicio"
                checked={tipoSeleccionado === "servicio"}
                onChange={() => {
                  setTipoSeleccionado("servicio");
                  setCategories((prev) => filterCategoriesByTipo(prev, "servicio"));
                }}
                className="peer sr-only"
              />
              <div className={cn(
                "flex flex-col items-center justify-center rounded-2xl p-4 transition-all duration-200",
                tipoSeleccionado === "servicio"
                  ? "bg-white text-black"
                  : "product-card-custom text-[color:var(--fg-muted)] hover:opacity-90"
              )}>
                <Store className={cn("mb-2 h-6 w-6 transition-colors", tipoSeleccionado === "servicio" ? "text-black" : "text-[color:var(--fg-muted)]")} />
                <span className="text-sm font-semibold">Servicio local</span>
              </div>
              {tipoSeleccionado === "servicio" && (
                <div className="absolute right-3 top-3 text-black">
                  <CheckCircle2 className="h-4 w-4" />
                </div>
              )}
            </label>
          </div>
        </div>
      )}

      {/* Appointment config — services only */}
      {tipoSeleccionado === "servicio" && (
        <div className="space-y-4 p-4 rounded-2xl product-card-custom">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-foreground">Permitir agendar citas</p>
              <p className="text-xs text-muted-foreground mt-0.5">Los compradores podrán reservar horarios</p>
            </div>
            <button
              type="button"
              onClick={() => setAllowAppointments(!allowAppointments)}
              className={`relative h-6 w-11 rounded-full transition-colors ${
                allowAppointments
                  ? "bg-white"
                  : "bg-[color:var(--bg-elev-2)] shadow-[inset_0_0_0_1px_var(--border)]"
              }`}
            >
              <span
                className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full shadow transition-transform ${
                  allowAppointments ? "translate-x-5 bg-black" : "bg-white"
                }`}
              />
            </button>
          </div>
          <input type="hidden" name="allow_appointments" value={allowAppointments ? "true" : "false"} />

          {allowAppointments && (
            <div className="space-y-3 pt-3 border-t border-border/30">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs text-muted-foreground">Mis citas empiezan a las:</label>
                  <select name="appointment_start_time" value={apptStart} onChange={(e) => setApptStart(e.target.value)}
                    className="w-full product-card-btn rounded-xl px-4 py-3 text-sm border-0 outline-none appearance-none">
                    {Array.from({ length: 48 }, (_, i) => {
                      const h = Math.floor(i / 2);
                      const m = i % 2 === 0 ? "00" : "30";
                      const v = `${String(h).padStart(2, "0")}:${m}`;
                      const p = h >= 12 ? "p.m." : "a.m.";
                      const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
                      return <option key={v} value={v}>{h12}:{m} {p}</option>;
                    })}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs text-muted-foreground">Termino de atender a las:</label>
                  <select name="appointment_end_time" value={apptEnd} onChange={(e) => setApptEnd(e.target.value)}
                    className="w-full product-card-btn rounded-xl px-4 py-3 text-sm border-0 outline-none appearance-none">
                    {Array.from({ length: 48 }, (_, i) => {
                      const h = Math.floor(i / 2);
                      const m = i % 2 === 0 ? "00" : "30";
                      const v = `${String(h).padStart(2, "0")}:${m}`;
                      const p = h >= 12 ? "p.m." : "a.m.";
                      const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
                      return <option key={v} value={v}>{h12}:{m} {p}</option>;
                    })}
                  </select>
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">Cada cita dura:</label>
                <select name="appointment_duration_minutes" value={apptDuration} onChange={(e) => setApptDuration(e.target.value)}
                  className="w-full product-card-btn rounded-xl px-4 py-3 text-sm border-0 outline-none appearance-none">
                  <option value="5">5 minutos</option>
                  <option value="10">10 minutos</option>
                  <option value="15">15 minutos</option>
                  <option value="20">20 minutos</option>
                  <option value="30">30 minutos</option>
                  <option value="45">45 minutos</option>
                  <option value="60">1 hora</option>
                  <option value="90">1.5 horas</option>
                  <option value="120">2 horas</option>
                  <option value="240">4 horas</option>
                </select>
                <p className="text-xs text-muted-foreground">Si atiendes de noche, pon un horario que termine antes de medianoche.</p>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pb-2">
        {/* Titulo */}
        <div className="space-y-2 md:col-span-2">
          <label htmlFor="titulo" className="text-sm font-medium text-foreground/80">
            Título de la publicación
          </label>
          <input
            id="titulo"
            name="titulo"
            type="text"
            required
            minLength={3}
            maxLength={120}
            defaultValue={initialValues?.titulo ?? ""}
            placeholder={tipoSeleccionado === "producto" ? "Ej: iPhone 13 Pro Max - Como nuevo" : "Ej: Clases de regularización de matemáticas"}
            className="w-full rounded-xl product-card-btn px-4 py-3 text-sm outline-none transition-all focus:ring-2 focus:ring-primary/20 placeholder:text-muted-foreground/50"
          />
        </div>

        {/* Precio */}
        <div className="space-y-2">
          <label htmlFor="modo_precio" className="text-sm font-medium text-foreground/80">
            ¿Cómo manejas el precio?
          </label>
          <select
            id="modo_precio"
            value={modoPrecio}
            onChange={(e) => {
              const next = e.target.value;
              setModoPrecio(next);
              // Sin precio visible no hay nada que negociar.
              if (next !== "precio") setPrecioNegociable(false);
              // Reservación implica que el comprador aparta un horario.
              if (next === "reservacion") setAllowAppointments(true);
            }}
            className="w-full rounded-xl product-card-btn px-4 py-3 text-sm outline-none transition-all focus:ring-2 focus:ring-primary/20 appearance-none"
            style={{
              backgroundImage: `url("data:image/svg+xml;charset=US-ASCII,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8' fill='none'%3E%3Cpath d='M1 1.5L6 6.5L11 1.5' stroke='currentColor' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")`,
              backgroundRepeat: "no-repeat",
              backgroundPosition: "right 1rem center",
              backgroundSize: "0.75em auto",
              paddingRight: "2.5rem",
            }}
          >
            <option value="precio">Precio fijo</option>
            <option value="cotizacion">Cotización</option>
            {tipoSeleccionado === "servicio" && (
              <option value="reservacion">Reservación</option>
            )}
          </select>
          <input type="hidden" name="modo_precio" value={modoPrecio} />

          {modoPrecio === "precio" ? (
            <>
              <label htmlFor="precio" className="text-sm font-medium text-foreground/80">
                Precio <span className="text-muted-foreground font-normal">(MXN)</span>
              </label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground font-medium">$</span>
                <input
                  id="precio"
                  name="precio"
                  type="number"
                  required
                  min={1}
                  max={99999999}
                  step="0.01"
                  defaultValue={initialValues?.precio ?? ""}
                  placeholder="0.00"
                  className="w-full rounded-xl product-card-btn pl-8 pr-4 py-3 text-sm outline-none transition-all focus:ring-2 focus:ring-primary/20 tabular-nums font-heading font-medium"
                />
              </div>
            </>
          ) : (
            <p className="text-xs text-muted-foreground">No se mostrará precio. El comprador te contactará.</p>
          )}
        </div>

        {/* Precio negociable */}
        {modoPrecio === "precio" && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-foreground">Precio negociable</p>
              <p className="text-xs text-muted-foreground mt-0.5">El comprador puede proponer otro precio</p>
            </div>
            <button
              type="button"
              onClick={() => setPrecioNegociable(!precioNegociable)}
              className={`relative h-6 w-11 rounded-full transition-colors ${
                precioNegociable
                  ? "bg-white"
                  : "bg-[color:var(--bg-elev-2)] shadow-[inset_0_0_0_1px_var(--border)]"
              }`}
            >
              <span
                className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full shadow transition-transform ${
                  precioNegociable ? "translate-x-5 bg-black" : "bg-white"
                }`}
              />
            </button>
          </div>
          <input type="hidden" name="precio_negociable" value={precioNegociable ? "true" : "false"} />
        </div>
        )}

        {/* Categorias — multi-select hasta 3, una marcada como principal (MP#08 #5c-2) */}
        <div className="space-y-2 relative">
          <div className="flex items-baseline justify-between gap-2">
            <label className="text-sm font-medium text-foreground/80">
              Categorías <span className="text-muted-foreground/70 font-normal">(hasta 3, 1 principal)</span>
            </label>
            <span className="text-xs text-muted-foreground/70">{categories.length}/3</span>
          </div>
          <input
            type="hidden"
            name="categories"
            value={JSON.stringify(categories)}
            required
          />

          {/* El required del input hidden no lo valida el navegador, y un
              cambio de tipo puede vaciar la lista sin que el usuario lo pida.
              Sin este aviso el formulario queda mudo hasta que falla al
              enviar. */}
          {categories.length === 0 && (
            <p className="text-xs text-[color:var(--fg-muted)]">
              Elige al menos una categoría. La primera que agregues queda como principal.
            </p>
          )}

          {/* Chips de las categorias seleccionadas */}
          {categories.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {categories.map((cat) => {
                const meta = CATEGORIES.find((c) => c.slug === cat.slug);
                if (!meta) return null;
                return (
                  <div
                    key={cat.slug}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full pl-2 pr-1 py-1 text-sm shadow-[inset_0_0_0_1px_var(--border)]",
                      cat.is_primary
                        ? "bg-[color:var(--brand-tint-strong)] text-[color:var(--brand-hi)] font-semibold"
                        : "bg-[color:var(--card-2)] text-foreground/90",
                    )}
                  >
                    <button
                      type="button"
                      aria-label={cat.is_primary ? `${meta.name} es la principal` : `Marcar ${meta.name} como principal`}
                      aria-pressed={cat.is_primary}
                      onClick={() =>
                        setCategories((prev) =>
                          prev.map((c) => ({ ...c, is_primary: c.slug === cat.slug }))
                        )
                      }
                      className="inline-flex h-8 w-8 items-center justify-center rounded-full transition-colors hover:bg-[color:var(--brand-tint)]"
                    >
                      <Star
                        className={cn("h-4 w-4", cat.is_primary ? "fill-current" : "")}
                        strokeWidth={2}
                      />
                    </button>
                    <span className="px-1">{meta.name}</span>
                    <button
                      type="button"
                      aria-label={`Quitar ${meta.name}`}
                      onClick={() =>
                        setCategories((prev) =>
                          ensureOnePrimary(prev.filter((c) => c.slug !== cat.slug)),
                        )
                      }
                      className="inline-flex h-8 w-8 items-center justify-center rounded-full transition-colors hover:bg-[color:var(--danger-tint,rgba(255,59,48,0.15))]"
                    >
                      <X className="h-3.5 w-3.5" strokeWidth={2.5} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {/* Combobox para agregar (deshabilitado al llegar a 3) */}
          {categories.length < 3 && (
            <button
              type="button"
              onClick={() => setCategoryOpen(!categoryOpen)}
              className={cn(
                "w-full flex items-center justify-between rounded-xl product-card-btn px-4 py-3 text-sm outline-none transition-all hover:opacity-90",
                categoryOpen && "ring-2 ring-primary/20",
                "text-muted-foreground/80"
              )}
            >
              {categories.length === 0 ? "Selecciona una categoría" : "Agregar otra categoría"}
              <ChevronDown className={cn("w-4 h-4 text-muted-foreground transition-transform", categoryOpen && "rotate-180")} />
            </button>
          )}

          {categoryOpen && categories.length < 3 && (
            <div className="absolute z-50 top-full left-0 right-0 mt-1 rounded-xl border border-border/50 bg-card shadow-lg max-h-64 overflow-hidden">
              <div className="p-2 border-b border-border/30">
                <div className="flex items-center gap-2 rounded-lg bg-muted px-3 py-1.5">
                  <Search className="w-3.5 h-3.5 text-muted-foreground" />
                  <input
                    type="text"
                    value={categorySearch}
                    onChange={(e) => setCategorySearch(e.target.value)}
                    placeholder="Buscar categoría..."
                    className="flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground/50"
                    autoFocus
                  />
                </div>
              </div>
              <div className="overflow-y-auto max-h-48 p-1">
                {[tipoSeleccionado, "otro"].map((type) => {
                  const label = type === "producto" ? "Productos" : type === "servicio" ? "Servicios" : "Otros";
                  const cats = CATEGORIES.filter((c) =>
                    c.type === type
                    && !c.hidden_in_form
                    && !categories.some((sel) => sel.slug === c.slug)
                    && (
                      // Se busca tambien en los ejemplos. Sin esto, teclear
                      // "gomitas" no devolvia nada aunque "Dulces y Postres"
                      // estuviera ahi: el vendedor no busca el nombre del
                      // cajon, busca su producto.
                      c.name.toLowerCase().includes(categorySearch.toLowerCase())
                      || c.ejemplos.toLowerCase().includes(categorySearch.toLowerCase())
                    )
                  );
                  if (cats.length === 0) return null;
                  return (
                    <div key={type}>
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50 px-3 py-1.5">{label}</p>
                      {cats.map(cat => (
                        <button
                          key={cat.slug}
                          type="button"
                          onClick={() => {
                            setCategories((prev) => {
                              // La primera categoria seleccionada se marca como principal.
                              const isFirst = prev.length === 0;
                              return [...prev, { slug: cat.slug, is_primary: isFirst }];
                            });
                            setCategoryOpen(false);
                            setCategorySearch("");
                          }}
                          className="w-full text-left px-3 py-2 rounded-lg transition-colors hover:bg-[color:var(--bg-elev-2)]"
                        >
                          <span className="block text-sm">{cat.name}</span>
                          <span className="block text-[11px] text-muted-foreground truncate">
                            {cat.ejemplos}
                          </span>
                        </button>
                      ))}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Descripcion */}
      <div className="space-y-2">
        <label htmlFor="descripcion" className="text-sm font-medium text-foreground/80">
          Descripción detallada
        </label>
        <textarea
          id="descripcion"
          name="descripcion"
          required
          minLength={10}
          maxLength={5000}
          rows={5}
          defaultValue={initialValues?.descripcion ?? ""}
          placeholder="Describe los detalles, condición, medidas, o lo que incluye tu servicio..."
          className="w-full rounded-xl product-card-btn px-4 py-3 text-sm outline-none transition-all focus:ring-2 focus:ring-primary/20 resize-y placeholder:text-muted-foreground/50"
        />
      </div>

      {/* Estado / condicion fisica (solo productos) */}
      {tipoSeleccionado === "producto" && (
        <div className="space-y-2 pt-2">
          <label htmlFor="estado" className="text-sm font-medium text-foreground/80">
            Estado del producto
          </label>
          <select
            id="estado"
            name="estado"
            required
            value={estado}
            onChange={(e) => setEstado(e.target.value)}
            className="w-full rounded-xl product-card-btn px-4 py-3 text-sm outline-none transition-all focus:ring-2 focus:ring-primary/20 appearance-none"
            style={{
              backgroundImage: `url("data:image/svg+xml;charset=US-ASCII,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8' fill='none'%3E%3Cpath d='M1 1.5L6 6.5L11 1.5' stroke='currentColor' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")`,
              backgroundRepeat: "no-repeat",
              backgroundPosition: "right 1rem center",
              backgroundSize: "0.75em auto",
              paddingRight: "2.5rem",
            }}
          >
            <option value="" disabled>
              Selecciona el estado
            </option>
            <option value="nuevo">Nuevo (sellado, sin abrir)</option>
            <option value="como_nuevo">Como nuevo (usado pocas veces)</option>
            <option value="bueno">Bueno (señales de uso normal)</option>
            <option value="aceptable">Aceptable (marcas visibles, funcional)</option>
            <option value="para_piezas">Para piezas (no funciona o partes faltantes)</option>
          </select>
        </div>
      )}

      {/* Color (solo productos) */}
      {tipoSeleccionado === "producto" && (
        <div className="space-y-2 pt-2">
          <label htmlFor="color" className="text-sm font-medium text-foreground/80">
            Color <span className="text-muted-foreground font-normal">(opcional)</span>
          </label>
          <input
            type="text"
            id="color"
            name="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            maxLength={40}
            placeholder="Ej: Rojo, Negro, Azul marino"
            className="w-full rounded-xl product-card-btn px-4 py-3 text-sm outline-none transition-all focus:ring-2 focus:ring-primary/20"
          />
        </div>
      )}

      {/* Ubicación con mapa */}
      <div className="space-y-2 pt-2">
        <label className="text-sm font-medium text-foreground/80">
          Zona de entrega / operación {!isEdit && <span className="text-[color:var(--brand)] font-medium text-xs ml-1">* obligatorio</span>}
        </label>
        {isEdit && (
          <p className="text-xs text-muted-foreground">
            La ubicación guardada se conserva si no tocas el mapa. Mueve el marcador solo si quieres cambiarla.
          </p>
        )}
        <input type="hidden" name="ubicacion" value={locationData.address} />
        <input type="hidden" name="ubicacion_lat" value={locationData.lat || ""} />
        <input type="hidden" name="ubicacion_lng" value={locationData.lng || ""} />
        <input type="hidden" name="delivery_radius_km" value={locationData.radius} />
        {/* El componente ya aceptaba estas tres props y NADIE se las pasaba.
            initialLat/initialLng ademas destapan el mapa: su estado `showMap`
            nace de `hasInitial`, asi que sin ellas el mapa quedaba oculto
            hasta buscar una direccion, tambien al editar. */}
        <DeliveryMap
          initialLat={initialValues?.ubicacion_lat ?? undefined}
          initialLng={initialValues?.ubicacion_lng ?? undefined}
          initialRadius={initialValues?.delivery_radius_km ?? undefined}
          onLocationChange={(lat, lng, address) => setLocationData((p) => ({ ...p, lat, lng, address }))}
          onRadiusChange={(radius) => setLocationData((p) => ({ ...p, radius }))}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2 pb-4">

        {/* Tipo de entrega */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground/80">Opciones de entrega</label>
          <select
            name="tipo_entrega"
            defaultValue={initialValues?.tipo_entrega ?? "punto_encuentro"}
            className="w-full rounded-xl product-card-btn px-4 py-3 text-sm outline-none transition-all focus:ring-2 focus:ring-primary/20 appearance-none"
            style={{ backgroundImage: `url('data:image/svg+xml;charset=US-ASCII,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22292.4%22%20height%3D%22292.4%22%3E%3Cpath%20fill%3D%22%23666666%22%20d%3D%22M287%2069.4a17.6%2017.6%200%200%200-13-5.4H18.4c-5%200-9.3%201.8-12.9%205.4A17.6%2017.6%200%200%200%200%2082.2c0%205%201.8%209.3%205.4%2012.9l128%20127.9c3.6%203.6%207.8%205.4%2012.8%205.4s9.2-1.8%2012.8-5.4L287%2095c3.5-3.5%205.4-7.8%205.4-12.8%200-5-1.9-9.2-5.5-12.8z%22%2F%3E%3C%2Fsvg%3E')`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right .7em top 50%', backgroundSize: '.65em auto' }}
          >
            {DELIVERY_OPTIONS
              .filter(o => (o.for as readonly string[]).includes(tipoSeleccionado))
              .map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))
            }
          </select>
        </div>
      </div>

      {/* Media Upload */}
      <div className="space-y-3 pt-2">
        <label className="text-sm font-medium text-foreground/80">
          Fotos y videos <span className="text-muted-foreground font-normal">(máx. 5, arrastra para ordenar)</span>
        </label>
        <DndContext 
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <div className="flex gap-2 flex-wrap">
            <SortableContext 
              items={media.map(m => m.id)}
              strategy={rectSortingStrategy}
            >
              {media.map((item, i) => (
                <SortableMediaItem
                  key={item.id}
                  item={item}
                  index={i}
                  onRemove={() => removeMedia(i)}
                />
              ))}
            </SortableContext>
            
            {media.length < 5 && (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-20 h-20 rounded-xl border-2 border-dashed border-border/50 flex flex-col items-center justify-center text-muted-foreground hover:border-primary/40 hover:text-primary transition-colors"
              >
                <ImagePlus className="w-5 h-5" />
                <span className="text-[10px] mt-0.5">Agregar</span>
              </button>
            )}
          </div>
        </DndContext>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,video/mp4,video/webm,video/quicktime"
          multiple
          className="hidden"
          onChange={handleImageSelect}
        />
      </div>

      {/* Crop modal — auto-opens for each queued file */}
      <ProductMediaCropper
        open={cropperOpen}
        mediaSrc={currentCropItem?.src ?? null}
        mediaType={currentCropItem?.isVideo ? "video" : "image"}
        originalFile={currentCropItem?.file}
        onCancel={handleCropCancel}
        onCropComplete={handleCropResult}
      />
    </form>
    </>
  );
}
