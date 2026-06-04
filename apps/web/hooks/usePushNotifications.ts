import { useEffect } from "react";
import { Capacitor } from "@capacitor/core";
import { PushNotifications, Token, PushNotificationSchema, ActionPerformed } from "@capacitor/push-notifications";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

export function usePushNotifications() {
  const router = useRouter();

  useEffect(() => {
    // Solo ejecutamos en plataformas nativas (Android/iOS)
    if (!Capacitor.isNativePlatform()) return;

    let isSubscribed = true;

    const registerPush = async () => {
      try {
        // 1. Pedir permisos al usuario (mostrará el diálogo nativo)
        const permission = await PushNotifications.requestPermissions();
        if (permission.receive !== 'granted') {
          console.log("Permiso de notificaciones push denegado");
          return;
        }

        // 2. Registrar el dispositivo con el OS (Android/iOS) para obtener el token
        await PushNotifications.register();

        // 3. Obtener el token de FCM o APNs y guardarlo en Supabase
        const tokenListener = await PushNotifications.addListener('registration', async (token: Token) => {
          if (!isSubscribed) return;
          console.log('Push registration success, token: ' + token.value);
          
          const supabase = createClient();
          const { data: session } = await supabase.auth.getSession();
          if (session?.session?.user) {
            await supabase.from("profiles").update({ fcm_token: token.value }).eq("id", session.session.user.id);
          }
        });

        // 4. Manejar errores de registro
        const errorListener = await PushNotifications.addListener('registrationError', (error: any) => {
          console.error('Error en el registro de push: ' + JSON.stringify(error));
        });

        // 5. Manejar notificaciones cuando la app está abierta en primer plano (foreground)
        const receivedListener = await PushNotifications.addListener('pushNotificationReceived', (notification: PushNotificationSchema) => {
          if (!isSubscribed) return;
          
          // Si el usuario ya está viendo exactamente esa pantalla (ej. dentro del chat),
          // no mostramos el toast porque Supabase Realtime ya inserta el mensaje en vivo.
          if (notification.data && notification.data.url === window.location.pathname) {
            return;
          }

          // Mostramos un toast nativo-ish con Sonner
          toast(notification.title || "Nueva notificación", {
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

        // 6. Manejar la acción cuando el usuario toca la notificación desde afuera (background)
        const actionListener = await PushNotifications.addListener('pushNotificationActionPerformed', (notification: ActionPerformed) => {
          if (!isSubscribed) return;
          const data = notification.notification.data;
          if (data && data.url) {
            // Navegar directamente a la ruta que viene en el deep link
            router.push(data.url);
            router.refresh();
          }
        });

      } catch (err) {
        console.error("Fallo al inicializar PushNotifications", err);
      }
    };

    registerPush();

    return () => {
      isSubscribed = false;
      // Remover todos los listeners al desmontar para evitar acumulación
      PushNotifications.removeAllListeners().catch(() => {});
    };
  }, [router]);
}
