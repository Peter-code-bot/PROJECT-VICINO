"use client";

// Pasos 2 a 5 del flujo: la pantalla donde se escribe el código.
//
// No es una ruta aparte a propósito. El reporte pedía que la transición fuera
// instantánea, y una navegación real cuesta un viaje al servidor justo cuando
// la persona acaba de pulsar "Crear cuenta". Además una ruta necesitaría
// llevar el correo en la URL, y un correo en la barra de direcciones acaba en
// el historial, en los logs del servidor y en el Referer de cualquier recurso
// externo que cargue la página.

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Check, Loader2 } from "lucide-react";
import { CodigoInput } from "@/components/auth/codigo-input";
import { LARGO_CODIGO } from "@/lib/auth/otp-formato";
import { conTope, esTope } from "@/lib/auth/con-tope";
import { destinoSeguro } from "@/lib/auth/destino-seguro";
import { guardarPendiente, leerPendienteDesde } from "@/lib/auth/verificacion-pendiente";
import { hapticLight } from "@/lib/haptics";
import { reenviarCodigo, verificarCodigo } from "../actions";

// Misma cifra que smtp_max_frequency en la config de Auth: pedir otro código
// antes de que pasen 60 s lo rechaza el servidor, así que el botón no se
// ofrece antes de tiempo.
const ESPERA_REENVIO_S = 60;

/**
 * Segundos que quedan de espera, contados desde que se mandó el código que
 * está vivo ahora mismo.
 *
 * No arranca en 60 de oficio. El caso que el store existe para cubrir es
 * exactamente éste: salir a la app de correo y volver, que en móvil puede
 * significar que el sistema mató la app entera. Si al volver le exigiéramos
 * otro minuto entero, esconderíamos durante ese minuto la única salida que
 * tiene quien no ha recibido nada.
 */
function esperaRestante(): number {
  const desde = leerPendienteDesde();
  if (desde === null) return ESPERA_REENVIO_S;
  const transcurridos = Math.floor((Date.now() - desde) / 1000);
  return Math.max(0, ESPERA_REENVIO_S - transcurridos);
}

interface VerificarCodigoProps {
  email: string;
  destino: string | null;
  /** Mensaje con el que abrir la pantalla, cuando quien nos monta ya sabe algo
   *  que contar — por ejemplo que el código ya estaba enviado de antes. */
  avisoInicial?: string;
  // Vuelve al formulario. Existe porque el fallo más común de esta pantalla no
  // es el código: es haber escrito mal el correo.
  onCambiarCorreo: () => void;
  // Avisa de que la verificación cuajó. Quien nos pinta tiene que mantenernos
  // montados hasta que la navegación termine — ver el comentario de alCompletar.
  onVerificado: () => void;
}

export function VerificarCodigo({
  email,
  destino,
  avisoInicial = "",
  onCambiarCorreo,
  onVerificado,
}: VerificarCodigoProps) {
  const [codigo, setCodigo] = useState("");
  const [error, setError] = useState("");
  const [aviso, setAviso] = useState(avisoInicial);
  const [verificando, setVerificando] = useState(false);
  const [reenviando, setReenviando] = useState(false);
  const [exito, setExito] = useState(false);
  // Inicializador perezoso: el store se lee una sola vez, al montar.
  const [segundos, setSegundos] = useState(esperaRestante);
  const router = useRouter();

  // Una verificación en vuelo bloquea las siguientes. El estado por sí solo no
  // basta: entre el evento y el re-render caben dos llamadas, y la segunda
  // gastaría un intento de la cuota con un código que ya se está comprobando.
  const enVueloRef = useRef(false);

  useEffect(() => {
    if (segundos <= 0) return;
    const t = setTimeout(() => setSegundos((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [segundos]);

  // Escribir borra el aviso rojo. Sin esto las casillas se quedan pintadas de
  // rojo mientras se teclea el código siguiente, o sea que la pantalla marca
  // como fallido algo que todavía no ha fallado.
  const alCambiarCodigo = useCallback((valor: string) => {
    setCodigo(valor);
    setError("");
    setAviso("");
  }, []);

  const alCompletar = useCallback(
    async (valor: string) => {
      if (enVueloRef.current) return;
      enVueloRef.current = true;
      setVerificando(true);
      setError("");
      setAviso("");

      try {
        const res = await conTope(verificarCodigo(email, valor));

        if (!res.ok) {
          setError(res.mensaje);
          // Se vacían las casillas para que la siguiente pulsación escriba un
          // código nuevo y no acabe empujando dígitos sobre el que falló.
          setCodigo("");
          return;
        }

        void hapticLight();

        // Aquí NO se borra el rastro pendiente, y es deliberado.
        //
        // borrarPendiente() notifica al store, y el suscriptor es el
        // useSyncExternalStore de RegisterForm: React commitea ese re-render de
        // forma síncrona, `pendiente` pasa a null y esta pantalla se desmonta
        // EN EL ACTO. Mientras tanto router.push() es una transición que
        // necesita ida y vuelta al servidor, y el destino encadena además el
        // layout del marketplace y un redirect a /bienvenida. O sea que entre
        // acertar el código y llegar a alguna parte, la persona veía otra vez
        // el formulario de registro vacío — justo cuando todo había salido bien.
        //
        // En su lugar se avisa hacia arriba: RegisterForm nos mantiene pintados
        // hasta que la navegación ocurra, y es él quien limpia el rastro.
        setExito(true);
        onVerificado();

        router.refresh();
        router.push(destinoSeguro(destino));
      } catch (err) {
        if (esTope(err)) {
          // El tope no cancela nada: la petición puede cuajar en el servidor
          // DESPUÉS de que dejáramos de esperarla, y en ese caso el código ya
          // se consumió y las cookies de sesión ya están puestas. Reintentar
          // con el mismo código diría "incorrecto" y dejaría encallada a una
          // persona que en realidad ya está dentro. Refrescar deja que el
          // servidor diga en qué estado está de verdad.
          setError("Tardó demasiado. Estamos comprobando si tu cuenta ya quedó lista...");
          router.refresh();
        } else {
          setError("No pudimos conectar. Revisa tu conexión e intenta de nuevo.");
        }
        setCodigo("");
      } finally {
        enVueloRef.current = false;
        setVerificando(false);
      }
    },
    [email, destino, router, onVerificado],
  );

  async function alReenviar() {
    if (reenviando || segundos > 0) return;
    setReenviando(true);
    setError("");
    setAviso("");

    try {
      const res = await conTope(reenviarCodigo(email));
      if (!res.ok) {
        setError(res.mensaje);
        // Si el servidor dice cuántos segundos faltan, se respeta ese número y
        // no el nuestro: el suyo es el que manda.
        setSegundos(res.segundos ?? ESPERA_REENVIO_S);
        return;
      }
      setCodigo("");
      setSegundos(ESPERA_REENVIO_S);
      // Vuelve a sellar el rastro con la hora del código NUEVO.
      //
      // Sin esto el rastro seguía caducando a los 10 minutos del PRIMER envío
      // aunque el código vivo fuera posterior. El camino: alta, no llega el
      // correo, a los ocho minutos se pide otro, se sale a buscarlo — y al
      // volver la pantalla ya no existe, con un código perfectamente válido en
      // la mano y ninguna casilla donde escribirlo.
      guardarPendiente(email);
      setAviso("Te enviamos un código nuevo.");
    } catch (err) {
      setError(
        esTope(err)
          ? "Tardó demasiado. Revisa tu conexión y vuelve a intentarlo."
          : "No pudimos conectar. Revisa tu conexión e intenta de nuevo.",
      );
    } finally {
      setReenviando(false);
    }
  }

  // Acuse de salida: se queda puesto mientras la navegación viaja. Antes, en
  // este hueco, se veía el formulario de registro en blanco.
  if (exito) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-10 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[rgba(52,199,89,0.12)]">
          <Check className="h-6 w-6 text-[#34C759]" aria-hidden="true" />
        </div>
        <div role="status">
          <p className="font-heading text-xl font-bold">¡Cuenta verificada!</p>
          <p className="mt-1 text-sm text-muted-foreground">Entrando a VICINO...</p>
        </div>
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden="true" />
      </div>
    );
  }

  const reloj = Math.floor(segundos / 60) + ":" + String(segundos % 60).padStart(2, "0");

  return (
    <div className="space-y-6">
      <div className="space-y-3 text-center">
        <h1 className="font-heading text-2xl font-bold">Revisa tu correo</h1>
        <p className="text-sm text-muted-foreground">
          Enviamos un código de {LARGO_CODIGO} dígitos a
          <br />
          {/* break-all: un correo largo desbordaba la tarjeta en pantallas de 360 px. */}
          <span className="break-all font-medium text-foreground">{email}</span>
        </p>
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-xl bg-[rgba(255,59,48,0.08)] p-3 text-sm text-[color:var(--danger)] shadow-[inset_0_0_0_1px_rgba(255,59,48,0.25)]"
        >
          {error}
        </div>
      )}

      {aviso && (
        <div
          role="status"
          className="rounded-xl bg-[rgba(52,199,89,0.10)] p-3 text-sm text-[color:var(--fg)] shadow-[inset_0_0_0_1px_rgba(52,199,89,0.30)]"
        >
          {aviso}
        </div>
      )}

      <CodigoInput
        valor={codigo}
        onChange={alCambiarCodigo}
        onCompleto={alCompletar}
        deshabilitado={verificando}
        error={Boolean(error)}
      />

      {/* El envío es automático al sexto dígito, así que aquí no hay botón de
          "Verificar": solo el acuse de que algo está pasando. Un botón
          deshabilitado al lado de un código completo se lee como un fallo. */}
      <div className="flex h-6 items-center justify-center" aria-live="polite">
        {verificando && (
          <span className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Verificando...
          </span>
        )}
      </div>

      <div className="space-y-3 text-center text-sm">
        {segundos > 0 ? (
          <p className="text-muted-foreground">
            ¿No llegó? Puedes pedir otro en{" "}
            <span className="font-medium tabular-nums text-foreground">{reloj}</span>
          </p>
        ) : (
          <button
            type="button"
            onClick={alReenviar}
            disabled={reenviando || verificando}
            className="font-semibold text-primary transition-colors hover:text-primary/80 disabled:opacity-50"
          >
            {reenviando ? "Enviando..." : "Enviar otro código"}
          </button>
        )}

        {segundos === 0 && (
          // Aparece solo cuando ya se agotó la espera, porque hasta entonces la
          // explicación más probable es que el correo aún no llega.
          //
          // La segunda frase es la salida del caso en que el correo ya estaba
          // registrado y confirmado: Supabase no lo dice para no convertir el
          // registro en un buscador de cuentas ajenas, así que esa alta se ve
          // exactamente igual que una normal y el código nunca llega. Sin esta
          // línea esa persona se queda encallada aquí para siempre.
          <p className="text-xs leading-relaxed text-muted-foreground/80">
            Revisa tu carpeta de spam. Si ya tenías cuenta con este correo,{" "}
            <Link href="/login" className="font-medium text-primary hover:underline">
              inicia sesión
            </Link>
            .
          </p>
        )}

        <button
          type="button"
          onClick={onCambiarCorreo}
          className="inline-flex items-center gap-1.5 text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          Usar otro correo
        </button>
      </div>
    </div>
  );
}
