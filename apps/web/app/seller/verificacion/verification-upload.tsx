"use client";

import { useEffect, useRef, useState } from "react";
import * as Sentry from "@sentry/nextjs";
import { AVISO_PRIVACIDAD_VERSION } from "@vicino/shared";
import { registrarConsentimientoBiometrico } from "@/app/actions/consentimiento";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { Database } from "@/types/database.types";
import {
  Camera,
  ImagePlus,
  CheckCircle,
  Clock,
  XCircle,
  Bot,
  Trash2,
  AlertTriangle,
} from "lucide-react";
import { verifyDocument } from "@/app/actions/verify-document";
import { conTope, esTope } from "@/lib/auth/con-tope";
import { useBodyScrollLock } from "@/hooks/use-body-scroll-lock";
import { AvisoPrivacidadModal } from "@/components/legal/aviso-privacidad-modal";
import { UNIVERSITY_COLORS, getContrastYIQ } from "@/lib/utils";

/**
 * Tipos que aceptamos como documento de identidad.
 *
 * La lista es EXACTAMENTE la del bucket (allowed_mime_types en
 * 20260320000017_storage_buckets.sql). Antes traia tambien heic, heif y jpg
 * "porque es lo que produce la camara de un iPhone", y era justo lo contrario:
 * el bucket los rechaza con un 415 y la persona acababa leyendo "mime type
 * image/heic is not supported" en ingles. Igualada la lista, el rechazo lo da la
 * validacion local, en espanol y diciendo que hay que elegir JPG o PNG.
 *
 * El resto —PDF, video, comprimidos— se rechaza por el mismo sitio: la IA que
 * revisa el documento solo entiende imagenes, y sin esta validacion un PDF
 * llegaba hasta el analisis para fallar alli, gastando la subida y sin decirle
 * nada util a la persona.
 */
const ALLOWED_DOCUMENT_TYPES = ["image/jpeg", "image/png", "image/webp"];

/** Una foto de credencial no necesita mas. Por encima, suele ser un video mal elegido. */
const MAX_DOCUMENT_MB = 10;
const MAX_DOCUMENT_BYTES = MAX_DOCUMENT_MB * 1024 * 1024;

interface VerificationUploadProps {
  /** Si ya dejo constancia en una sesion anterior. El consentimiento no caduca al cerrar la pestana. */
  yaConsintio?: boolean;
  userId: string;
  verification: {
    selfie_url?: string | null;
    selfie_verified?: boolean;
    id_front_url?: string | null;
    id_back_url?: string | null;
    id_verified?: boolean;
    phone_verified?: boolean;
    current_level?: string;
  } | null;
  sellerVerification: {
    /**
     * La fila concreta que esta pantalla escribe.
     *
     * `user_id` NO es unico en seller_verification: el historial multi-fila es
     * el diseno y la pagina lee la mas reciente. Escribir con `.eq("user_id")`
     * tocaba TODAS las filas del vendedor, asi que subir una selfie resucitaba
     * en la cola del panel una solicitud vieja ya rechazada —con su
     * reviewer_note y su reviewed_at de entonces, que el admin ni puede limpiar
     * porque esas dos columnas no estan en su GRANT—.
     */
    id: string;
    status?: string;
    ine_front_url?: string | null;
    ine_back_url?: string | null;
    selfie_url?: string | null;
    document_type?: string | null;
    university_name?: string | null;
  } | null;
}

const UNIVERSITIES = [
  "BUAP",
  "UDLAP",
  "UPAEP",
  "Tecnológico de Monterrey",
  "Universidad Iberoamericana",
  "Universidad Anáhuac",
  "UVM",
  "UMAD",
  "UVP",
];

type TipoDocumento = "INE" | "Credencial Universitaria";

/** Las tres ranuras de documento. El orden es el de la pantalla. */
type ClaveDocumento = "selfie" | "ine_front" | "ine_back";

const CLAVES_DOCUMENTO: readonly ClaveDocumento[] = ["selfie", "ine_front", "ine_back"];

/** Como se nombra el destino en la confirmacion de cambio. */
const NOMBRE_DEL_TIPO: Record<TipoDocumento, string> = {
  INE: "INE oficial",
  "Credencial Universitaria": "credencial universitaria",
};

interface RanuraDocumento {
  key: ClaveDocumento;
  label: string;
  accept: string;
}

/**
 * La ruta dentro del bucket, a partir de lo que guarda la columna.
 *
 * Las columnas de las dos tablas no guardan lo mismo: unas traen la ruta
 * limpia y otras una URL completa con el nombre del bucket y su query firmada.
 * Pasarle a Storage lo segundo no borra nada ni da error —simplemente no
 * encuentra el objeto— y el archivo se queda en el bucket para siempre.
 */
function rutaEnElBucket(valor: string): string {
  const partes = valor.split("verification-documents/");
  const cruda = partes.length > 1 && partes[1] ? partes[1] : valor;
  return cruda.split("?")[0] ?? cruda;
}

/**
 * Si ya estan todas las fotos que pide el tipo de documento elegido.
 *
 * Existe para que el analisis se dispare UNA vez, con el juego completo. El
 * codigo anterior lo lanzaba al subir la foto frontal, o sea con la selfie y el
 * reverso normalmente sin subir: la IA no podia cotejar nada y el veredicto
 * acababa degradado a revision manual despues de haber gastado la llamada.
 *
 * Solo decide CUANDO llamar. Las rutas ya no viajan al servidor —la accion las
 * lee de la fila— porque mandarlas desde el cliente permitia hacer que el
 * modelo analizara unas imagenes distintas de las que ve el moderador.
 */
function estanTodasLasFotos(
  rutas: Record<ClaveDocumento, string | null>,
  requeridas: readonly ClaveDocumento[],
): boolean {
  return requeridas.every((clave) => Boolean(rutas[clave]));
}

/** El mensaje que le toca a una excepcion de red o de tope. */
function mensajeDeExcepcion(err: unknown, trasTope: string): string {
  return esTope(err)
    ? trasTope
    : "No pudimos completar la solicitud. Revisa tu conexión e intenta de nuevo.";
}

const FILA_PERDIDA =
  "No encontramos tu verificación. Recarga la pantalla e intenta de nuevo.";

/**
 * El resultado de una escritura de esta pantalla.
 *
 * `aplicado` mira SOLO si la fila se escribio, porque la base es la que manda.
 * El comentario anterior decia que "si el descarte fallo, el tipo y la
 * universidad no se mueven" y era falso: el UPDATE ya habia escrito
 * document_type y university_name antes de que el borrado del bucket lanzara, y
 * la pantalla se quedaba con el tipo viejo sobre una fila que decia otro.
 *
 * Y el aviso de almacenamiento viaja APARTE del error a proposito: un fallo
 * parcial del bucket pintaba a la vez el recuadro rojo de "alguna no pudo
 * borrarse" y el aviso de "Eliminamos tus imágenes", que se contradicen en la
 * misma pantalla. Quien llama elige UN solo mensaje.
 */
interface ResultadoEscritura {
  /** true cuando el UPDATE se aplico. Es el punto de compromiso. */
  aplicado: boolean;
  /** Por que no se aplico. null cuando si se aplico. */
  error: string | null;
  /** El bucket se quedo con basura. Independiente de `aplicado`. */
  avisoAlmacenamiento: string | null;
}

export function VerificationUpload({
  userId,
  verification,
  sellerVerification,
  yaConsintio = false,
}: VerificationUploadProps) {
  // Consentimiento expreso para datos biometricos (LFPDPPP art. 8).
  //
  // Nace DESMARCADA a proposito, y esa es la parte importante: el articulo 8
  // exige consentimiento expreso para datos sensibles, y una casilla marcada
  // por defecto no lo es. Si ya consintio antes, no se le vuelve a pedir.
  const [consiente, setConsiente] = useState(yaConsintio);
  const [guardandoConsentimiento, setGuardandoConsentimiento] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const uploadInFlightRef = useRef(false);

  /**
   * El id de la fila de seller_verification que esta pantalla escribe.
   *
   * Vive en un ref y no solo en la prop porque la prop unicamente cambia cuando
   * aterriza `router.refresh()`, y nadie lo espera: en movil, sin fila previa,
   * se subia la selfie (INSERT, fila A) y al subir el frente la prop seguia en
   * null, asi que salia un SEGUNDO INSERT (fila B). Quedaban dos filas con el
   * mismo prefijo de rutas, la pantalla las presentaba como completas y un
   * cambio de tipo posterior borraba del bucket objetos que la otra fila seguia
   * referenciando.
   */
  const filaIdRef = useRef<string | null>(sellerVerification?.id ?? null);

  /**
   * Los `blob:` que ha creado esta pantalla, por ranura.
   *
   * URL.createObjectURL retiene el archivo hasta que alguien lo revoca: sin
   * este registro, cada resubida dejaba una copia entera de la foto viva en
   * memoria durante el resto de la sesion.
   */
  const urlsDeObjetoRef = useRef<Record<string, string>>({});

  const [docType, setDocType] = useState<TipoDocumento>(
    sellerVerification?.document_type === "Credencial Universitaria"
      ? "Credencial Universitaria"
      : "INE"
  );
  const [university, setUniversity] = useState<string>(
    sellerVerification?.university_name || "BUAP"
  );

  /**
   * Lo que espera confirmacion, si hay algo.
   *
   * La variante "foto" existe porque la papelera degradaba una verificacion
   * APROBADA sin preguntar: quitar una foto devuelve la fila a 'pending' —la
   * policy del solicitante lo exige— y con ella se va el acceso al feed de la
   * universidad, pero el aviso de "tu verificación aprobada volverá a revisión"
   * solo aparecia al cambiar de tipo.
   */
  const [cambioPendiente, setCambioPendiente] = useState<
    | { destino: "tipo"; tipo: TipoDocumento }
    | { destino: "universidad"; universidad: string }
    | { destino: "foto"; clave: ClaveDocumento }
    | null
  >(null);
  const [descartando, setDescartando] = useState(false);
  const [avisoAbierto, setAvisoAbierto] = useState(false);

  /**
   * Lo que esta pantalla ya cambio y el servidor todavia no ha contado.
   *
   * Hace falta porque `router.refresh()` tarda: sin esta capa, al descartar las
   * fotos las props seguian trayendo las rutas viejas durante un par de
   * fotogramas y la pantalla decia "Subido correctamente" de imagenes que ya
   * estaban borradas, con el boton de eliminar incluido.
   */
  const [rutasLocales, setRutasLocales] = useState<Record<string, string | null>>({});

  const router = useRouter();
  const supabase = createClient();

  function rutaEfectiva(clave: ClaveDocumento, deLaFila: string | null | undefined): string | null {
    // `clave in rutasLocales` y no `?? `: el descarte guarda null a proposito, y
    // con `??` ese null se confundiria con "no hay nada local" y la imagen ya
    // borrada volveria a darse por subida.
    if (clave in rutasLocales) return rutasLocales[clave] ?? null;
    return deLaFila ?? null;
  }

  /**
   * Los documentos de ESTE tramite: la fila de seller_verification.
   *
   * Se distinguen de los de trust_level_verification porque son los unicos que
   * esta pantalla puede borrar del bucket y los unicos que la revision puede
   * analizar —la accion lee las tres columnas de ESTA fila—. Sin la distincion,
   * el cambio de tipo prometeria borrar fotos de otro tramite que no le
   * pertenecen.
   */
  const docsPropios: Record<ClaveDocumento, string | null> = {
    selfie: rutaEfectiva("selfie", sellerVerification?.selfie_url),
    ine_front: rutaEfectiva("ine_front", sellerVerification?.ine_front_url),
    ine_back: rutaEfectiva("ine_back", sellerVerification?.ine_back_url),
  };

  /**
   * El respaldo de trust_level_verification: SOLO para previsualizar.
   *
   * Antes entraba con un `??` en el mismo dato del que sale el estado de la
   * ranura, y ese `??` REACTIVABA el respaldo en cuanto el descarte ponia
   * docsPropios a null: las tarjetas volvian a decir "Subido correctamente",
   * aparecia la papelera y al tocarla contestaba "Este documento no se puede
   * eliminar desde aquí", mientras el aviso de al lado decia "Eliminamos tus
   * imágenes. Vuelve a subirlas". Ahora el estado "subido" sale SOLO de
   * docsPropios y el respaldo se anuncia en pantalla como lo que es.
   */
  const docsDeRespaldo: Record<ClaveDocumento, string | null> = {
    selfie: verification?.selfie_url ?? null,
    ine_front: verification?.id_front_url ?? null,
    ine_back: verification?.id_back_url ?? null,
  };

  /** Lo que se le manda firmar a Storage para pintar cada ranura. */
  const rutasParaPrevisualizar: Record<ClaveDocumento, string | null> = {
    selfie: docsPropios.selfie ?? docsDeRespaldo.selfie,
    ine_front: docsPropios.ine_front ?? docsDeRespaldo.ine_front,
    ine_back: docsPropios.ine_back ?? docsDeRespaldo.ine_back,
  };

  const haySubidasPropias = CLAVES_DOCUMENTO.some((clave) => Boolean(docsPropios[clave]));

  const [previews, setPreviews] = useState<Record<string, string | null>>({});

  useEffect(() => {
    async function loadPreviews() {
      const p: Record<string, string | null> = {};
      for (const [key, path] of Object.entries(rutasParaPrevisualizar)) {
        if (path) {
          const { data } = await supabase.storage
            .from("verification-documents")
            .createSignedUrl(rutaEnElBucket(path), 60 * 60);
          if (data) {
            p[key] = data.signedUrl;
          }
        }
      }
      setPreviews(prev => ({ ...prev, ...p }));
    }
    loadPreviews();
  }, [
    rutasParaPrevisualizar.selfie,
    rutasParaPrevisualizar.ine_front,
    rutasParaPrevisualizar.ine_back,
  ]);

  // El servidor manda en cuanto contesta: si el refresh trae una fila —la que
  // acabamos de crear, o una abierta desde otra pestana— su id sustituye al que
  // llevabamos, y asi la pantalla se autocorrige sin que nadie la toque.
  useEffect(() => {
    const idDeLaProp = sellerVerification?.id;
    if (idDeLaProp) filaIdRef.current = idDeLaProp;
  }, [sellerVerification?.id]);

  // Al desmontar se sueltan los blob: que queden. Sin esto, salir de la
  // pantalla se llevaba consigo las fotos retenidas en memoria.
  useEffect(() => {
    const registro = urlsDeObjetoRef;
    return () => {
      for (const url of Object.values(registro.current)) URL.revokeObjectURL(url);
    };
  }, []);

  /** Pinta al instante lo que se acaba de subir, soltando el blob anterior de esa ranura. */
  function mostrarVistaLocal(clave: ClaveDocumento, file: File) {
    const anterior = urlsDeObjetoRef.current[clave];
    if (anterior) URL.revokeObjectURL(anterior);
    const nueva = URL.createObjectURL(file);
    urlsDeObjetoRef.current = { ...urlsDeObjetoRef.current, [clave]: nueva };
    setPreviews((prev) => ({ ...prev, [clave]: nueva }));
  }

  /** Quita las vistas de esas ranuras y suelta sus blob: si los habia. */
  function olvidarVistaLocal(claves: readonly ClaveDocumento[]) {
    const aOlvidar = new Set<string>(claves);
    const registro = urlsDeObjetoRef.current;
    for (const [clave, url] of Object.entries(registro)) {
      if (aOlvidar.has(clave)) URL.revokeObjectURL(url);
    }
    urlsDeObjetoRef.current = Object.entries(registro).reduce<Record<string, string>>(
      (conservadas, [clave, url]) =>
        aOlvidar.has(clave) ? conservadas : { ...conservadas, [clave]: url },
      {},
    );
    setPreviews((prev) => ({
      ...prev,
      ...claves.reduce<Record<string, string | null>>(
        (vacias, clave) => ({ ...vacias, [clave]: null }),
        {},
      ),
    }));
  }

  const status = sellerVerification?.status ?? "none";

  const getDocsConfig = (): readonly RanuraDocumento[] => {
    if (docType === "Credencial Universitaria") {
      return [
        { key: "selfie", label: "Selfie", accept: "image/*" },
        { key: "ine_front", label: "Credencial (frente)", accept: "image/*" },
        { key: "ine_back", label: "Credencial (reverso)", accept: "image/*" },
      ];
    }
    return [
      { key: "selfie", label: "Selfie", accept: "image/*" },
      { key: "ine_front", label: "INE (frente)", accept: "image/*" },
      { key: "ine_back", label: "INE (reverso)", accept: "image/*" },
    ];
  };

  /**
   * Nada de tipo ni de universidad se mueve mientras haya algo en vuelo.
   *
   * No es solo cosmetico: a mitad de una subida o de un analisis, cambiar el
   * tipo reescribe document_type de la misma fila que el servidor esta a punto
   * de actualizar, y el veredicto quedaria colgado del documento equivocado —
   * la base diciendo "credencial universitaria" sobre un INE ya analizado.
   *
   * Con la confirmacion abierta tampoco se mueve nada: sin `cambioPendiente`
   * aqui, el Tab desde "Sí, eliminar y cambiar" alcanzaba los botones de tipo
   * de detras —que seguian habilitados— y un Enter ahi llamaba a
   * pedirCambioDeTipo y cambiaba el DESTINO del dialogo que la persona tenia
   * abierto delante.
   */
  const bloqueado =
    uploading !== null || isAnalyzing || descartando || cambioPendiente !== null;

  /**
   * Un solo mensaje por operacion.
   *
   * El fallo parcial del bucket pintaba su recuadro rojo a la vez que el aviso
   * de exito, y los dos textos se contradecian en la misma pantalla.
   */
  function pintarResultado(resultado: ResultadoEscritura, avisoDeExito: string) {
    if (resultado.error) {
      setNotice("");
      setError(resultado.error);
      return;
    }
    if (resultado.avisoAlmacenamiento) {
      setNotice("");
      setError(resultado.avisoAlmacenamiento);
      return;
    }
    setError("");
    setNotice(avisoDeExito);
  }

  async function handleUpload(key: ClaveDocumento, file: File) {
    if (uploadInFlightRef.current) return;
    setError("");
    setNotice("");

    // Sin consentimiento no se sube nada. La comprobacion tambien esta en el
    // servidor (app/actions/verify-document.ts): una casilla solo de cliente
    // se salta con la consola abierta, y aqui lo que se trata son datos
    // biometricos.
    if (!consiente) {
      setError(
        "Antes de subir tus documentos necesitas aceptar el tratamiento de tus datos biométricos.",
      );
      return;
    }

    // `accept="image/*"` es una sugerencia al selector de archivos del sistema,
    // no una validacion: se puede arrastrar un PDF, un video o un .zip y subirlo
    // igual. Aqui se rechaza antes de gastar la subida, y con un mensaje que
    // dice que hacer en vez de un error de Storage en ingles.
    //
    // El HEIC del iPhone cae por aqui, y es a proposito: el bucket no lo admite,
    // asi que dejarlo pasar solo cambiaba este texto por un 415 sin traducir.
    if (!ALLOWED_DOCUMENT_TYPES.includes(file.type)) {
      setError(
        "Ese archivo no tiene un formato que podamos revisar. Elige una foto en JPG o PNG (también aceptamos WEBP) — no un PDF ni un documento. Si tu iPhone la guardó en HEIC, ponlo en «Más compatible» en Ajustes › Cámara › Formatos y vuelve a tomarla."
      );
      return;
    }

    if (file.size > MAX_DOCUMENT_BYTES) {
      const mb = Math.round(file.size / (1024 * 1024));
      setError(
        `La imagen pesa ${mb} MB y el limite son ${MAX_DOCUMENT_MB} MB. Toma la foto con menos resolucion o recortala.`
      );
      return;
    }

    uploadInFlightRef.current = true;
    setUploading(key);
    try {

    // Ruta DETERMINISTA, sin Date.now(). Antes cada resubida creaba un objeto
    // nuevo y el anterior se quedaba para siempre: por eso el bucket llego a
    // acumular 23 archivos para 3 verificaciones. Con upsert, subir de nuevo
    // reemplaza, que es lo que el vendedor espera cuando repite la foto porque
    // "no se ve".
    //
    // Sin extension a proposito: si dependiera de ella, un JPG y un PNG del
    // mismo documento volverian a convivir. El tipo real viaja en contentType.
    const path = `${userId}/${key}`;
    const { error: uploadError } = await conTope(supabase.storage
      .from("verification-documents")
      .upload(path, file, { upsert: true, contentType: file.type }));

    if (uploadError) {
      // Storage contesta en ingles y con jerga —"mime type image/heic is not
      // supported"—, y este era el unico setError del archivo que llegaba sin
      // traducir. El detalle no se pierde: va a Sentry, que es donde sirve.
      Sentry.captureException(uploadError, {
        tags: { action: "verification_upload" },
        extra: { ranura: key, tipoDeArchivo: file.type, tamanoBytes: file.size },
      });
      setError(
        "No pudimos subir la foto. Revisa tu conexión e inténtalo de nuevo con una imagen en JPG o PNG.",
      );
      return;
    }

    // Record<string, string> ensanchaba todo el payload —incluido status— a
    // string, y con el generic puesto eso ya no cuela. El tipo Update de la
    // tabla ademas comprueba los nombres de las tres columnas de URL.
    const updates: Database["public"]["Tables"]["seller_verification"]["Update"] = {};
    if (key === "selfie") updates.selfie_url = path;
    if (key === "ine_front") updates.ine_front_url = path;
    if (key === "ine_back") updates.ine_back_url = path;

    // Actualizamos DB inicialmente como pending
    const payload: Database["public"]["Tables"]["seller_verification"]["Update"] = {
      ...updates,
      status: "pending",
      document_type: docType,
      university_name: docType === "Credencial Universitaria" ? university : null,
      submitted_at: new Date().toISOString(),
    };

    // Se escribe por `id`, nunca por `user_id`: esa fila es la unica que este
    // tramite tiene, y un UPDATE por user_id tocaba tambien las solicitudes
    // viejas del historial y las devolvia a la cola del panel.
    //
    // El id sale del ref y no de la prop porque la prop no cambia hasta que
    // aterriza el refresh: leerla era lo que abria una segunda fila al subir la
    // segunda foto.
    const filaId = filaIdRef.current;
    const { data: filas, error: dbError } = await conTope((async () => filaId
      ? await supabase
          .from("seller_verification")
          .update(payload)
          .eq("id", filaId)
          .select("id")
      : await supabase.from("seller_verification").insert({
          user_id: userId,
          ...payload,
        }).select("id"))());

    const filaAfectada = filas?.[0]?.id ?? null;

    // Un UPDATE de 0 filas NO es un error en PostgREST. Sin esta comprobacion se
    // seguia adelante igual: se llamaba a la IA y quedaba un objeto subido al
    // bucket sin ninguna fila que lo referenciara.
    if (dbError || !filaAfectada) {
      // El archivo solo se retira si la ranura estaba vacia. La ruta es
      // determinista por (usuario, ranura), asi que si ya habia foto aqui el
      // objeto que acaba de reemplazarla es el que la fila sigue apuntando:
      // borrarlo convertiria una foto buena en la URL rota del panel de admin
      // que este orden existe para evitar.
      if (!docsPropios[key]) {
        await supabase.storage.from("verification-documents").remove([path]);
      }
      setError(dbError ? "No se pudo guardar el documento. Intenta de nuevo." : FILA_PERDIDA);
      return;
    }

    // El id se guarda ANTES de cualquier otra cosa: es lo que impide que la
    // siguiente foto, con la prop todavia en null, abra una fila nueva.
    filaIdRef.current = filaAfectada;

    // El apunte local va ANTES del analisis: el disparo mira el juego completo
    // de fotos, y si esperara al `router.refresh()` la que se acaba de subir
    // todavia no contaria — con lo que la ultima que falta nunca completaria el
    // juego y el analisis no arrancaria jamas.
    setRutasLocales((prev) => ({ ...prev, [key]: path }));
    mostrarVistaLocal(key, file);

    const rutasTrasSubir: Record<ClaveDocumento, string | null> = {
      selfie: key === "selfie" ? path : docsPropios.selfie,
      ine_front: key === "ine_front" ? path : docsPropios.ine_front,
      ine_back: key === "ine_back" ? path : docsPropios.ine_back,
    };

    if (!estanTodasLasFotos(rutasTrasSubir, getDocsConfig().map((ranura) => ranura.key))) {
      setNotice("Documento guardado. Sube las fotos que faltan y revisaremos tu identidad.");
      router.refresh();
      return;
    }

    setIsAnalyzing(true);
    // Sin rutas: la accion las lee de la fila. Mandarlas desde el cliente
    // permitia hacer que el modelo analizara unas imagenes distintas de las que
    // acaba viendo el moderador. La fila esta al dia aunque la prop este vieja,
    // porque el UPDATE de arriba ya escribio la columna de esta foto.
    const result = await conTope(verifyDocument(
      docType,
      docType === "Credencial Universitaria" ? university : null,
    ));

    if (!result.success && result.error) {
      setError(result.error);
    } else if (result.documentosPendientes && result.documentosPendientes.length > 0) {
      // La fila no tenia las tres columnas aunque esta pantalla las diera por
      // puestas. No se anuncia revision manual: lo que toca es subir lo que
      // falta, porque el trigger de aprobacion exige las tres URLs.
      setNotice("Documento guardado. Sube las fotos que faltan y revisaremos tu identidad.");
    } else if (result.success && (result.fallback || result.status === "pending")) {
      setNotice("Documento recibido. Tu identidad quedó pendiente de revisión manual.");
    } else if (result.success) {
      setNotice("Análisis terminado. Actualizando el estado de tu verificación.");
    }

    router.refresh();
    } catch (err) {
      setError(
        mensajeDeExcepcion(
          err,
          "La solicitud tardó demasiado. Comprueba el estado antes de volver a subir el documento.",
        ),
      );
      router.refresh();
    } finally {
      uploadInFlightRef.current = false;
      setUploading(null);
      setIsAnalyzing(false);
    }
  }

  /**
   * Borra del bucket y dice si ya no queda nada de lo que se pidio borrar.
   *
   * `.remove()` NO devuelve error cuando la RLS lo bloquea: contesta 200 con la
   * lista de lo que si borro, y un objeto que la policy no deja ver simplemente
   * no viene en esa lista. Comprobar solo `error` es lo que dejaba huerfanos en
   * el bucket sin que nadie se enterara.
   */
  async function borrarDelBucket(rutas: readonly string[]): Promise<boolean> {
    if (rutas.length === 0) return true;
    const { data, error: storageError } = await conTope(
      supabase.storage.from("verification-documents").remove([...rutas]),
    );
    if (storageError) return false;
    const borradas = new Set((data ?? []).map((objeto) => objeto.name));
    const faltantes = rutas.filter((ruta) => !borradas.has(ruta));
    if (faltantes.length === 0) return true;
    // Esa misma omision tampoco distingue "la policy lo bloqueo" de "ya no
    // estaba": la purga de documentos a los 90 dias (20260825000001) se lleva
    // los objetos, y borrar algo que la purga ya se habia llevado sacaba un
    // recuadro rojo alarmante sobre algo que estaba bien. Asi que se le
    // pregunta al bucket, y solo es fracaso si el objeto sigue ahi.
    return await ningunoSigueEnElBucket(faltantes);
  }

  /**
   * true cuando ninguna de esas rutas existe ya en el bucket.
   *
   * Se pregunta por cada objeto con su propio `search` en vez de listar la
   * carpeta entera: una lista paginada que no llegara hasta el objeto lo daria
   * por ido sin haberlo mirado, que es el mismo fallo silencioso al que esta
   * comprobacion viene a responder.
   */
  async function ningunoSigueEnElBucket(rutas: readonly string[]): Promise<boolean> {
    for (const ruta of rutas) {
      const corte = ruta.lastIndexOf("/");
      const carpeta = corte < 0 ? "" : ruta.slice(0, corte);
      const nombre = ruta.slice(corte + 1);
      const { data, error: listError } = await conTope(
        supabase.storage
          .from("verification-documents")
          .list(carpeta, { limit: 100, search: nombre }),
      );
      // Sin respuesta no hay evidencia de que el objeto se haya ido, y dar por
      // limpio lo que no se pudo comprobar es justo lo que no queremos repetir.
      if (listError || !data) return false;
      // `search` filtra por parecido, asi que el nombre se compara exacto.
      if (data.some((objeto) => objeto.name === nombre)) return false;
    }
    return true;
  }

  /**
   * Pide quitar una foto, pasando por la confirmacion si el tramite esta aprobado.
   *
   * El guard de `bloqueado` vive aqui y no en el trabajo de verdad porque
   * `bloqueado` incluye tener la confirmacion abierta: si estuviera dentro,
   * confirmar el borrado no haria nada.
   */
  function pedirBorradoDeFoto(clave: ClaveDocumento) {
    if (bloqueado) return;
    setError("");
    setNotice("");

    // Solo se puede borrar el archivo si quien lo referencia es la fila de
    // seller_verification: es la unica tabla que este componente escribe. El
    // boton no se pinta en los demas casos, asi que aqui solo queda callarse.
    if (!docsPropios[clave]) return;

    // Quitar una foto devuelve la fila a 'pending' —la policy del solicitante lo
    // exige—, o sea que una verificacion aprobada pierde su aprobacion. Eso se
    // pregunta, no se hace de callado al primer toque en la papelera.
    if (status === "approved") {
      setCambioPendiente({ destino: "foto", clave });
      return;
    }

    void borrarFotoYAvisar(clave);
  }

  async function borrarFotoYAvisar(clave: ClaveDocumento) {
    const resultado = await borrarFoto(clave);
    pintarResultado(resultado, "Eliminamos el documento. Vuelve a subirlo cuando quieras.");
  }

  /**
   * Quita una foto de la fila y luego del bucket.
   *
   * No pinta mensajes: los devuelve, para que quien llama elija UNO.
   */
  async function borrarFoto(clave: ClaveDocumento): Promise<ResultadoEscritura> {
    const ruta = docsPropios[clave];
    if (!ruta) return { aplicado: true, error: null, avisoAlmacenamiento: null };

    const filaId = filaIdRef.current;
    if (!filaId) return { aplicado: false, error: FILA_PERDIDA, avisoAlmacenamiento: null };

    setUploading(clave); // Reusamos el estado de uploading para bloquear el UI

    try {
      const soloEstaColumna: Database["public"]["Tables"]["seller_verification"]["Update"] =
        clave === "selfie"
          ? { selfie_url: null }
          : clave === "ine_front"
            ? { ine_front_url: null }
            : { ine_back_url: null };

      // Primero la referencia en la base. Si el borrado físico falla después,
      // solo queda un archivo huérfano en storage — nunca una URL rota en admin.
      //
      // El status vuelve a 'pending' porque la policy del solicitante exige que
      // la fila acabe asi: sin esa linea, quitar una foto de un tramite ya
      // resuelto lo rechazaba la RLS entera y la persona solo veia "no se pudo
      // eliminar", sin salida.
      //
      // El envoltorio async no es decoracion: el constructor de consultas de
      // Supabase es PromiseLike y no una Promise, asi que conTope no lo acepta
      // tal cual. Es el mismo patron que usa handleUpload.
      const { data: actualizada, error: dbError } = await conTope(
        (async () =>
          await supabase
            .from("seller_verification")
            .update({ ...soloEstaColumna, status: "pending" })
            .eq("id", filaId)
            .select("id"))(),
      );

      // Un UPDATE de 0 filas no es un error en PostgREST. Sin esta comprobacion
      // se borraria el archivo del bucket con la columna aun apuntandolo, que es
      // justo la URL rota en el panel de admin que el orden intenta evitar.
      if (dbError || !actualizada || actualizada.length === 0) {
        return {
          aplicado: false,
          error: "No se pudo eliminar el documento. Intenta de nuevo.",
          avisoAlmacenamiento: null,
        };
      }

      // La pantalla se pone al dia AQUI: con el UPDATE ya aplicado —que es el
      // punto de compromiso— y ANTES de tocar el bucket. Cuando estos reset
      // iban detras del .remove(), un borrado colgado en red movil saltaba al
      // catch sin ejecutarlos y, como `rutaEfectiva` da preferencia a la clave
      // local, la tarjeta se quedaba diciendo "Subido correctamente" para
      // siempre sobre una columna ya vacia: sin foto que analizar, sin IA y sin
      // que el admin pudiera aprobar nada, porque el trigger exige las tres URLs.
      setRutasLocales((prev) => ({ ...prev, [clave]: null }));
      olvidarVistaLocal([clave]);
      router.refresh();

      try {
        const limpio = await borrarDelBucket([rutaEnElBucket(ruta)]);
        return {
          aplicado: true,
          error: null,
          avisoAlmacenamiento: limpio
            ? null
            : "El documento se eliminó de tu perfil, pero el archivo no pudo borrarse del almacenamiento.",
        };
      } catch {
        // La base ya esta bien: esto es basura en el bucket, no un fracaso. El
        // texto no distingue tope de fallo de red porque para la persona lo
        // cierto es lo mismo, y decirle "no pudimos completar la solicitud"
        // sobre un borrado que SI se aplico seria falso.
        return {
          aplicado: true,
          error: null,
          avisoAlmacenamiento:
            "El documento se eliminó de tu perfil, pero no pudimos confirmar que el archivo se borrara del almacenamiento.",
        };
      }
    } catch (err) {
      // Aqui solo se llega si fallo el UPDATE: el borrado del bucket tiene su
      // propio catch justamente porque para entonces la base ya quedo bien.
      router.refresh();
      return {
        aplicado: false,
        error: mensajeDeExcepcion(
          err,
          "La solicitud tardó demasiado. Comprueba el estado antes de volver a intentarlo.",
        ),
        avisoAlmacenamiento: null,
      };
    } finally {
      setUploading(null);
    }
  }

  /**
   * Tira las tres fotos de este tramite, del bucket y de la base.
   *
   * Es el precio del cambio de tipo o de universidad: la revision coteja las
   * imagenes CONTRA el tipo declarado, asi que unas fotos de credencial
   * universitaria bajo un tramite que dice INE no las puede revisar nadie —ni
   * la IA ni el moderador—.
   */
  async function descartarDocumentos(
    tipoDestino: TipoDocumento,
    universidadDestino: string,
  ): Promise<ResultadoEscritura> {
    const rutas = CLAVES_DOCUMENTO
      .map((clave) => docsPropios[clave])
      .filter((ruta): ruta is string => Boolean(ruta))
      .map(rutaEnElBucket);

    if (rutas.length === 0) return { aplicado: true, error: null, avisoAlmacenamiento: null };

    const filaId = filaIdRef.current;
    if (!filaId) return { aplicado: false, error: FILA_PERDIDA, avisoAlmacenamiento: null };

    try {
      const { data: actualizada, error: dbError } = await conTope(
        (async () =>
          await supabase
            .from("seller_verification")
            .update({
              selfie_url: null,
              ine_front_url: null,
              ine_back_url: null,
              // Igual que al borrar una sola foto: sin el 'pending' la policy
              // rechaza el UPDATE completo en cuanto el tramite ya estaba
              // resuelto, y las fotos se quedarian donde estaban con el tipo ya
              // cambiado en pantalla.
              status: "pending",
              document_type: tipoDestino,
              university_name:
                tipoDestino === "Credencial Universitaria" ? universidadDestino : null,
            })
            .eq("id", filaId)
            .select("id"))(),
      );

      // Igual que al borrar una sola foto: 0 filas no es un error en PostgREST,
      // y seguir adelante borraria del bucket unos archivos que las columnas
      // siguen apuntando.
      if (dbError || !actualizada || actualizada.length === 0) {
        return {
          aplicado: false,
          error: "No pudimos eliminar tus imágenes. Intenta de nuevo.",
          avisoAlmacenamiento: null,
        };
      }

      // Igual que al borrar una sola foto: la pantalla se pone al dia con el
      // UPDATE ya aplicado y ANTES de tocar el bucket. Con los reset detras del
      // .remove(), un borrado colgado en red movil saltaba al catch sin
      // ejecutarlos y las tres tarjetas seguian diciendo "Subido correctamente"
      // sobre una fila vacia, con el tramite muerto: ni IA ni aprobacion posible.
      setRutasLocales({ selfie: null, ine_front: null, ine_back: null });
      olvidarVistaLocal(CLAVES_DOCUMENTO);
      router.refresh();

      try {
        const limpio = await borrarDelBucket(rutas);
        return {
          aplicado: true,
          error: null,
          avisoAlmacenamiento: limpio
            ? null
            : "Tus imágenes se quitaron de tu perfil, pero alguna no pudo borrarse del almacenamiento.",
        };
      } catch {
        // El UPDATE ya escribio el tipo, la universidad y las tres columnas en
        // null: la base manda, asi que esto es exito con basura en el bucket, no
        // el "no pudimos completar la solicitud" que se pintaba antes.
        return {
          aplicado: true,
          error: null,
          avisoAlmacenamiento:
            "Tus imágenes se quitaron de tu perfil, pero no pudimos confirmar que los archivos se borraran del almacenamiento.",
        };
      }
    } catch (err) {
      // Solo el fracaso del UPDATE llega hasta aqui, y es el unico caso en el
      // que el tipo en pantalla no se debe mover.
      router.refresh();
      return {
        aplicado: false,
        error: mensajeDeExcepcion(
          err,
          "La solicitud tardó demasiado. Recarga la pantalla antes de cambiar de documento.",
        ),
        avisoAlmacenamiento: null,
      };
    }
  }

  function pedirCambioDeTipo(nuevo: TipoDocumento) {
    if (bloqueado || nuevo === docType) return;
    setError("");
    setNotice("");
    // Sin fotos subidas no hay nada que destruir, asi que tampoco hay nada que
    // confirmar: una confirmacion que no cuesta nada solo ensena a ignorarlas.
    if (!haySubidasPropias) {
      setDocType(nuevo);
      return;
    }
    setCambioPendiente({ destino: "tipo", tipo: nuevo });
  }

  function pedirCambioDeUniversidad(nueva: string) {
    if (bloqueado || nueva === university) return;
    setError("");
    setNotice("");
    if (!haySubidasPropias) {
      setUniversity(nueva);
      return;
    }
    setCambioPendiente({ destino: "universidad", universidad: nueva });
  }

  async function confirmarCambio() {
    const cambio = cambioPendiente;
    if (!cambio || descartando) return;

    setError("");
    setNotice("");
    setDescartando(true);

    // El borrado de UNA foto tambien pasa por aqui cuando el tramite esta
    // aprobado: lo que se confirma es la perdida de la aprobacion.
    if (cambio.destino === "foto") {
      const resultado = await borrarFoto(cambio.clave);
      setDescartando(false);
      setCambioPendiente(null);
      pintarResultado(resultado, "Eliminamos el documento. Tu verificación volvió a revisión.");
      return;
    }

    const tipoDestino = cambio.destino === "tipo" ? cambio.tipo : docType;
    const universidadDestino =
      cambio.destino === "universidad" ? cambio.universidad : university;
    const resultado = await descartarDocumentos(tipoDestino, universidadDestino);
    setDescartando(false);

    // La confirmacion se cierra pase lo que pase: el aviso de error se pinta
    // DETRAS de ella, y dejarla abierta lo esconde justo cuando hay que leerlo.
    setCambioPendiente(null);

    // El tipo en pantalla sigue a la base, no al reves: en cuanto el UPDATE se
    // aplico la fila YA dice el tipo nuevo, y dejar el viejo en pantalla seria
    // mentir sobre lo que hay guardado. Solo se queda quieto cuando el UPDATE
    // no llego a aplicarse — un fallo del bucket despues no lo mueve.
    if (!resultado.aplicado) {
      pintarResultado(resultado, "");
      return;
    }

    if (cambio.destino === "tipo") {
      setDocType(cambio.tipo);
    } else {
      setUniversity(cambio.universidad);
    }
    pintarResultado(
      resultado,
      "Eliminamos tus imágenes. Vuelve a subirlas para completar tu verificación.",
    );
  }

  const statusIcon =
    status === "approved" ? (
      <CheckCircle className="h-5 w-5 text-[color:var(--fg)]" />
    ) : status === "pending" ? (
      <Clock className="h-5 w-5 text-orange-500" />
    ) : status === "rejected" ? (
      <XCircle className="h-5 w-5 text-[color:var(--danger)]" />
    ) : null;

  return (
    <div className="space-y-6">
      {status !== "none" && !isAnalyzing && (
        <div className="flex items-start sm:items-center gap-2 rounded-[var(--r-lg)] bg-[color:var(--sidebar-bg)] p-2 sm:p-3">
          <div className="shrink-0 mt-0.5 sm:mt-0">{statusIcon}</div>
          <span className="text-xs sm:text-sm font-medium">
            {status === "approved" && "Verificación aprobada automáticamente por IA"}
            {status === "pending" && "En revisión manual — espera la aprobación del admin"}
            {status === "rejected" && "Verificación rechazada — documento no válido"}
          </span>
        </div>
      )}

      {isAnalyzing && (
        <div className="flex items-center gap-2 rounded-[var(--r-lg)] bg-indigo-500/10 border border-indigo-500/20 p-3">
          <Bot className="h-5 w-5 text-indigo-500 animate-pulse" />
          <span className="text-sm font-medium text-indigo-500">
            Analizando documento con Inteligencia Artificial...
          </span>
        </div>
      )}

      {/* Consentimiento expreso para datos biometricos.
          Va ARRIBA de las tarjetas de subida y no debajo: es la condicion para
          subir, no una nota al pie. */}
      {!yaConsintio && (
        <div className="rounded-[var(--r-lg)] border border-border bg-card p-4">
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={consiente}
              disabled={guardandoConsentimiento}
              onChange={async (e) => {
                if (!e.target.checked) {
                  setConsiente(false);
                  return;
                }
                setError("");
                setGuardandoConsentimiento(true);
                const r = await registrarConsentimientoBiometrico();
                setGuardandoConsentimiento(false);
                if (r.error) {
                  // No se marca la casilla si no quedo constancia: una casilla
                  // marcada sin fila en la base es justo lo que no acredita nada.
                  setError(r.error);
                  return;
                }
                setConsiente(true);
              }}
              className="mt-0.5 h-4 w-4 shrink-0 accent-[color:var(--brand)]"
            />
            <span className="text-sm text-[color:var(--fg-dim)]">
              Autorizo a VICINO a tratar mi <strong>selfie</strong> como dato
              biométrico con el único fin de verificar mi identidad, conforme al{" "}
              {/* El `stopPropagation` no es de adorno: este boton vive dentro
                  del <label> de la casilla, y sin el, el clic podia llegar al
                  control y registrar —o revocar— el consentimiento biometrico
                  de alguien que solo queria leer el aviso. */}
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setAvisoAbierto(true);
                }}
                className="underline text-[color:var(--brand-hi)]"
              >
                Aviso de Privacidad
              </button>{" "}
              (versión {AVISO_PRIVACIDAD_VERSION}). Sé que puedo revocar este
              consentimiento y que los documentos se eliminan a los 90 días.
              {guardandoConsentimiento && (
                <span className="ml-2 text-xs opacity-70">Guardando…</span>
              )}
            </span>
          </label>
        </div>
      )}

      {/* Quien ya consintio no vuelve a ver la casilla, y con ella desaparecia
          el unico acceso al aviso desde esta pantalla. El texto legal tiene que
          seguir a mano mientras se suben los documentos, no solo el dia que se
          acepto. */}
      {yaConsintio && (
        <p className="text-xs text-[color:var(--fg-dim)]">
          Tus documentos se tratan conforme al{" "}
          <button
            type="button"
            onClick={() => setAvisoAbierto(true)}
            className="underline text-[color:var(--brand-hi)]"
          >
            Aviso de Privacidad
          </button>{" "}
          (versión {AVISO_PRIVACIDAD_VERSION}) y se eliminan a los 90 días.
        </p>
      )}

      {error && (
        <div className="rounded-[var(--r-lg)] bg-[color:var(--danger)]/10 p-3 text-sm text-[color:var(--danger)]">
          {error}
        </div>
      )}
      {notice && <p role="status" className="text-sm text-[color:var(--fg)]">{notice}</p>}

      <div className="space-y-4">
        <p className="text-sm font-medium">Tipo de documento</p>
        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => pedirCambioDeTipo("INE")}
            disabled={bloqueado}
            aria-pressed={docType === "INE"}
            className={`flex flex-col items-center gap-2 rounded-[var(--r-xl)] border-2 p-4 transition-all ${
              docType === "INE"
                ? "border-indigo-500 bg-indigo-500/10 shadow-md shadow-indigo-500/10"
                : "border-transparent bg-[color:var(--sidebar-bg)] hover:opacity-80"
            } disabled:opacity-50`}
          >
            <span className="text-3xl">🪪</span>
            <span className="text-sm font-semibold">INE Oficial</span>
          </button>
          <button
            type="button"
            onClick={() => pedirCambioDeTipo("Credencial Universitaria")}
            disabled={bloqueado}
            aria-pressed={docType === "Credencial Universitaria"}
            className={`flex flex-col items-center gap-2 rounded-[var(--r-xl)] border-2 p-4 transition-all disabled:opacity-50 ${
              docType !== "Credencial Universitaria"
                ? "border-transparent bg-[color:var(--sidebar-bg)] hover:opacity-80"
                : ""
            }`}
            style={docType === "Credencial Universitaria" ? {
              borderColor: UNIVERSITY_COLORS[university] || "#0ea5e9",
              backgroundColor: UNIVERSITY_COLORS[university] || "#0ea5e9",
              boxShadow: `0 4px 6px -1px ${UNIVERSITY_COLORS[university] || "#0ea5e9"}66`
            } : undefined}
          >
            <span className="text-3xl">🎓</span>
            <span className="text-sm font-semibold" style={docType === "Credencial Universitaria" ? { color: getContrastYIQ(UNIVERSITY_COLORS[university] || "#0ea5e9") } : undefined}>Credencial Universitaria</span>
          </button>
        </div>

        {docType === "Credencial Universitaria" && (
          <div className="rounded-[var(--r-xl)] bg-[color:var(--sidebar-bg)] p-4">
            <label className="block text-sm font-medium mb-2">Selecciona tu Universidad</label>
            {/* El valor lo manda `university`, no el DOM: si el cambio se
                cancela en la confirmacion, React repinta la universidad
                anterior y el desplegable no se queda mostrando un destino que
                nunca se aplico. */}
            <select
              value={university}
              onChange={(e) => pedirCambioDeUniversidad(e.target.value)}
              disabled={bloqueado}
              className="w-full rounded-md border border-[color:var(--border)] bg-[color:var(--bg-elev-1)] px-3 py-2 text-sm"
            >
              {UNIVERSITIES.map(u => (
                <option key={u} value={u}>{u}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div className="space-y-4">
        {getDocsConfig().map(({ key, label, accept }) => {
          // El estado de la ranura sale SOLO de la fila de este tramite. El
          // respaldo de trust_level_verification se previsualiza, pero no cuenta
          // como subido ni saca papelera: cuando entraba por un `??`, descartar
          // las fotos lo reactivaba y la tarjeta volvia a decir "Subido
          // correctamente" de una imagen que esta pantalla no puede ni borrar.
          const subido = Boolean(docsPropios[key]);
          const soloRespaldo = !subido && Boolean(docsDeRespaldo[key]);
          return (
          <div key={key} className="rounded-[var(--r-xl)] bg-[color:var(--sidebar-bg)] p-4 overflow-hidden">
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0 flex-1">
                <p className="font-medium text-sm">{label}</p>
                {uploading === key ? (
                  <p className="text-xs text-indigo-400 animate-pulse">Procesando...</p>
                ) : subido ? (
                  <p className="text-xs text-[color:var(--fg)]">Subido correctamente</p>
                ) : (
                  <p className="text-xs text-[color:var(--danger)]">Documento requerido</p>
                )}
                {soloRespaldo && (
                  <p className="mt-1 text-xs text-[color:var(--fg-dim)]">
                    Esta foto es de una verificación anterior: no cuenta para
                    este trámite y no se puede eliminar desde aquí. Sube una
                    nueva para reemplazarla.
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {subido && (
                  <button
                    onClick={() => pedirBorradoDeFoto(key)}
                    disabled={bloqueado}
                    className="inline-flex items-center justify-center h-9 w-9 rounded-full bg-[color:var(--danger)] text-white hover:opacity-80 transition-opacity disabled:opacity-50"
                    title="Eliminar"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
                {/* Botón Galería */}
                <label className="cursor-pointer">
                  <input
                    type="file"
                    id={`file-upload-${key}`}
                    accept={accept}
                    className="hidden"
                    onChange={(e) => {
                      // El input se limpia ANTES de subir: si se queda con el
                      // valor puesto, reintentar con el MISMO archivo tras un
                      // error no dispara onChange en casi ningun navegador y la
                      // pantalla se queda con el error y sin responder.
                      const file = e.target.files?.[0];
                      e.target.value = "";
                      if (file) void handleUpload(key, file);
                    }}
                    disabled={bloqueado}
                  />
                  <span className="inline-flex flex-col items-center justify-center h-9 w-9 rounded-full bg-[color:var(--fg)] text-[color:var(--bg)] hover:opacity-80 transition-colors cursor-pointer" title="Galería">
                    <ImagePlus className="h-4 w-4" />
                  </span>
                </label>
                {/* Botón Cámara */}
                <label className="cursor-pointer">
                  <input
                    type="file"
                    id={`file-camera-${key}`}
                    accept="image/*"
                    capture={key === "selfie" ? "user" : "environment"}
                    className="hidden"
                    onChange={(e) => {
                      // Igual que en el de galeria: el valor se limpia antes de
                      // subir para que repetir la misma foto vuelva a disparar.
                      const file = e.target.files?.[0];
                      e.target.value = "";
                      if (file) void handleUpload(key, file);
                    }}
                    disabled={bloqueado}
                  />
                  <span className="inline-flex flex-col items-center justify-center h-9 w-9 rounded-full bg-[color:var(--fg)] text-[color:var(--bg)] hover:opacity-80 transition-colors cursor-pointer" title="Cámara">
                    <Camera className="h-4 w-4" />
                  </span>
                </label>
              </div>
            </div>

            {previews[key] && (
              <div className="mt-4 w-full h-40 rounded-lg overflow-hidden border border-[color:var(--border)] relative bg-[color:var(--bg-elev-1)]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img 
                  src={previews[key]!} 
                  alt={`Preview ${label}`}
                  className="w-full h-full object-contain"
                />
              </div>
            )}
          </div>
          );
        })}
      </div>

      {cambioPendiente && (
        <ConfirmacionDeCambio
          titulo={
            cambioPendiente.destino === "foto"
              ? "¿Estás seguro que quieres eliminar esta foto?"
              : `¿Estás seguro que quieres cambiar a ${
                  cambioPendiente.destino === "tipo"
                    ? NOMBRE_DEL_TIPO[cambioPendiente.tipo]
                    : cambioPendiente.universidad
                }?`
          }
          cuerpo={
            cambioPendiente.destino === "foto"
              ? "Tendrás que volver a subirla para completar tu verificación."
              : "Al hacerlo, eliminarás tus imágenes subidas y tendrás que volver a subirlas."
          }
          // Quien ya esta aprobado tiene derecho a saber que pierde eso tambien,
          // no solo las fotos: la fila vuelve a revision al quedarse sin
          // documentos —lo exige la policy del solicitante—, y con ella se va el
          // acceso al feed de su universidad. Vale igual para una sola foto, que
          // es justo lo que la papelera hacia sin preguntar.
          advertenciaExtra={
            status === "approved"
              ? "Tu verificación aprobada volverá a revisión."
              : null
          }
          textoConfirmar={
            cambioPendiente.destino === "foto"
              ? "Sí, eliminar la foto"
              : "Sí, eliminar y cambiar"
          }
          procesando={descartando}
          onCancelar={() => setCambioPendiente(null)}
          onConfirmar={confirmarCambio}
        />
      )}

      <AvisoPrivacidadModal
        open={avisoAbierto}
        onClose={() => setAvisoAbierto(false)}
      />
    </div>
  );
}

interface ConfirmacionDeCambioProps {
  /** La pregunta. Ya nombra el destino: "INE oficial", "Universidad Iberoamericana", una foto… */
  titulo: string;
  /** Que se pierde al aceptar. */
  cuerpo: string;
  advertenciaExtra: string | null;
  /** El texto del boton que destruye. */
  textoConfirmar: string;
  procesando: boolean;
  onCancelar: () => void;
  onConfirmar: () => void;
}

/** Lo enfocable de dentro del dialogo, en orden de tabulacion. */
const SELECTOR_ENFOCABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * La confirmacion antes de tirar fotos ya subidas: las tres al cambiar de tipo
 * o de universidad, o una sola cuando quitarla degrada una verificacion
 * aprobada.
 *
 * Solo se monta cuando hay algo pendiente, y de ahi que el foco y el bloqueo de
 * desplazamiento vivan en el montaje: asi el teclado entra en "Cancelar" —la
 * salida segura— y no en el boton que destruye. El texto viaja por props porque
 * lo que se pierde no es lo mismo en los dos casos.
 */
function ConfirmacionDeCambio({
  titulo,
  cuerpo,
  advertenciaExtra,
  textoConfirmar,
  procesando,
  onCancelar,
  onConfirmar,
}: ConfirmacionDeCambioProps) {
  const cancelarRef = useRef<HTMLButtonElement>(null);
  const dialogoRef = useRef<HTMLDivElement>(null);

  useBodyScrollLock(true);

  useEffect(() => {
    cancelarRef.current?.focus();
  }, []);

  useEffect(() => {
    function alPulsarTecla(evento: KeyboardEvent) {
      // Ni Escape ni el boton atras del APK cierran a mitad del borrado: las
      // imagenes y la fila se estan quedando descoordinadas en ese instante, y
      // devolver la pantalla ahi deja el tipo viejo con las fotos ya borradas.
      if (evento.key === "Escape" && !procesando) {
        onCancelar();
        return;
      }

      // El foco no sale del dialogo. Sin esto, el Tab desde "Sí, eliminar y
      // cambiar" llegaba a los botones de tipo de detras y un Enter ahi
      // cambiaba el DESTINO del dialogo que la persona tenia abierto delante.
      if (evento.key !== "Tab") return;
      const dialogo = dialogoRef.current;
      if (!dialogo) return;
      const enfocables = Array.from(dialogo.querySelectorAll<HTMLElement>(SELECTOR_ENFOCABLE));
      const primero = enfocables[0];
      const ultimo = enfocables[enfocables.length - 1];
      // Mientras se borra, los dos botones estan deshabilitados y no queda nada
      // enfocable: el Tab no tiene a donde ir dentro, asi que se queda quieto.
      if (!primero || !ultimo) {
        evento.preventDefault();
        return;
      }
      const activo = document.activeElement;
      const dentro = dialogo.contains(activo);
      if (evento.shiftKey) {
        if (!dentro || activo === primero) {
          evento.preventDefault();
          ultimo.focus();
        }
        return;
      }
      if (!dentro || activo === ultimo) {
        evento.preventDefault();
        primero.focus();
      }
    }
    document.addEventListener("keydown", alPulsarTecla);
    return () => document.removeEventListener("keydown", alPulsarTecla);
  }, [onCancelar, procesando]);

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center p-4"
      data-modal-open="true"
    >
      <button
        type="button"
        aria-label="Cancelar el cambio"
        tabIndex={-1}
        onClick={() => {
          if (!procesando) onCancelar();
        }}
        className="absolute inset-0 cursor-default bg-black/60"
      />
      <div
        ref={dialogoRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="titulo-cambio-documento"
        className="relative w-full max-w-sm rounded-[var(--r-lg)] border border-border bg-card p-5 shadow-[var(--shadow-lg)]"
      >
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-[color:var(--danger)]" />
          <div className="min-w-0">
            <h2
              id="titulo-cambio-documento"
              className="text-sm font-semibold text-fg"
            >
              {titulo}
            </h2>
            <p className="mt-2 text-sm text-[color:var(--fg-dim)]">{cuerpo}</p>
            {advertenciaExtra && (
              <p className="mt-2 text-sm text-[color:var(--fg-dim)]">
                {advertenciaExtra}
              </p>
            )}
          </div>
        </div>

        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            ref={cancelarRef}
            type="button"
            onClick={onCancelar}
            disabled={procesando}
            className="rounded-[var(--r-lg)] border border-border px-4 py-2 text-sm font-medium text-fg hover:bg-card-2 disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={onConfirmar}
            disabled={procesando}
            className="rounded-[var(--r-lg)] bg-[color:var(--danger)] px-4 py-2 text-sm font-semibold text-white hover:opacity-80 disabled:opacity-50"
          >
            {procesando ? "Eliminando…" : textoConfirmar}
          </button>
        </div>
      </div>
    </div>
  );
}
