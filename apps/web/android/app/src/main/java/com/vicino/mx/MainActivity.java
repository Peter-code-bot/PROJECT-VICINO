package com.vicino.mx;

import android.os.Build;
import android.os.Bundle;
import android.os.SystemClock;
import android.util.Log;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebView;
import androidx.annotation.RequiresApi;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;
import io.sentry.Sentry;
import io.sentry.SentryEvent;
import io.sentry.SentryLevel;
import io.sentry.protocol.Message;

public class MainActivity extends BridgeActivity {

    private static final String TAG = "VicinoWebView";

    /**
     * Si el renderer vuelve a morir antes de este tiempo desde la ultima
     * recuperacion, no se recrea otra vez: se cierra la actividad. Evita un bucle
     * de recreaciones si la propia pagina es la que tumba al renderer.
     */
    private static final long VENTANA_BUCLE_MS = 30_000;

    /** static: sobrevive a recreate(), que crea otra instancia de la actividad. */
    private static long ultimaRecuperacion = 0;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // BridgeActivity crea el bridge dentro de super.onCreate (load()).
        if (bridge != null) {
            bridge.addWebViewListener(
                new WebViewListener() {
                    // El sistema solo llama a este callback en API 26+ (minSdk es 24).
                    @RequiresApi(api = Build.VERSION_CODES.O)
                    @Override
                    public boolean onRenderProcessGone(WebView webView, RenderProcessGoneDetail detail) {
                        return recuperarRenderer(detail);
                    }
                }
            );
        }
    }

    /**
     * El WebView pinta en un proceso aparte (el renderer). Android lo puede matar
     * para recuperar memoria, sobre todo con la app en segundo plano y en
     * telefonos de gama baja, o puede fallar por si solo. Capacitor no lo maneja:
     * sin un listener que devuelva true, BridgeWebViewClient devuelve false y
     * Android cierra la app entera (la guia oficial avisa de que en versiones
     * recientes eso se ve como un cierre al volver a la app).
     *
     * Devolver true obliga a no volver a usar ese WebView. recreate() monta una
     * actividad nueva con un WebView nuevo que vuelve a cargar server.url; el
     * viejo lo quita y destruye Bridge.onDetachedFromWindow durante el desmontaje.
     *
     * https://developer.android.com/develop/ui/views/layout/webapps/handle-termination
     */
    @RequiresApi(api = Build.VERSION_CODES.O)
    private boolean recuperarRenderer(RenderProcessGoneDetail detail) {
        boolean fallo = detail.didCrash();
        int prioridad = detail.rendererPriorityAtExit();
        long ahora = SystemClock.elapsedRealtime();
        boolean enBucle = ultimaRecuperacion != 0 && ahora - ultimaRecuperacion < VENTANA_BUCLE_MS;
        ultimaRecuperacion = ahora;

        Log.w(TAG, "Renderer del WebView terminado: crash=" + fallo + " prioridad=" + prioridad + " bucle=" + enBucle);
        reportar(fallo, prioridad, enBucle);

        if (enBucle) {
            finish();
        } else {
            recreate();
        }
        return true;
    }

    /** Sin PII: solo por que murio y que se hizo. Si Sentry no arranco, no hace nada. */
    private static void reportar(boolean fallo, int prioridad, boolean enBucle) {
        try {
            if (!Sentry.isEnabled()) return;
            Message mensaje = new Message();
            mensaje.setMessage("WebView renderer terminado");
            SentryEvent evento = new SentryEvent();
            evento.setMessage(mensaje);
            evento.setLevel(fallo ? SentryLevel.ERROR : SentryLevel.WARNING);
            evento.setTag("renderer.crash", String.valueOf(fallo));
            evento.setTag("renderer.prioridad", String.valueOf(prioridad));
            evento.setTag("renderer.accion", enBucle ? "cerrar" : "recrear");
            Sentry.captureEvent(evento);
        } catch (Throwable ignorado) {
            // La telemetria nunca puede impedir la recuperacion.
            Log.w(TAG, "No se pudo reportar a Sentry", ignorado);
        }
    }
}
