"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { guardarCorreoAuth, limpiarCorreoAuth, useCorreoAuth, hrefAuth } from "@/lib/auth/contexto-temporal";
import { useRouter, useSearchParams } from "next/navigation";
import { destinoAutenticadoSeguro } from "@/lib/auth/destino-seguro";
import Link from "next/link";
import { signUp } from "../actions";
import { signInWithGoogle, signInWithApple } from "@/lib/auth/native-oauth";
import { conTope, esTope } from "@/lib/auth/con-tope";
import {
  borrarPendiente,
  guardarPendiente,
  leerPendiente,
  leerPendienteServidor,
  limpiarSiVencio,
  suscribirPendiente,
} from "@/lib/auth/verificacion-pendiente";
import { VerificarCodigo } from "./verificar-codigo";
import { ArrowRight, Loader2 } from "lucide-react";

const suscribirInicio = () => () => {};
const inicioCliente = () => true;
const inicioServidor = () => false;

export function RegisterForm() {
  // Los campos controlados no deben aceptar escritura antes de hidratar:
  // Safari puede borrar lo escrito al sustituir el HTML inicial por React.
  const listo = useSyncExternalStore(suscribirInicio, inicioCliente, inicioServidor);
  const [nombre, setNombre] = useState("");
  const [email, setEmail] = useCorreoAuth();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [aviso, setAviso] = useState("");
  const [loading, setLoading] = useState(false);
  const submitting = useRef(false);
  const [existente, setExistente] = useState(false);

  // Respaldo en memoria del correo pendiente.
  //
  // guardarPendiente() puede fallar en silencio: Safari con «Bloquear todas las
  // cookies», un WebView con el almacenamiento apagado, la cuota llena. Sin
  // este respaldo, en esos navegadores el alta se completaba, el correo salía,
  // y la pantalla NO CAMBIABA — ni casillas ni mensaje, porque el aviso de
  // texto que había antes se quitó al meter el código. La persona se quedaba
  // mirando el formulario creyendo que no había pasado nada, y volvía a darle
  // a "Crear cuenta".
  // Sirve además para un segundo propósito: cuando la verificación cuaja, este
  // estado retiene el correo mientras se limpia el dispositivo, de modo que la
  // pantalla del código no se desmonte a mitad de la navegación de salida.
  const [pendienteMemoria, setPendienteMemoria] = useState<string | null>(null);

  // Correo cuya verificacion esta a medias. Mientras no sea null, esta pantalla
  // deja de ser el formulario y pasa a ser las seis casillas del codigo.
  //
  // Sustituye al aviso de texto "revisa tu correo" que vivia aqui. Aquel aviso
  // era el final del camino DENTRO de la app: a partir de ahi la persona se iba
  // al cliente de correo y volvia por un enlace, abierto en otro navegador, sin
  // la cookie del verificador PKCE que se creo aqui. De ahi sale el fallo que
  // app/auth/callback-server/route.ts lleva apanando con una pagina de rescate.
  // Con el codigo nadie cambia de navegador: se vuelve a esta misma pantalla.
  //
  // No es useState: el dato vive en el dispositivo, no en este componente. Asi
  // salir a la app de correo y volver (que en movil puede significar que el
  // sistema mato la app entera) no cuesta el registro. Si se perdiera, quien
  // volviera veria el formulario vacio y volveria a darle a "Crear cuenta",
  // que con el correo ya dado de alta no manda codigo nuevo: encallado.
  const pendiente = useSyncExternalStore(
    suscribirPendiente,
    leerPendiente,
    leerPendienteServidor,
  );

  // El rastro caducado se tira aqui y no al leerlo, porque leerlo ocurre
  // durante el render y escribir durante el render es justo lo que no se hace.
  useEffect(() => {
    limpiarSiVencio();
  }, []);
  const router = useRouter();
  const searchParams = useSearchParams();
  // El destino acompana a la persona por los CUATRO caminos de entrada:
  // email, Google, Apple, y el salto a iniciar sesion.
  const destino = searchParams.get("next");
  const hrefLogin = destino
    ? `/login?next=${encodeURIComponent(destinoAutenticadoSeguro(destino))}`
    : "/login";

  // El correo pendiente sale del dispositivo si se pudo escribir, y si no, de
  // memoria. El del dispositivo manda, porque es el que sobrevive a que el
  // sistema mate la app.
  const enVerificacion = pendiente ?? pendienteMemoria;

  /** Pasa a las casillas del código, escriba o no el almacenamiento. */
  function abrirVerificacion(correo: string) {
    // Escribir en el store repinta esta pantalla solo; el estado en memoria es
    // el que la repinta cuando el store no está disponible.
    guardarPendiente(correo);
    setPendienteMemoria(correo);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!listo || submitting.current) return;
    setError("");
    setAviso("");

    if (password.length < 6) {
      setError("La contraseña debe tener al menos 6 caracteres");
      return;
    }

    setLoading(true);
    submitting.current = true;

    // El correo se normaliza con la misma regla que el servidor (trim +
    // minusculas) para que lo que se pinta en pantalla, lo que se guarda en el
    // dispositivo y lo que se manda a verificar sean literalmente el mismo dato.
    const correo = email.trim().toLowerCase();

    // Con tope y con catch. Sin ellos, en una red que se cae a mitad —que es lo
    // normal en un movil— el fetch de la accion se queda colgado hasta que lo
    // tumbe el sistema, y como el boton esta deshabilitado mientras `loading`,
    // la unica salida era cerrar la app. Y si la promesa rechazaba, handleSubmit
    // lanzaba sin que nadie lo recogiera: mismo resultado, spinner eterno.
    let result;
    try {
      result = await conTope(signUp(correo, password, nombre, destino));
    } catch (err) {
      setError(
        esTope(err)
          ? "Tardó demasiado. Revisa tu conexión y vuelve a intentarlo."
          : "No pudimos conectar. Revisa tu conexión e intenta de nuevo.",
      );
      setLoading(false);
      return;
    } finally {
      submitting.current = false;
    }

    if (result.estado === "existente") {
      borrarPendiente();
      setPendienteMemoria(null);
      setPassword("");
      guardarCorreoAuth(correo);
      setEmail(correo);
      setExistente(true);
      setLoading(false);
      return;
    }

    if (result.error) {
      const msg = result.error.toLowerCase();
      if (result.sessionUnavailable || result.invalidInput || result.error.startsWith("No pudimos")) {
        setError(result.error);
        setLoading(false);
      } else if (msg.includes("security purposes") || msg.includes("only request this after")) {
        setError("Espera unos momentos antes de solicitar otro registro. Si ya tienes cuenta, inicia sesión.");
        setLoading(false);
      } else if (msg.includes("demasiadas") || msg.includes("too many")) {
        setError("Demasiados intentos. Espera un momento e intenta de nuevo.");
        setLoading(false);
      } else if (msg.includes("rate limit") || msg.includes("sending confirmation email")) {
        setError(
          "No pudimos enviar el correo de confirmación en este momento. Espera unos minutos e intenta de nuevo.",
        );
        setLoading(false);
      } else if (msg.includes("database error saving new user")) {
        setError(
          "Ocurrió un problema al crear tu perfil. Intenta de nuevo; si persiste, contáctanos.",
        );
        setLoading(false);
      } else {
        setError("Error al crear la cuenta. Intenta de nuevo.");
        setLoading(false);
      }
      return;
    }

    if (result.alreadyLoggedIn || result.hasSession) {
      // Si el servidor detecto sesion activa o la cuenta se creo con sesion emitida,
      // redirige al destino seguro previniendo bucles hacia login o register.
      router.push(destinoAutenticadoSeguro(destino));
      router.refresh();
      return;
    }

    // Only a real new signup enters verification; duplicates stay in the form.
    if (result.estado !== "verificacion_pendiente") {
      setError("No pudimos completar el registro. Intenta de nuevo.");
      setLoading(false);
      return;
    }
    abrirVerificacion(correo);
    setLoading(false);
  }

  async function handleGoogleSignup() {
    setError("");
    const result = await signInWithGoogle(destino ?? undefined);
    if (result.error) setError(result.error);
  }

  async function handleAppleSignup() {
    setError("");
    const result = await signInWithApple(destino ?? undefined);
    if (result.error) setError(result.error);
  }

  // Las seis casillas sustituyen al formulario dentro de la misma tarjeta. La
  // transicion es instantanea porque no hay navegacion de por medio: es el
  // mismo componente pintando otra cosa.
  if (enVerificacion) {
    return (
      <VerificarCodigo
        email={enVerificacion}
        destino={destino}
        avisoInicial={aviso}
        onCambiarCorreo={() => {
          borrarPendiente();
          setPendienteMemoria(null);
          setError("");
          setAviso("");
        }}
        onVerificado={() => {
          // El orden importa y es la mitad del arreglo. Primero se fija el
          // correo EN MEMORIA y despues se limpia el dispositivo: asi
          // `enVerificacion` nunca llega a ser null y la pantalla del codigo
          // sigue montada, con su acuse de exito, mientras la navegacion viaja.
          // Al reves —limpiar y ya— el store notifica, `pendiente` pasa a null,
          // esta rama deja de tomarse y reaparece el formulario vacio, que es
          // exactamente el fallo que esto viene a quitar.
          setPendienteMemoria(enVerificacion);
          borrarPendiente();
        }}
      />
    );
  }

  if (existente) {
    return (
      <div className="space-y-4">
        <div role="status" className="space-y-3 text-center">
          <h1 className="font-heading text-2xl font-bold">Ya existe una cuenta con este correo.</h1>
          <p className="break-all text-sm font-medium">{email}</p>
          <p className="text-sm text-muted-foreground">Inicia sesión o recupera tu contraseña para continuar.</p>
        </div>
        <Link href={hrefLogin} onClick={() => guardarCorreoAuth(email)} className="flex min-h-12 items-center justify-center rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground">Iniciar sesión</Link>
        <Link href={hrefAuth("/forgot-password", destino)} onClick={() => guardarCorreoAuth(email)} className="flex min-h-12 items-center justify-center rounded-xl border border-primary px-4 py-3 text-sm font-semibold text-primary">Recuperar contraseña</Link>
        <button type="button" onClick={() => { limpiarCorreoAuth(); setExistente(false); setEmail(""); setError(""); }} className="min-h-12 w-full text-sm text-muted-foreground">Cambiar correo</button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* El titulo vive aqui y no en page.tsx porque tiene que cambiar cuando
          cambia la pantalla: "Crea tu cuenta para empezar" encima de unas
          casillas de codigo describe un paso que ya paso. */}
      <div className="mb-6 space-y-1.5 text-center">
        <h1 className="font-heading text-2xl font-bold">Únete a VICINO</h1>
        <p className="text-sm text-muted-foreground">Crea tu cuenta para empezar</p>
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-xl bg-[rgba(255,59,48,0.08)] p-3 text-sm text-[color:var(--danger)] shadow-[inset_0_0_0_1px_rgba(255,59,48,0.25)]"
        >
          {error}
        </div>
      )}

      <div className="space-y-2">
        <label htmlFor="nombre" className="text-sm font-medium text-foreground/80">
          Nombre completo
        </label>
        <input
          id="nombre"
          type="text"
          disabled={!listo}
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          required
          placeholder="Tu nombre"
          className="w-full rounded-xl border border-border/50 bg-auth-input text-auth-text px-4 py-3 text-sm outline-none transition-all focus:border-primary/50 focus:ring-2 focus:ring-primary/20"
        />
      </div>

      <div className="space-y-2">
        <label htmlFor="email" className="text-sm font-medium text-foreground/80">
          Email
        </label>
        <input
          id="email"
          type="email"
          disabled={!listo}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          placeholder="tu@email.com"
          className="w-full rounded-xl border border-border/50 bg-auth-input text-auth-text px-4 py-3 text-sm outline-none transition-all focus:border-primary/50 focus:ring-2 focus:ring-primary/20"
        />
      </div>

      <div className="space-y-2">
        <label htmlFor="password" className="text-sm font-medium text-foreground/80">
          Contraseña
        </label>
        <input
          id="password"
          type="password"
          disabled={!listo}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={6}
          placeholder="Mínimo 6 caracteres"
          className="w-full rounded-xl border border-border/50 bg-auth-input text-auth-text px-4 py-3 text-sm outline-none transition-all focus:border-primary/50 focus:ring-2 focus:ring-primary/20"
        />
      </div>

      <p className="text-xs text-muted-foreground/80 mt-4 leading-relaxed">
        Al hacer clic en “Crear cuenta” o continuar con Google o Apple, aceptas nuestros{" "}
        <Link href="/terminos" className="text-primary hover:underline" target="_blank">
          Términos y Condiciones
        </Link>{" "}
        y nuestra{" "}
        <Link href="/privacidad" className="text-primary hover:underline" target="_blank">
          Política de Privacidad
        </Link>
        .
      </p>

      <button
        type="submit"
        disabled={loading || !listo}
        className="group relative flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground shadow-sm transition-all duration-200 hover:bg-primary/90 hover:shadow-md active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none mt-2"
      >
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <>
            Crear cuenta
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
          </>
        )}
      </button>

      <div className="relative py-2">
        <div className="absolute inset-0 flex items-center">
          <span className="w-full border-t border-border/50" />
        </div>
        <div className="relative flex justify-center text-xs uppercase">
          <span className="bg-auth-card px-3 text-muted-foreground/60 font-medium tracking-wider">o continuar con</span>
        </div>
      </div>

      <button
        type="button"
        onClick={handleGoogleSignup}
        disabled={!listo}
        className="flex w-full items-center justify-center gap-3 rounded-xl border border-border/50 bg-white text-black px-4 py-3 text-sm font-medium transition-colors hover:bg-gray-50"
      >
        <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
          <path d="M12.0003 4.75C13.7703 4.75 15.3553 5.36002 16.6053 6.54998L20.0303 3.125C17.9502 1.19 15.2353 0 12.0003 0C7.31028 0 3.25527 2.69 1.28027 6.60998L5.27028 9.70498C6.21525 6.86002 8.87028 4.75 12.0003 4.75Z" fill="#EA4335" />
          <path d="M23.49 12.275C23.49 11.49 23.415 10.73 23.3 10H12V14.51H18.47C18.18 15.99 17.34 17.25 16.08 18.1L19.945 21.1C22.2 19.01 23.49 15.92 23.49 12.275Z" fill="#4285F4" />
          <path d="M5.26498 14.2949C5.02498 13.5699 4.88501 12.7999 4.88501 11.9999C4.88501 11.1999 5.01998 10.4299 5.26498 9.7049L1.275 6.60986C0.46 8.22986 0 10.0599 0 11.9999C0 13.9399 0.46 15.7699 1.28 17.3899L5.26498 14.2949Z" fill="#FBBC05" />
          <path d="M12.0004 24.0001C15.2404 24.0001 17.9654 22.935 19.9454 21.095L16.0804 18.095C15.0054 18.82 13.6204 19.245 12.0004 19.245C8.8704 19.245 6.21537 17.135 5.26538 14.29L1.27539 17.385C3.25539 21.31 7.3104 24.0001 12.0004 24.0001Z" fill="#34A853" />
        </svg>
        Google
      </button>

      <button
        type="button"
        onClick={handleAppleSignup}
        disabled={!listo}
        aria-label="Continuar con Apple"
        className="flex w-full items-center justify-center gap-3 rounded-xl bg-black text-white dark:bg-white dark:text-black px-4 py-3 text-sm font-medium transition-colors hover:bg-black/90 dark:hover:bg-white/90"
      >
        <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true" fill="currentColor">
          <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09l.01-.01zM12 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" />
        </svg>
        Continuar con Apple
      </button>

      <p className="text-center text-sm text-muted-foreground pt-2">
        ¿Ya tienes cuenta?{" "}
        {/* Conserva el destino al saltar a iniciar sesion: sin esto, quien se
            equivoca de pestana pierde a donde iba. */}
        <Link href={hrefLogin} className="font-semibold text-primary hover:underline">
          Inicia sesión
        </Link>
      </p>
    </form>
  );
}
