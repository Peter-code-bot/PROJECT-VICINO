import { useEffect } from "react";
import { Capacitor, type PluginListenerHandle } from "@capacitor/core";
import { App } from "@capacitor/app";
import { PushNotifications, Token, PushNotificationSchema, ActionPerformed } from "@capacitor/push-notifications";
import { createClient } from "@/lib/supabase/client";
import * as Sentry from "@sentry/nextjs";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { FCM_TOKEN_DEEP_LINK_PREFIX } from "@/lib/auth/deep-link-constants";

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
  // Sin este reporte el fallo solo vive en la consola del dispositivo y el
  // usuario deja de recibir mensajes, ofertas y recordatorios sin que nadie se
  // entere. El `details` del PostgrestError es donde Postgres nombra la columna
  // o la policy que rechazo, por eso viaja entero en el contexto.
  Sentry.captureException(
    lastError ?? new Error("No hubo sesion activa para guardar el token de push"),
    {
      tags: { hook: "usePushNotifications", platform: Capacitor.getPlatform() },
      contexts: { supabase: lastContext },
    }
  );
  console.error("Failed to save push token after retries");
}

export function usePushNotifications() {
  const router = useRouter();

  useEffect(() => {
    // Solo ejecutamos en plataformas nativas (Android/iOS)
    if (!Capacitor.isNativePlatform()) return;

    let isSubscribed = true;
    // Handle del listener appUrlOpen del plugin App (FCM bridge). Se remueve en
    // el cleanup: PushNotifications.removeAllListeners() NO lo cubre (es otro
    // plugin) y el effect depende de [router] -> re-corre por navegacion.
    let fcmUrlHandle: PluginListenerHandle | undefined;

    const registerPush = async () => {
      try {
        // 1. Pedir permisos al usuario (mostrara el dialogo nativo)
        const permission = await PushNotifications.requestPermissions();
        if (permission.receive !== 'granted') {
          console.log("Permiso de notificaciones push denegado");
          return;
        }

        // Android 8+ descarta toda notificacion cuyo channel_id no corresponda
        if (Capacitor.getPlatform() === 'android') {
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

        // 2. Registrar listeners ANTES de register()
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

        // 2b. Error de registro
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

        // 2c. Notificacion recibida en primer plano (foreground)
        await PushNotifications.addListener('pushNotificationReceived', (notification: PushNotificationSchema) => {
          if (!isSubscribed) return;
          
          // Si el usuario ya esta viendo exactamente esa pantalla (ej. dentro del chat),
          // no mostramos el toast porque Supabase Realtime ya inserta el mensaje en vivo.
          if (notification.data && notification.data.url === window.location.pathname) {
            return;
          }

          // Mostramos un toast nativo-ish con Sonner
          toast(notification.title || "Nueva notificacion", {
            description: notification.body || "",
            action: {
              label: "Ver",
              onClick: () => {
                if (notification.data && notification.data.url) {
                  router.push(notification.data.url);
                  router.refresh();
                }
              }
            }
          });
        });

        // 2d. Usuario toco la notificacion desde background
        await PushNotifications.addListener('pushNotificationActionPerformed', (notification: ActionPerformed) => {
          if (!isSubscribed) return;
          const data = notification.notification.data;
          if (data && data.url) {
            // Navegar directamente a la ruta que viene en el deep link
            router.push(data.url);
            router.refresh();
          }
        });

        // 3. Registrar el dispositivo con el OS (Android/iOS) para obtener el token.
        //    DEBE ir DESPUES de los listeners para que el evento no se pierda.
        await PushNotifications.register();

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
    };
  }, [router]);
}

