"use client";

import { useState, useCallback, useRef } from "react";
import dynamic from "next/dynamic";
import { Loader2 } from "lucide-react";
import * as Sentry from "@sentry/nextjs";
import { CACHE_INMUTABLE } from "@/lib/storage/cache";
import { fileToDataURL } from "@/lib/crop-image";
import type { CropResult } from "@/components/product/product-media-cropper";

/**
 * El recortador se carga solo cuando hace falta. Arrastra react-easy-crop, y
 * la mayoria de las visitas a un perfil no tocan la foto; es el mismo criterio
 * que ya sigue el formulario de publicar.
 */
const ProductMediaCropper = dynamic(
  () => import("@/components/product/product-media-cropper").then((m) => m.ProductMediaCropper),
  { ssr: false, loading: () => <p role="status" className="mt-3 text-sm text-muted-foreground">Abriendo el recortador…</p> },
);

interface AvatarInlineUploadProps {
  initial: string;
  avatarUrl: string;
  onUploadSuccess: (url: string) => void;
  onError: (msg: string) => void;
  /**
   * Deja encuadrar la foto antes de subirla, con el MISMO recortador que ya
   * usan las fotos de publicacion.
   *
   * Hasta ahora el avatar se subia tal cual: la foto se escalaba a 800 px por
   * el lado mayor y el contenedor la recortaba con object-cover, o sea que el
   * encuadre lo decidia el CSS y a la persona le tocaba lo que saliera. Con una
   * foto apaisada, eso es una cara cortada.
   *
   * No se cambia el comportamiento de quien no lo pide: por defecto va
   * apagado, y las llamadas existentes siguen subiendo como antes.
   */
  conRecorte?: boolean;
}

const MAX_SAFE_SIZE_MB = 25;

export function AvatarInlineUpload({
  initial,
  avatarUrl,
  onUploadSuccess,
  onError,
  conRecorte = false,
}: AvatarInlineUploadProps) {
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const busy = useRef(false);
  const [recorteSrc, setRecorteSrc] = useState<string | null>(null);

  /**
   * Comprime y sube. Se extrajo del onChange para que el camino con recorte y
   * el de siempre compartan EXACTAMENTE el mismo tratamiento: si algun dia
   * cambia el tamano o la calidad, cambia para los dos a la vez.
   */
  const procesarYSubir = useCallback(
    async (origen: Blob) => {
      if (busy.current) return;
      busy.current = true;
      setAvatarUploading(true);
      try {
        let uploadBlob: Blob = origen;
        let ext = "jpg";

        if (typeof window === "undefined" || !window.createImageBitmap) {
          onError("No pudimos procesar la foto en este navegador");
          setAvatarUploading(false);
          return;
        }

        try {
          const bmp = await window.createImageBitmap(origen);
          try {
            const MAX_SIZE = 800;
            let width = bmp.width;
            let height = bmp.height;

            if (width > MAX_SIZE || height > MAX_SIZE) {
              if (width > height) {
                height = Math.round(height * (MAX_SIZE / width));
                width = MAX_SIZE;
              } else {
                width = Math.round(width * (MAX_SIZE / height));
                height = MAX_SIZE;
              }
            }

            const canvas = document.createElement("canvas");
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext("2d");
            if (ctx) {
              ctx.drawImage(bmp, 0, 0, width, height);
              const compressedBlob = await new Promise<Blob | null>((resolve) =>
                canvas.toBlob(resolve, "image/jpeg", 0.85),
              );
              if (!compressedBlob) throw new Error("Fallo al exportar blob");
              uploadBlob = compressedBlob;
              ext = "jpg";
            } else {
              throw new Error("No se pudo crear contexto 2d");
            }
          } finally { bmp.close(); }
        } catch (compressErr) {
          console.warn("avatar compression failed", compressErr);
          onError("No pudimos procesar la foto en tu dispositivo.");
          setAvatarUploading(false);
          return;
        }

        const supabase = (await import("@/lib/supabase/client")).createClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) {
          onError("Tu sesión expiró. Vuelve a entrar y reinténtalo.");
          setAvatarUploading(false);
          return;
        }
        const path = `${user.id}/avatar-${Date.now()}.${ext}`;
        // Un solo reintento: el fallo tipico aqui es de red — se vio en un
        // iPhone con senal debil, y al segundo intento manual entro. Con
        // upsert:true reintentar sobre el mismo path es seguro.
        const subir = () =>
          supabase.storage
            .from("avatars")
            .upload(path, uploadBlob, { upsert: true, cacheControl: CACHE_INMUTABLE });

        let { error: upErr } = await subir();
        if (upErr) {
          await new Promise((r) => setTimeout(r, 1500));
          ({ error: upErr } = await subir());
        }
        if (upErr) throw upErr;
        const { data: urlData } = supabase.storage.from("avatars").getPublicUrl(path);
        onUploadSuccess(urlData.publicUrl);
      } catch (err) {
        // Nunca ensenar err.message: en Safari un fallo de red da
        // "Load failed" y el cliente de Supabase le pega el host del
        // proyecto. El vendedor veia eso en ingles.
        //
        // Pero el detalle SI se reporta. Desde que la foto es obligatoria en el
        // onboarding, este catch dejo de ser una molestia y paso a ser un muro:
        // quien no consigue subirla no puede continuar. Con solo un
        // console.warn, ese muro era invisible desde fuera — nadie se enteraba
        // de cuanta gente se quedaba parada aqui ni de por que.
        console.warn("avatar upload failed", err);
        Sentry.captureException(err, { tags: { action: "avatar_upload" } });
        onError("No se pudo subir la foto. Revisa tu conexión e inténtalo de nuevo.");
      } finally {
        busy.current = false;
        setAvatarUploading(false);
      }
    },
    [onError, onUploadSuccess],
  );

  function alRecortar(resultado: CropResult) {
    setRecorteSrc(null);
    // El recortador tambien sabe de video, pero aqui la entrada esta limitada a
    // imagenes por el accept del input. Se comprueba igual en vez de afirmarlo:
    // si algun dia el accept cambia, esto no sube un archivo que no toca.
    if (resultado.type !== "image") return;
    void procesarYSubir(resultado.blob);
  }

  return (
    <div className="flex flex-col items-center justify-center mb-6">
      <div className="relative w-[72px] h-[72px] rounded-full bg-muted overflow-hidden shrink-0">
        {avatarUrl ? (
          <img src={avatarUrl} alt="Avatar" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-2xl font-bold text-muted-foreground">
            {initial}
          </div>
        )}
        {(avatarUploading || preparing) && (
          <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
            <Loader2 className="w-5 h-5 text-white animate-spin" />
          </div>
        )}
      </div>
      <label className="cursor-pointer mt-3">
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          disabled={avatarUploading || preparing || !!recorteSrc}
          onChange={async (e) => {
            const file = e.target.files?.[0];
            // El input se limpia SIEMPRE. Sin esto, elegir la misma foto dos
            // veces seguidas (por ejemplo tras cancelar el recorte) no dispara
            // otro change y parece que el boton dejo de funcionar.
            e.target.value = "";
            if (!file || busy.current || recorteSrc) return;
            if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
              onError("Elige una imagen JPG, PNG o WebP.");
              return;
            }
            if (file.size > MAX_SAFE_SIZE_MB * 1024 * 1024) {
              onError(`La imagen es demasiado grande (máx ${MAX_SAFE_SIZE_MB}MB)`);
              return;
            }

            if (conRecorte) {
              busy.current = true;
              setPreparing(true);
              try {
                setRecorteSrc(await fileToDataURL(file));
              } catch {
                onError("No pudimos abrir esa foto. Prueba con otra.");
              } finally {
                busy.current = false;
                setPreparing(false);
              }
              return;
            }

            await procesarYSubir(file);
          }}
        />
        <span className="text-[13px] font-medium text-primary hover:underline">
          {avatarUrl ? "Cambiar foto" : "Subir foto"}
        </span>
      </label>

      {(preparing || avatarUploading) && (
        <p role="status" className="mt-2 text-sm text-muted-foreground">
          {preparing ? "Preparando foto…" : "Subiendo foto…"}
        </p>
      )}

      {recorteSrc && (
        <ProductMediaCropper
          open
          mediaSrc={recorteSrc}
          mediaType="image"
          onCancel={() => setRecorteSrc(null)}
          onCropComplete={alRecortar}
        />
      )}
    </div>
  );
}
