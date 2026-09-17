import { useEffect, useRef } from "react";
import { Capacitor, type PluginListenerHandle, type PermissionState } from "@capacitor/core";
import { App } from "@capacitor/app";
import { PushNotifications, Token, PushNotificationSchema, ActionPerformed } from "@capacitor/push-notifications";
import { createClient } from "@/lib/supabase/client";
import * as Sentry from "@sentry/nextjs";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { FCM_TOKEN_DEEP_LINK_PREFIX } from "@/lib/auth/deep-link-constants";
import { destinoSeguro } from "@/lib/auth/destino-seguro";

/**
 * El enlace que trae una notificacion, SOLO si se puede navegar a el.
 *
 * `notification.data` cruza el puente nativo sin tipo ninguno: es lo que FCM
 * entrego, y lo que FCM entrego es lo que le mando quien consiguiera disparar
 * send-push. Hoy lo emite send-push con rutas nuestras, pero `data.url` se
 * pasaba tal cual a router.push(): una cadena cualquiera ahi —"https://otro",
 * "//otro" (que el navegador lee como otro dominio) o un numero— convierte un
 * aviso en un desvio con la barra de VICINO puesta, y ademas no es una cadena
 * hasta que alguien lo comprueba.
 *
 * Se reutiliza destinoSeguro, que es la guarda que ya esta probada para esto y
 * conoce las tres trampas (barras dobles, barra invertida, caracteres de
 * control que el navegador tira despues). La diferencia es que aqui un enlace
 * descartado NO degrada al inicio: devuelve null y la notificacion se queda sin
 * boton. Un aviso cuyo enlace hubo que tirar no tiene por que mover a nadie de
 * donde esta.
 */
function rutaInternaDePush(data: unknown): string | null {
  if (typeof data !== "object" || data === null) return null;
  const url = (data as { url?: unknown }).url;
  if (typeof url !== "string") return null;
  return destinoSeguro(url) === url ? url : null;
}

/**
 * Guarda el token de push en profiles.fcm_token con reintentos.
 * La sesion auth puede no estar lista cuando iOS devuelve el token
 * (race entre el bridge de Capacitor y la cookie de Supabase).
 */
async function saveTokenToProfile(tokenValue: string, retries = 3) {
  const supabase = createClient();
  let lastError: Error | null = null;
  let lastContext: { code: string | null; details: string | null; hint: string | null } = {
    code: null,
    details: null,
    hint: null,
  };
  for (let i = 0; i < retries; i++) {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user) {
      // Un UPDATE de 0 filas no es error en PostgREST (204 sin cuerpo): sin
      // .select() un perfil inexistente o una fila filtrada por la policy
      // pasaria como exito y el usuario dejaria de recibir push en silencio.
      // Pedimos "id" y no "*" a proposito: authenticated tiene GRANT de SELECT
      // sobre id, pero NO sobre fcm_token, asi que un .select() a secas daria
      // 42501 en cada guardado.
      const { data, error } = await supabase
        .from("profiles")
        .update({ fcm_token: tokenValue })
        .eq("id", session.user.id)
        .select("id");
      if (!error && data && data.length > 0) {
        console.log("Push token saved to profile successfully");
        return;
      }
      lastError = error ?? new Error("El UPDATE de fcm_token afecto 0 filas");
      lastContext = error
        ? { code: error.code, details: error.details, hint: error.hint }
        : { code: null, details: null, hint: "0 filas: el perfil no existe o la policy de UPDATE lo filtro" };
      console.error("Error saving push token:", lastError.message);
    }
    // Esperar 1s antes de reintentar (sesion puede no estar lista)
    if (i < retries - 1) {
      await new Promise(r => setTimeout(r, 1000));
    }
  }
  // "No hubo sesion activa" NO es un error, y reportarlo como tal enterraba la
  // senal de verdad.
  //
  // El hook vive en el layout raiz, o sea que tambien se monta en /login. Tras
  // cerrar sesion —y en cada arranque en frio sobre /login— el permiso sigue
  // concedido, el registro devolvia su token y esta funcion gastaba sus tres
  // reintentos contra una sesion que no existe para acabar reportando a Sentry
  // un fallo que no lo era, una vez por cada cierre de sesion. Es exactamente
  // el tipo de ruido que ya sepulto senales reales en este proyecto.
  //
  // Se queda como aviso informativo en vez de desaparecer porque el caso sigue
  // siendo interesante cuando NO viene de /login: un token que llega justo
  // mientras la sesion se va (el puente de iOS es asincrono) es una carrera
  // real, y el registro siguiente la arregla. El registro solo se intenta ya
  // con sesion comprobada (ver registrarDispositivo), asi que esto pasa a ser
  // una rareza y no la norma.
  if (!lastError) {
    Sentry.captureMessage("Token de push recibido sin sesion activa: no se guardo", {
      level: "info",
      tags: { hook: "usePushNotifications", platform: Capacitor.getPlatform() },
    });
    return;
  }

  // Sin este reporte el fallo solo vive en la consola del dispositivo y el
  // usuario deja de recibir mensajes, ofertas y recordatorios sin que nadie se
  // entere. El `details` del PostgrestError es donde Postgres nombra la columna
  // o la policy que rechazo, por eso viaja entero en el contexto.
  Sentry.captureException(lastError, {
    tags: { hook: "usePushNotifications", platform: Capacitor.getPlatform() },
    contexts: { supabase: lastContext },
  });
  console.error("Failed to save push token after retries");
}

/**
 * Como esta el permiso del sistema, en los terminos que usan las pantallas.
 *
 * "no-nativo" no es un fallo: en el navegador no hay tuberia de push (no hay
 * service worker con VAPID ni FCM web en el proyecto), asi que las pantallas
 * tienen que poder decir la verdad — esto llega en la app — en vez de ofrecer
 * un boton que no haria nada.
 */
export type EstadoPermisoPush =
  | "no-nativo"
  | "sin-pedir"
  | "concedido"
  | "denegado"
  | "error";

function traducirPermiso(receive: PermissionState): EstadoPermisoPush {
  if (receive === "granted") return "concedido";
  if (receive === "denied") return "denegado";
  // 'prompt' y 'prompt-with-rationale': todavia se puede preguntar.
  return "sin-pedir";
}

/**
 * Android 8+ descarta toda notificacion cuyo channel_id no corresponda a un
 * canal existente. send-push manda channel_id 'default' en cada mensaje, asi
 * que sin este canal el push llega al telefono y el sistema lo tira sin pintar
 * nada: exactamente el sintoma de "no me llego ninguna notificacion".
 *
 * Se crea en los dos caminos (al pedir el permiso y al arrancar con el permiso
 * ya concedido) porque crearlo solo tras conceder deja sin canal a quien lo
 * concedio en una version anterior de la app.
 */
async function crearCanalAndroid(): Promise<void> {
  if (Capacitor.getPlatform() !== "android") return;
  await PushNotifications.createChannel({
    id: 'default',
    name: 'Notificaciones VICINO',
    description: 'Mensajes, ofertas y avisos de VICINO',
    importance: 5,
    visibility: 1,
    lights: true,
    vibration: true,
  });
}

/**
 * Lee el permiso sin pedir nada. Seguro de llamar en cualquier render.
 */
export async function leerPermisoPush(): Promise<EstadoPermisoPush> {
  if (!Capacitor.isNativePlatform()) return "no-nativo";
  try {
    const { receive } = await PushNotifications.checkPermissions();
    return traducirPermiso(receive);
  } catch (err) {
    Sentry.captureException(err, {
      tags: { accion: "leerPermisoPush", platform: Capacitor.getPlatform() },
    });
    return "error";
  }
}

/**
 * Pide el permiso del sistema. LLAMAR SOLO DESDE UN GESTO DE LA PERSONA.
 *
 * Antes esto lo hacia el hook al montar, sin contexto ninguno: el dialogo del
 * sistema salia encima de la primera pantalla y la respuesta natural a un
 * dialogo que no se ha pedido es "No permitir". En iOS eso no se puede
 * deshacer desde la app — el sistema no vuelve a preguntar nunca y la unica
 * salida es Ajustes, que casi nadie recorre. O sea que el arranque silencioso
 * no solo no ganaba permisos: los quemaba.
 *
 * Al conceder registra el dispositivo. Los listeners que recogen el token NO
 * se montan aqui: los monta usePushNotifications en el layout raiz, y
 * duplicarlos guardaria el mismo token dos veces. Si el evento se perdiera por
 * llegar antes de que el layout termine de montar, el siguiente arranque lo
 * recupera: el hook vuelve a registrar cuando ve el permiso ya concedido.
 */
export async function pedirPermisoPush(): Promise<EstadoPermisoPush> {
  if (!Capacitor.isNativePlatform()) return "no-nativo";
  try {
    const { receive } = await PushNotifications.requestPermissions();
    const estado = traducirPermiso(receive);
    if (estado !== "concedido") return estado;

    await crearCanalAndroid();
    await PushNotifications.register();
    return "concedido";
  } catch (err) {
    Sentry.captureException(err, {
      tags: { accion: "pedirPermisoPush", platform: Capacitor.getPlatform() },
    });
    return "error";
  }
}

export function usePushNotifications() {
  const router = useRouter();

  // El router viaja por referencia para que el efecto de abajo se monte UNA
  // vez. Con [router] en las dependencias, cada navegacion removia todos los
  // listeners y los volvia a poner, y en esa ventana un push recibido no lo
  // atendia nadie.
  const routerRef = useRef(router);
  useEffect(() => {
    routerRef.current = router;
  }, [router]);

  useEffect(() => {
    // Solo ejecutamos en plataformas nativas (Android/iOS)
    if (!Capacitor.isNativePlatform()) return;

    let isSubscribed = true;
    // Handle del listener appUrlOpen del plugin App (FCM bridge). Se remueve en
    // el cleanup: PushNotifications.removeAllListeners() NO lo cubre (es otro
    // plugin).
    let fcmUrlHandle: PluginListenerHandle | undefined;
    // Igual que el de arriba: vive en el plugin App y se remueve a mano.
    let estadoAppHandle: PluginListenerHandle | undefined;
    // La suscripcion a los cambios de sesion. El tipo se declara por su forma
    // para no atar este archivo al nombre que exporte auth-js.
    let sesionSub: { unsubscribe: () => void } | undefined;
    // Para que cuenta se registro ya este dispositivo en ESTA carga.
    let ultimaCuentaRegistrada: string | null = null;

    /**
     * Registra este dispositivo para la cuenta que tenga la sesion AHORA.
     *
     * Es idempotente: si el token es el mismo, lo peor que pasa es guardarlo
     * dos veces. Por eso se puede llamar sin miedo cada vez que algo sugiere
     * que el token o la cuenta pudieron cambiar.
     */
    const registrarDispositivo = async (motivo: string) => {
      if (!isSubscribed) return;
      try {
        const { receive } = await PushNotifications.checkPermissions();
        if (traducirPermiso(receive) !== "concedido") return;

        // SIN SESION NO SE REGISTRA, y esto es la mitad del arreglo del ruido.
        //
        // Este hook esta en el layout raiz, asi que tambien se monta en /login.
        // Sin esta comprobacion, cada arranque en frio sobre /login y cada
        // cierre de sesion pedian un token que despues no habia donde guardar:
        // tres reintentos de un segundo y un aviso a Sentry por algo que no era
        // un fallo. Registrar sin sesion no sirve para nada — fcm_token vive en
        // profiles, y sin sesion no hay fila que tocar.
        const { data: { session } } = await createClient().auth.getSession();
        if (!session?.user) return;
        if (!isSubscribed) return;

        await crearCanalAndroid();
        await PushNotifications.register();
        // La marca se mantiene aqui, donde se sabe de verdad para quien se
        // registro. Asi el aviso de sesion de abajo no repite el registro que
        // acaba de hacer el arranque.
        ultimaCuentaRegistrada = session.user.id;
      } catch (err) {
        // Nivel de aviso y no de error: esto se reintenta solo en el siguiente
        // paso a primer plano, asi que un fallo suelto del puente no es una
        // incidencia — lo seria que fallara siempre, y eso se ve por volumen.
        Sentry.captureException(err, {
          level: "warning",
          tags: {
            hook: "usePushNotifications",
            accion: "registrarDispositivo",
            motivo,
            platform: Capacitor.getPlatform(),
          },
        });
      }
    };

    const registerPush = async () => {
      try {
        // En iOS, el plugin oficial se queda con el APNs, y el plugin de comunidad de FCM a veces falla por SPM/timing.
        // HACK DE PLAN C: El AppDelegate nativo nos envía el token FCM por un evento de Deep Link interno.
        fcmUrlHandle = await App.addListener('appUrlOpen', async (data) => {
          if (!isSubscribed) return;
          if (data.url.startsWith(FCM_TOKEN_DEEP_LINK_PREFIX)) {
            const nativeFcmToken = data.url.split(FCM_TOKEN_DEEP_LINK_PREFIX)[1];
            // Guard: bajo noUncheckedIndexedAccess split(...)[1] es string|undefined.
            // Tambien protege contra un URL "vicino://fcm-token/" sin token.
            if (!nativeFcmToken) {
              console.error("FCM bridge: deep link sin token");
              return;
            }
            console.log(`Push token received via native bridge (ios): ${nativeFcmToken.substring(0, 20)}... (${nativeFcmToken.length} chars)`);
            await saveTokenToProfile(nativeFcmToken);
          }
        });
        // Si el componente se desmonto durante el await anterior, remover ya.
        if (!isSubscribed) {
          void fcmUrlHandle.remove();
          fcmUrlHandle = undefined;
        }

        // 1. Registrar listeners ANTES de register(), y ANTES de comprobar el
        //    permiso: quien ya lo concedio recibe su token en cuanto se
        //    registra, y un evento sin listener se pierde para siempre.
        await PushNotifications.addListener('registration', async (token: Token) => {
          if (!isSubscribed) return;
          const platform = Capacitor.getPlatform();

          if (platform === 'ios') {
            // Ignoramos el token APNs aquí en iOS. Esperamos a que llegue por appUrlOpen desde el AppDelegate.
            console.log("APNs token received. Esperando token FCM del native bridge...");
            return;
          }

          // En Android sí llega directo
          console.log(`Push token received (${platform}): ${token.value.substring(0, 20)}... (${token.value.length} chars)`);
          await saveTokenToProfile(token.value);
        });

        // 1b. Error de registro
        await PushNotifications.addListener('registrationError', (error: unknown) => {
          // Dato externo: viene del puente nativo, no del tipo de nadie.
          const detalle =
            error instanceof Error
              ? error.message
              : typeof error === 'object' && error !== null && 'error' in error
                ? String((error as { error: unknown }).error)
                : JSON.stringify(error);
          console.error('Error en el registro de push: ' + detalle);
        });

        // 1c. Notificacion recibida en primer plano (foreground)
        await PushNotifications.addListener('pushNotificationReceived', (notification: PushNotificationSchema) => {
          if (!isSubscribed) return;

          const ruta = rutaInternaDePush(notification.data);

          // Si el usuario ya esta viendo exactamente esa pantalla (ej. dentro del chat),
          // no mostramos el toast porque Supabase Realtime ya inserta el mensaje en vivo.
          if (ruta !== null && ruta === window.location.pathname) {
            return;
          }

          // Mostramos un toast nativo-ish con Sonner. Sin enlace utilizable el
          // aviso se queda sin boton: mejor que un boton que no lleva a nada o
          // que lleva fuera de VICINO.
          toast(notification.title || "Nueva notificacion", {
            description: notification.body || "",
            ...(ruta === null
              ? {}
              : {
                  action: {
                    label: "Ver",
                    onClick: () => {
                      routerRef.current.push(ruta);
                      routerRef.current.refresh();
                    },
                  },
                }),
          });
        });

        // 1d. Usuario toco la notificacion desde background
        await PushNotifications.addListener('pushNotificationActionPerformed', (notification: ActionPerformed) => {
          if (!isSubscribed) return;
          const ruta = rutaInternaDePush(notification.notification.data);
          if (ruta !== null) {
            // Navegar directamente a la ruta que viene en el deep link, ya
            // comprobada: aqui no hay ni un toque que confirme nada, el push
            // navega solo, asi que es el sitio donde un enlace ajeno mas dano
            // hace.
            routerRef.current.push(ruta);
            routerRef.current.refresh();
          }
        });

        // 2. AQUI NO SE PIDE NINGUN PERMISO.
        //
        //    Este hook vive en el layout raiz, o sea que se monta en la primera
        //    pantalla que ve cualquiera. Pedir el permiso desde aqui sacaba el
        //    dialogo del sistema sin una sola frase que lo justificara, y en
        //    iOS un "No permitir" es definitivo: el sistema no vuelve a
        //    preguntar y la app se queda sin push para siempre. El permiso se
        //    pide donde hay contexto y un gesto: /activar-notificaciones en el
        //    alta y /configuracion/notificaciones despues, las dos llamando a
        //    pedirPermisoPush().
        //
        //    Lo que si toca aqui es re-registrar a quien YA lo concedio: el
        //    token de FCM caduca y rota, y sin un register() por arranque el
        //    telefono conserva un token que send-push ya no puede usar.
        await registrarDispositivo("arranque");

        // 3. Y VOLVER A REGISTRAR CUANDO CAMBIA QUIEN ESTA DENTRO.
        //
        //    Este efecto tiene las dependencias vacias, o sea que corre UNA vez
        //    por carga del documento. Eso dejaba dos agujeros, los dos con el
        //    mismo final — fcm_token en NULL y send-push respondiendo 200 con
        //    "User has no FCM token", que es un exito de mentira:
        //
        //    a) Cerrar sesion y volver a entrar sin recargar. use-logout pone
        //       fcm_token a NULL a proposito (el token es del telefono, no de
        //       la persona); el SIGNED_OUT recarga duro hacia /login, pero al
        //       entrar de nuevo login-form navega BLANDO con router.push, el
        //       layout raiz sigue montado y este efecto no vuelve a correr. Sin
        //       register() no hay evento de registro, y la cuenta que acaba de
        //       entrar se queda sin token hasta el siguiente arranque en frio.
        //    b) Conceder el permiso desde Ajustes del sistema con la app viva.
        //       El unico camino de vuelta a la app es el primer plano.
        //
        //    El primero lo cubre la sesion; el segundo, el primer plano.
        const { data: { subscription } } = createClient().auth.onAuthStateChange(
          (evento, sesion) => {
            // INITIAL_SESSION es la sesion que ya estaba al cargar: de esa se
            // encargo registrarDispositivo("arranque").
            if (evento === "INITIAL_SESSION") return;
            const cuenta = sesion?.user.id;
            if (!cuenta) {
              // Al salir se olvida la marca: si la MISMA cuenta vuelve a entrar
              // en esta misma carga hay que registrar otra vez, porque
              // use-logout ya le dejo el fcm_token en NULL.
              ultimaCuentaRegistrada = null;
              return;
            }
            // Una sesion viva emite TOKEN_REFRESHED cada hora larga. Sin esta
            // comparacion, cada uno de esos avisos re-registraba y reescribia
            // el mismo token sin motivo.
            if (cuenta === ultimaCuentaRegistrada) return;
            ultimaCuentaRegistrada = cuenta;
            // setTimeout(0) y no await: dentro del callback de
            // onAuthStateChange el cliente tiene tomado su cerrojo, y la
            // llamada a getSession() de registrarDispositivo se quedaria
            // esperandolo. Es la trampa documentada de supabase-js.
            setTimeout(() => {
              void registrarDispositivo("sesion");
            }, 0);
          },
        );
        // El cleanup pudo correr durante los await de arriba: sin esto la
        // suscripcion quedaria viva sin nadie que la cierre.
        if (!isSubscribed) {
          subscription.unsubscribe();
        } else {
          sesionSub = subscription;
        }

        // 4. Volver al primer plano. Es el unico aviso que llega tras conceder
        //    el permiso en Ajustes, y ademas es una buena excusa para refrescar
        //    un token que pudo rotar mientras la app estaba dormida. No se
        //    deduplica por cuenta a proposito: aqui lo que pudo cambiar es el
        //    permiso o el token, no quien esta dentro.
        const handle = await App.addListener("appStateChange", ({ isActive }) => {
          if (!isActive) return;
          void registrarDispositivo("primer-plano");
        });
        if (!isSubscribed) {
          void handle.remove();
        } else {
          estadoAppHandle = handle;
        }

      } catch (err) {
        console.error("Fallo al inicializar PushNotifications", err);
      }
    };

    registerPush();

    return () => {
      isSubscribed = false;
      // Remover todos los listeners al desmontar para evitar acumulacion
      PushNotifications.removeAllListeners().catch(() => {});
      // El listener appUrlOpen vive en el plugin App, no en PushNotifications.
      void fcmUrlHandle?.remove();
      fcmUrlHandle = undefined;
      // Y estas dos tampoco las cubre removeAllListeners(): una es del plugin
      // App y la otra de supabase-js. Sin darlas de baja, cada montaje del
      // layout raiz apilaria una suscripcion mas registrando el dispositivo.
      void estadoAppHandle?.remove();
      estadoAppHandle = undefined;
      sesionSub?.unsubscribe();
      sesionSub = undefined;
    };
  }, []);
}
