import { useEffect } from "react";
import { Capacitor } from "@capacitor/core";
import { PushNotifications, Token, PushNotificationSchema, ActionPerformed } from "@capacitor/push-notifications";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { FCM } from "@capacitor-community/fcm";

/**
 * Guarda el token de push en profiles.fcm_token con reintentos.
 * La sesion auth puede no estar lista cuando iOS devuelve el token
 * (race entre el bridge de Capacitor y la cookie de Supabase).
 */
async function saveTokenToProfile(tokenValue: string, retries = 3) {
  const supabase = createClient();
  for (let i = 0; i < retries; i++) {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user) {
      const { error } = await supabase
        .from("profiles")
        .update({ fcm_token: tokenValue })
        .eq("id", session.user.id);
      if (!error) {
        console.log("Push token saved to profile successfully");
        return;
      }
      console.error("Error saving push token:", error.message);
    }
    // Esperar 1s antes de reintentar (sesion puede no estar lista)
    if (i < retries - 1) {
      await new Promise(r => setTimeout(r, 1000));
    }
  }
  console.error("Failed to save push token after retries - no active session");
}

export function usePushNotifications() {
  const router = useRouter();

  useEffect(() => {
    // Solo ejecutamos en plataformas nativas (Android/iOS)
    if (!Capacitor.isNativePlatform()) return;

    let isSubscribed = true;

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

        // 2. Registrar listeners ANTES de register() para evitar race condition.
        await PushNotifications.addListener('registration', async (token: Token) => {
          if (!isSubscribed) return;
          const platform = Capacitor.getPlatform();
          let finalToken = token.value;
          
          if (platform === 'ios') {
            try {
              // En iOS, el token de PushNotifications es APNs nativo.
              // Usamos FCM.getToken() para obtener el Firebase Registration Token que requiere nuestro backend.
              const fcmTokenResponse = await FCM.getToken();
              finalToken = fcmTokenResponse.token;
            } catch (err) {
              console.error("Error obteniendo token FCM en iOS", err);
              return;
            }
          }
          
          console.log(`Push token received (${platform}): ${finalToken.substring(0, 20)}... (${finalToken.length} chars)`);
          await saveTokenToProfile(finalToken);
        });

        // 2b. Error de registro
        await PushNotifications.addListener('registrationError', (error: any) => {
          console.error('Error en el registro de push: ' + JSON.stringify(error));
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
    };
  }, [router]);
}

