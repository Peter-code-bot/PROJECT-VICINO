/**
 * Estado del permiso de ubicación, leído SIN mostrar ningún diálogo (PDF 04:
 * consultar el estado al entrar o regresar, antes de intentar obtener la
 * ubicación). Todavía no lo usa ninguna pantalla: la experiencia de cada
 * estado (textos, botón de Ajustes) es decisión de diseño.
 *
 * Fuentes:
 * - Nativo (Android/iOS), con el plugin @capacitor/geolocation en el binario:
 *   Geolocation.checkPermissions().
 * - Web: navigator.permissions.query({ name: "geolocation" }), que además avisa
 *   de los cambios (evento `change`).
 * - Nativo SIN plugin (un binario viejo): «desconocido». No se consulta
 *   navigator.permissions: dentro de la WebView refleja el permiso del origen,
 *   que Capacitor concede sin recordarlo (retain=false), y no el de la app
 *   (INFERIDO; se comprueba con chrome://inspect).
 *
 * Limitaciones conocidas (no son fallos de este módulo):
 * - Android solo sabe que un permiso está «denied» o «prompt-with-rationale»
 *   por una caché que Capacitor escribe cuando el permiso se PIDE con el plugin
 *   (Bridge.java, validatePermissions). Hoy todas las peticiones van por
 *   navigator.geolocation dentro de la WebView, que no pasa por ahí: tras una
 *   negativa, incluso «no volver a preguntar», checkPermissions sigue diciendo
 *   «prompt». O sea: «sin-preguntar» no garantiza que nunca se preguntó, y
 *   «denegado» puede estar viejo si el permiso se cambió desde Ajustes.
 * - iOS devuelve lo mismo en location y coarseLocation y no expone la
 *   precisión reducida: allí la precisión es «desconocida». Un «Permitir una
 *   vez» se ve como concedido mientras dure; que caducó se deduce de la
 *   transición concedido → sin-preguntar al volver, no se puede leer.
 * - Web tampoco distingue la precisión.
 *
 * Las dependencias se inyectan (los plugins de Capacitor no se importan aquí)
 * para poder probarlo sin @capacitor/* y para que nada se cargue en web.
 */
import type { AppPlugin } from "@capacitor/app";
import type { PermissionState } from "@capacitor/core";
import type { GeolocationPlugin } from "@capacitor/geolocation";

export type PrecisionUbicacion = "precisa" | "aproximada" | "desconocida";

export type EstadoPermisoUbicacion =
  /** El dispositivo o el navegador no pueden dar ubicación. */
  | { readonly estado: "no-disponible" }
  /** No se pudo leer (todavía, o esta plataforma no lo permite). */
  | { readonly estado: "desconocido" }
  /** Se puede pedir. `yaNegoUnaVez`: Android dice que conviene explicar antes de volver a pedir. */
  | { readonly estado: "sin-preguntar"; readonly yaNegoUnaVez: boolean }
  | { readonly estado: "concedido"; readonly precision: PrecisionUbicacion }
  | { readonly estado: "denegado" }
  /** El permiso no importa: la ubicación del teléfono está apagada. */
  | { readonly estado: "servicios-apagados" }
  | { readonly estado: "error" };

/** Lo mismo en el servidor y al hidratar: nunca se sabe el estado antes de montar. */
export const ESTADO_PERMISO_INICIAL: EstadoPermisoUbicacion = Object.freeze({ estado: "desconocido" });
const NO_DISPONIBLE: EstadoPermisoUbicacion = Object.freeze({ estado: "no-disponible" });
const DENEGADO: EstadoPermisoUbicacion = Object.freeze({ estado: "denegado" });
const SERVICIOS_APAGADOS: EstadoPermisoUbicacion = Object.freeze({ estado: "servicios-apagados" });
const ERROR: EstadoPermisoUbicacion = Object.freeze({ estado: "error" });

/** El mismo techo que la espera inicial de pausa-en-segundo-plano.ts. */
export const TIEMPO_MAXIMO_LECTURA_MS = 2000;
/** Al volver llegan casi juntos visibilitychange, 'resume' y appStateChange. */
export const VENTANA_AGRUPAR_MS = 150;
/** Para pedir en web: el diálogo no cuenta, el reloj empieza al conceder. */
export const TIEMPO_MAXIMO_PEDIR_MS = 15000;
/** Android e iOS: «Location services are not enabled.» (GeolocationErrors.kt, GeolocationError.swift). */
export const CODIGO_SERVICIOS_APAGADOS = "OS-PLUG-GLOC-0007";

type PluginGeolocalizacion = Pick<GeolocationPlugin, "checkPermissions" | "requestPermissions">;

/**
 * El plugin viaja DENTRO de un objeto, nunca como valor de resolución directo:
 * los plugins de Capacitor son Proxy y responden a `then`, así que resolver una
 * promesa con el plugin la deja colgada para siempre (pausa-en-segundo-plano.ts).
 */
export interface PuenteGeolocalizacion { readonly geo: PluginGeolocalizacion }
export interface PuenteApp { readonly app: Pick<AppPlugin, "addListener"> }

export interface DependenciasPermiso {
  esNativo(): boolean;
  /**
   * Capacitor.isPluginAvailable("Geolocation"). Solo cuenta junto a esNativo():
   * en web da true en cuanto alguien importa el plugin, porque trae una
   * implementación web.
   */
  pluginDisponible(): boolean;
  plataforma(): string;
  cargarPlugin(): Promise<PuenteGeolocalizacion>;
  permisosWeb(): Pick<Permissions, "query"> | undefined;
  geolocWeb(): Pick<Geolocation, "getCurrentPosition"> | undefined;
  tiempoMaximoMs?: number;
}

export interface EntornoPermiso extends DependenciasPermiso {
  documento: Pick<Document, "addEventListener" | "removeEventListener" | "visibilityState">;
  cargarApp(): Promise<PuenteApp>;
  /** Programa `fn` y devuelve cómo cancelarla. Por defecto, setTimeout. */
  programar?(fn: () => void, ms: number): () => void;
}

const ESTADOS_CAPACITOR: readonly PermissionState[] = ["prompt", "prompt-with-rationale", "granted", "denied"];
function esEstadoCapacitor(valor: unknown): valor is PermissionState {
  return typeof valor === "string" && (ESTADOS_CAPACITOR as readonly string[]).includes(valor);
}

/**
 * checkPermissions/requestPermissions del plugin → estado.
 * En Android `location` agrupa FINE+COARSE y `coarseLocation` solo COARSE:
 * con `location` concedido es precisa; con solo `coarseLocation`, aproximada.
 */
export function traducirPermisosNativos(permisos: unknown, plataforma: string): EstadoPermisoUbicacion {
  if (!permisos || typeof permisos !== "object") return ESTADO_PERMISO_INICIAL;
  const { location, coarseLocation } = permisos as Record<string, unknown>;
  if (!esEstadoCapacitor(location) || !esEstadoCapacitor(coarseLocation)) return ESTADO_PERMISO_INICIAL;
  const android = plataforma === "android";
  if (location === "granted") return { estado: "concedido", precision: android ? "precisa" : "desconocida" };
  if (coarseLocation === "granted") return { estado: "concedido", precision: android ? "aproximada" : "desconocida" };
  if (location === "denied" || coarseLocation === "denied") return DENEGADO;
  return { estado: "sin-preguntar", yaNegoUnaVez: location === "prompt-with-rationale" || coarseLocation === "prompt-with-rationale" };
}

/** Un error del plugin: servicios apagados (por código, o por mensaje de respaldo) o error. */
export function traducirErrorNativo(error: unknown): EstadoPermisoUbicacion {
  const datos = typeof error === "object" && error !== null ? error as { code?: unknown; message?: unknown } : {};
  if (datos.code === CODIGO_SERVICIOS_APAGADOS) return SERVICIOS_APAGADOS;
  if (typeof datos.message === "string" && /location services are not enabled/i.test(datos.message)) return SERVICIOS_APAGADOS;
  return ERROR;
}

/** PermissionStatus.state de la web → estado. */
export function traducirPermisoWeb(estado: unknown): EstadoPermisoUbicacion {
  if (estado === "granted") return { estado: "concedido", precision: "desconocida" };
  if (estado === "denied") return DENEGADO;
  if (estado === "prompt") return { estado: "sin-preguntar", yaNegoUnaVez: false };
  return ESTADO_PERMISO_INICIAL;
}

const PLAZO_VENCIDO = Symbol("plazo-vencido");

function conPlazo<T>(promesa: Promise<T>, ms: number): Promise<T | typeof PLAZO_VENCIDO> {
  let temporizador: ReturnType<typeof setTimeout> | undefined;
  const limite = new Promise<typeof PLAZO_VENCIDO>((resolver) => {
    temporizador = setTimeout(() => resolver(PLAZO_VENCIDO), ms);
  });
  return Promise.race([promesa, limite]).finally(() => clearTimeout(temporizador));
}

/** Lee el estado sin pedir nada. Nunca lanza; un puente colgado da «desconocido». */
export async function leerPermisoUbicacion(deps: DependenciasPermiso): Promise<EstadoPermisoUbicacion> {
  const plazo = deps.tiempoMaximoMs ?? TIEMPO_MAXIMO_LECTURA_MS;
  if (deps.esNativo()) {
    if (!deps.pluginDisponible()) return ESTADO_PERMISO_INICIAL;
    try {
      const permisos = await conPlazo((async () => {
        const { geo } = await deps.cargarPlugin();
        return geo.checkPermissions();
      })(), plazo);
      return permisos === PLAZO_VENCIDO ? ESTADO_PERMISO_INICIAL : traducirPermisosNativos(permisos, deps.plataforma());
    } catch (error) {
      return traducirErrorNativo(error);
    }
  }
  if (!deps.geolocWeb()) return NO_DISPONIBLE;
  const permisos = deps.permisosWeb();
  if (!permisos || typeof permisos.query !== "function") return ESTADO_PERMISO_INICIAL;
  try {
    const estado = await conPlazo(permisos.query({ name: "geolocation" }), plazo);
    return estado === PLAZO_VENCIDO ? ESTADO_PERMISO_INICIAL : traducirPermisoWeb(estado.state);
  } catch {
    // Navegadores que no reconocen "geolocation" en la Permissions API.
    return ESTADO_PERMISO_INICIAL;
  }
}

type RespuestaDialogoWeb = "concedido" | "denegado" | "otro";

function pedirConPosicion(geoloc: Pick<Geolocation, "getCurrentPosition">): Promise<RespuestaDialogoWeb> {
  return new Promise((resolver) => {
    try {
      geoloc.getCurrentPosition(
        // Las coordenadas se DESCARTAN: aquí solo se pide el permiso. Ni
        // cookie, ni espejo, ni valor de retorno.
        () => resolver("concedido"),
        (error) => resolver(error?.code === 1 ? "denegado" : "otro"),
        { enableHighAccuracy: false, timeout: TIEMPO_MAXIMO_PEDIR_MS, maximumAge: Number.POSITIVE_INFINITY },
      );
    } catch {
      resolver("otro");
    }
  });
}

/**
 * Pide el permiso del sistema. LLAMAR SOLO DESDE UN GESTO DE LA PERSONA, nunca
 * al montar ni al abrir la app (mismo criterio que pedirPermisoPush): un
 * diálogo que nadie pidió recibe «No permitir», y en iOS eso no se deshace
 * desde la app. Todavía no está conectado a ninguna pantalla.
 *
 * - Nativo con plugin: requestPermissions({ permissions: ["location"] }). El
 *   alias `location` y no `coarseLocation`, para que Android 12+ ofrezca
 *   Precisa y Aproximada. Se llama aunque la última lectura dijera «denegado»:
 *   en Android es justo esta llamada la que refresca la caché del estado, y si
 *   el sistema ya no muestra el diálogo, contesta «denied» sin más.
 * - Web (requestPermissions no existe ahí) o nativo sin plugin: una petición
 *   de posición saca el diálogo; la posición se descarta y se relee el estado.
 */
export async function pedirPermisoUbicacion(deps: DependenciasPermiso): Promise<EstadoPermisoUbicacion> {
  if (deps.esNativo() && deps.pluginDisponible()) {
    try {
      const { geo } = await deps.cargarPlugin();
      return traducirPermisosNativos(await geo.requestPermissions({ permissions: ["location"] }), deps.plataforma());
    } catch (error) {
      return traducirErrorNativo(error);
    }
  }
  const geoloc = deps.geolocWeb();
  if (!geoloc) return NO_DISPONIBLE;
  const respuesta = await pedirConPosicion(geoloc);
  const releido = await leerPermisoUbicacion(deps);
  if (releido.estado !== "desconocido") return releido;
  if (respuesta === "concedido") return { estado: "concedido", precision: "desconocida" };
  return respuesta === "denegado" ? DENEGADO : ESTADO_PERMISO_INICIAL;
}

const programarConTemporizador = (fn: () => void, ms: number) => {
  const temporizador = setTimeout(fn, ms);
  return () => clearTimeout(temporizador);
};

export interface ObservadorPermiso {
  /** Quita todos los oyentes y cancela la lectura programada. */
  detener(): void;
  /**
   * Registra un estado sabido por otra vía (la respuesta de
   * pedirPermisoUbicacion): gana a cualquier lectura que ya estuviera en curso.
   */
  anotar(estado: EstadoPermisoUbicacion): void;
}

/**
 * Lee el estado al montar y lo vuelve a leer al regresar a la app:
 * visibilitychange (visible), el evento 'resume' que Capacitor dispara en
 * document, y appStateChange con isActive (mismo patrón que
 * usePushNotifications y pausa-en-segundo-plano). En web, además, escucha el
 * `change` del PermissionStatus.
 *
 * Las lecturas que llegan casi juntas se agrupan en una, y una lectura vieja
 * nunca pisa a una más nueva (contador de generación).
 */
export function observarPermisoUbicacion(
  entorno: EntornoPermiso,
  alCambiar: (estado: EstadoPermisoUbicacion) => void,
): ObservadorPermiso {
  const programar = entorno.programar ?? programarConTemporizador;
  let activo = true;
  let generacion = 0;
  let cancelarPendiente: (() => void) | null = null;
  let limpiezas: ReadonlyArray<() => void> = [];
  const alLimpiar = (limpiar: () => void) => { limpiezas = [...limpiezas, limpiar]; };

  const leer = async () => {
    const mia = ++generacion;
    const estado = await leerPermisoUbicacion(entorno);
    if (activo && mia === generacion) alCambiar(estado);
  };
  /** Un estado más nuevo que cualquier lectura en curso. */
  const anotar = (estado: EstadoPermisoUbicacion) => {
    if (!activo) return;
    generacion++;
    alCambiar(estado);
  };
  const solicitar = () => {
    if (!activo || cancelarPendiente) return;
    cancelarPendiente = programar(() => {
      cancelarPendiente = null;
      void leer();
    }, VENTANA_AGRUPAR_MS);
  };

  const alCambiarVisibilidad = () => {
    if (entorno.documento.visibilityState === "visible") solicitar();
  };
  entorno.documento.addEventListener("visibilitychange", alCambiarVisibilidad);
  entorno.documento.addEventListener("resume", solicitar);
  alLimpiar(() => {
    entorno.documento.removeEventListener("visibilitychange", alCambiarVisibilidad);
    entorno.documento.removeEventListener("resume", solicitar);
  });

  if (entorno.esNativo()) {
    void entorno.cargarApp().then(async ({ app }) => {
      if (!activo) return;
      const handle = await app.addListener("appStateChange", ({ isActive }) => {
        if (isActive) solicitar();
      });
      // La limpieza pudo correr mientras se instalaba.
      if (!activo) {
        await handle.remove();
        return;
      }
      alLimpiar(() => { void handle.remove().catch(() => {}); });
    }).catch(() => {
      // Sin el plugin App quedan visibilitychange y 'resume'.
    });
  } else {
    const permisos = entorno.permisosWeb();
    if (entorno.geolocWeb() && permisos && typeof permisos.query === "function") {
      void permisos.query({ name: "geolocation" }).then((estadoWeb) => {
        if (!activo || typeof estadoWeb.addEventListener !== "function") return;
        const alCambiarPermiso = () => anotar(traducirPermisoWeb(estadoWeb.state));
        estadoWeb.addEventListener("change", alCambiarPermiso);
        alLimpiar(() => estadoWeb.removeEventListener("change", alCambiarPermiso));
      }).catch(() => {
        // Sin avisos de cambio: quedan las relecturas al volver.
      });
    }
  }

  solicitar();

  const detener = () => {
    activo = false;
    generacion++;
    cancelarPendiente?.();
    cancelarPendiente = null;
    const pendientes = limpiezas;
    limpiezas = [];
    for (const limpiar of pendientes) {
      try {
        limpiar();
      } catch {
        // Una limpieza que falla no impide las demás.
      }
    }
  };
  return { detener, anotar };
}
