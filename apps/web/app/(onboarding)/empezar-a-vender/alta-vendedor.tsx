"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CATEGORIES } from "@vicino/shared";
import { iconoDeCategoria } from "@/lib/categories/icons";
import { toast } from "sonner";
import { Check, ChevronLeft, Store, User } from "lucide-react";
import { activarModoVendedor } from "./actions";
import { guardarPasoOnboarding } from "@/app/(onboarding)/completar-perfil/actions";
import { MetodosPagoSelector } from "@/components/profile/metodos-pago-selector";
import { AvatarInlineUpload } from "@/components/profile/avatar-inline-upload";

/**
 * Alta de vendedor, con el patrón de Instagram: convertir con lo mínimo y
 * pedir lo demás después.
 *
 * Verificado en el Centro de ayuda de Meta: la conversión a cuenta profesional
 * se resuelve en dos decisiones —categoría y tipo— y a partir de ahí la cuenta
 * YA ES profesional; contacto y visibilidad vienen después y son omitibles.
 *
 * Dos detalles que se copian a propósito:
 *
 *   · CATEGORÍA ANTES QUE TIPO. En la app de Instagram ese es el orden; en su
 *     web está invertido, y la contradicción está dentro de su propia página de
 *     ayuda. VICINO es Capacitor, o sea móvil primero, así que se copia el
 *     orden de la app. Y como Instagram, se aclara que una no determina la otra.
 *   · LA CATEGORIA NO SE PUEDE APLAZAR. Instagram ofrece escapes con nombre
 *     propio en vez de un «saltar» gris, y aqui hubo uno: «Elegir categoria
 *     despues». Se quito porque prometia una pantalla que no existe en ningun
 *     sitio de la app. Peor: en cuanto el vendedor publica su primer producto
 *     el alta se cierra y /empezar-a-vender deja de ser accesible, asi que la
 *     categoria aplazada se perdia para siempre. Un escape que no lleva a
 *     ninguna parte es peor que no tenerlo. «Continuar» ya exige categoria.
 *
 * Ningun paso toca la base hasta la activacion. En negocio escribe el paso
 * de datos; en casual, la pantalla de activar. Es la escritura que desbloquea
 * publicar: hasta entonces la policy «Sellers can create products» lo impide.
 */

type Paso = "categoria" | "tipo" | "negocio" | "activar" | "listo";

/** Solo las que se ofrecen en el formulario de publicar: mismo criterio. */
const CATEGORIAS_VISIBLES = CATEGORIES.filter((c) => !c.hidden_in_form);

function ListaDePrivacidad({
  nombreMostrado,
  conSeparador = false,
}: {
  nombreMostrado: string;
  conSeparador?: boolean;
}) {
  return (
    <div
      className={`space-y-3 text-sm text-muted-foreground${conSeparador ? " pt-4 border-t border-border/50" : ""}`}
    >
      <p className="text-foreground">Al activarlo, esto se vuelve público en tu perfil:</p>
      <ul className="space-y-1.5">
        <li>· {nombreMostrado}</li>
        <li>· Tu categoría</li>
        <li>· La colonia que registres — nunca tu dirección exacta</li>
      </ul>
      <p>
        Puedes desactivar el Modo Vendedor cuando quieras. Al desactivarlo, tus
        publicaciones activas se pausan y dejan de verse; no se borran.
      </p>
    </div>
  );
}

export function AltaVendedor({
  nombre,
  yaCompletoOnboarding = false,
}: {
  nombre: string | null;
  /**
   * Si esta persona ya termino el onboarding. Cambia a donde lleva el boton
   * final: quien no lo termino sigue a los pasos compartidos, y quien si —un
   * usuario de siempre que se hace vendedor hoy— va directo a publicar, porque
   * /completar-perfil lo devolveria al home y se quedaria sin el empujon que la
   * pantalla acaba de prometerle.
   */
  yaCompletoOnboarding?: boolean;
}) {
  const router = useRouter();
  const [paso, setPaso] = useState<Paso>("categoria");
  const [categoria, setCategoria] = useState<string | null>(null);
  const [tipo, setTipo] = useState<"casual" | "business">("casual");
  const [nombreNegocio, setNombreNegocio] = useState("");
  const [descripcionNegocio, setDescripcionNegocio] = useState("");
  const [metodosPago, setMetodosPago] = useState<string[]>([]);
  const [fotoUrl, setFotoUrl] = useState("");
  const [error, setError] = useState("");
  const [enviando, startTransition] = useTransition();

  // El banner de error se pinta arriba del contenedor, fuera de los pasos.
  // Sin esto, un error de un paso persigue al vendedor por todo el flujo:
  // paso en produccion con el error de subir la foto.
  //
  // Limpiarlo aqui y no en un efecto sobre `paso`: el efecto era una reaccion
  // a un cambio que ya se sabe cuando ocurre, y React lo cobra con un render
  // en cascada (react-hooks/set-state-in-effect). Cambiar de paso es SIEMPRE
  // una decision explicita, asi que la limpieza viaja con la decision.
  function irAPaso(siguiente: Paso) {
    setError("");
    setPaso(siguiente);
  }

  function activar() {
    setError("");
    startTransition(async () => {
      const r = await activarModoVendedor({
        categoria,
        tipo,
        nombreNegocio: nombreNegocio.trim(),
        descripcionNegocio: descripcionNegocio.trim(),
        metodosPago: metodosPago.join(", "),
        foto: fotoUrl,
      });
      if (r.error) {
        setError(r.error);
        return;
      }
      // Ya es vendedor: a partir de aqui le tocan los pasos compartidos del
      // onboarding. Se marca el paso AHORA y no al tocar «Continuar» para que
      // quien cierre la app en esta pantalla vuelva a los pasos compartidos y
      // no al alta, que ya termino.
      //
      // Si esta escritura falla NO se bloquea nada: la activacion —que es lo
      // caro y lo que desbloquea publicar— ya ocurrio, y /bienvenida sabe
      // reenviar igualmente por `onboarding_camino` + `es_vendedor`.
      //
      // Solo para quien NO ha terminado el onboarding. Marcarselo a alguien que
      // ya lo completo dejaria un onboarding_paso pendiente en un perfil
      // terminado — un estado que la propia migracion documenta como
      // imposible— y que ademas no gobierna nada, porque has_seen_onboarding
      // manda por delante. Basura de estado, y de la que confunde al leerla.
      if (!yaCompletoOnboarding) {
        const siguientePaso = tipo === "business" ? "intereses" : "perfil";
        const paso = await guardarPasoOnboarding({ camino: "vender", paso: siguientePaso });
        if (paso.error) console.warn("[alta] no se pudo marcar el paso", paso.error);
      }
      irAPaso("listo");
    });
  }

  return (
    <div className="w-full max-w-md px-6 py-10">
      <div className="mb-8 flex items-center justify-between">
        {paso !== "categoria" && paso !== "listo" ? (
          <button
            type="button"
            onClick={() => {
              if (paso === "activar") irAPaso("tipo");
              else if (paso === "negocio") irAPaso("tipo");
              else irAPaso("categoria");
            }}
            className="text-muted-foreground hover:text-foreground"
            aria-label="Regresar"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
        ) : (
          <span />
        )}
        {/* Se va la «x» de salir. La regla 1 del plan es que el onboarding es
            obligatorio: sin botones de saltar, sin «completar despues» y sin
            «x» para cerrar. Esta mandaba al home a mitad del alta y dejaba
            justo el perfil a medias que el flujo viene a evitar. Queda solo la
            flecha de regresar, que no pierde lo ya escrito. */}
        <span />
      </div>

      {error && (
        <div
          role="alert"
          className="mb-5 rounded-xl bg-[rgba(255,59,48,0.08)] p-3 text-sm text-[color:var(--danger)]"
        >
          {error}
        </div>
      )}


      {/* ---------------------------------------------------------------- */}
      {/* P1 — Categoría. Lista cerrada: VICINO tiene 32, no mil.          */}
      {/* ---------------------------------------------------------------- */}
      {paso === "categoria" && (
        <div className="space-y-5 animate-fade-in">
          <div>
            <h1 className="font-heading text-2xl font-bold">¿Qué vendes?</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Elige la categoría que mejor describa lo que ofreces. La puedes cambiar
              cuando quieras.
            </p>
          </div>

          <div className="max-h-[46vh] space-y-1 overflow-y-auto pr-1">
            {CATEGORIAS_VISIBLES.map((c) => {
              const Icono = iconoDeCategoria(c.slug);
              const elegida = categoria === c.slug;
              return (
                <button
                  key={c.slug}
                  type="button"
                  onClick={() => setCategoria(elegida ? null : c.slug)}
                  className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors ${
                    elegida
                      ? "bg-[color:var(--brand)]/10 shadow-[inset_0_0_0_1px_var(--brand)]"
                      : "hover:bg-[color:var(--bg-elev-2)]"
                  }`}
                >
                  <Icono className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm">{c.name}</span>
                    <span className="block truncate text-[11px] text-muted-foreground">
                      {c.ejemplos}
                    </span>
                  </span>
                  {elegida && <Check className="h-4 w-4 shrink-0 text-[color:var(--brand)]" />}
                </button>
              );
            })}
          </div>

          <p className="text-xs text-muted-foreground">
            La categoría que elijas no define si tu cuenta será Casual o de Negocio.
            Eso lo eliges en el siguiente paso.
          </p>
          <p className="text-xs text-muted-foreground">
            Tu categoría se ve en tu perfil, debajo de tu foto.
          </p>

          <div className="space-y-2">
            <button
              type="button"
              onClick={() => irAPaso("tipo")}
              disabled={!categoria}
              className="w-full rounded-2xl bg-[color:var(--brand)] py-3 font-semibold text-white transition-transform active:scale-[0.98] disabled:opacity-40"
            >
              Continuar
            </button>
          </div>
        </div>
      )}

      {/* ---------------------------------------------------------------- */}
      {/* P2 — Tipo de vendedor.                                           */}
      {/* ---------------------------------------------------------------- */}
      {paso === "tipo" && (
        <div className="space-y-5 animate-fade-in">
          <h1 className="font-heading text-2xl font-bold">¿Cómo vas a vender?</h1>

          <div className="space-y-3">
            {(
              [
                {
                  valor: "casual" as const,
                  icono: User,
                  titulo: "Casual",
                  texto: "Vendo cosas mías. De vez en cuando, artículos personales.",
                },
                {
                  valor: "business" as const,
                  icono: Store,
                  titulo: "Negocio",
                  texto:
                    "Tengo un changarro o una tienda. Quiero que se vea el nombre de mi negocio.",
                },
              ]
            ).map((o) => {
              const Icono = o.icono;
              const elegido = tipo === o.valor;
              return (
                <button
                  key={o.valor}
                  type="button"
                  onClick={() => setTipo(o.valor)}
                  className={`flex w-full gap-3 rounded-2xl p-4 text-left transition-colors ${
                    elegido
                      ? "bg-[color:var(--brand)]/5 shadow-[inset_0_0_0_1px_var(--brand)]"
                      : "bg-card shadow-[inset_0_0_0_1px_var(--border)] hover:bg-[color:var(--bg-elev-2)]"
                  }`}
                >
                  <Icono className="mt-0.5 h-5 w-5 shrink-0 text-[color:var(--brand)]" />
                  <span>
                    <span className="block font-heading font-semibold">{o.titulo}</span>
                    <span className="mt-0.5 block text-sm text-muted-foreground">
                      {o.texto}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>

          <p className="text-xs text-muted-foreground">
            Puedes cambiar de tipo cuando quieras.
          </p>

          <button
            type="button"
            onClick={() => irAPaso(tipo === "business" ? "negocio" : "activar")}
            className="w-full rounded-2xl bg-[color:var(--brand)] py-3 font-semibold text-white transition-transform active:scale-[0.98]"
          >
            Continuar
          </button>
        </div>
      )}
      {/* ---------------------------------------------------------------- */}
      {/* P3 — Datos del negocio.                                          */}
      {/* ---------------------------------------------------------------- */}
      {paso === "negocio" && (
        <div className="space-y-6 animate-fade-in">
          <div>
            <h1 className="font-heading text-2xl font-bold">Cuéntanos de tu negocio</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Así te encuentran los compradores de tu colonia.
            </p>
          </div>
          <div className="space-y-5">
            <div className="space-y-1.5">
              <label htmlFor="nombreNegocio" className="block text-sm font-medium text-foreground">Nombre de la tienda</label>
              <input id="nombreNegocio" type="text" value={nombreNegocio} onChange={(e) => setNombreNegocio(e.target.value)} placeholder="Mi Tienda Local" className="w-full rounded-xl bg-muted px-4 py-3 text-base outline-none transition-all placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-primary/40" />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="descripcionNegocio" className="block text-sm font-medium text-foreground">Descripción del negocio <span className="text-muted-foreground font-normal">(Opcional)</span></label>
              <textarea id="descripcionNegocio" rows={2} maxLength={1000} value={descripcionNegocio} onChange={(e) => setDescripcionNegocio(e.target.value)} placeholder="¿Qué tipo de productos ofreces?" className="w-full rounded-xl bg-muted px-4 py-3 text-base outline-none transition-all placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-primary/40 resize-none" />
            </div>
            <div className="space-y-1.5">
              <span className="block text-sm font-medium text-foreground">Métodos de pago <span className="text-muted-foreground font-normal">(Opcional)</span></span>
              <MetodosPagoSelector metodosSeleccionados={metodosPago} onChange={setMetodosPago} />
            </div>
            <div className="space-y-1.5">
              <span className="block text-sm font-medium text-foreground">Foto de perfil <span className="text-muted-foreground font-normal">(Opcional)</span></span>
              <AvatarInlineUpload
                conRecorte
                initial={nombreNegocio.charAt(0)?.toUpperCase() || nombre?.charAt(0)?.toUpperCase() || "?"}
                avatarUrl={fotoUrl} 
                onUploadSuccess={setFotoUrl} 
                onError={(msg) => toast.error(msg, { duration: 2000 })} 
              />
            </div>
          </div>

          <ListaDePrivacidad
            nombreMostrado={nombreNegocio.trim() || "Tu nombre, o el nombre de tu negocio"}
            conSeparador
          />
          
          <p className="text-xs text-muted-foreground pb-2">
            Al activar el Modo Vendedor aceptas los <a href="/terminos" target="_blank" className="underline hover:text-foreground">Términos</a> y el <a href="/privacidad" target="_blank" className="underline hover:text-foreground">Aviso de Privacidad</a>.
          </p>

          <button type="button" disabled={!nombreNegocio.trim() || enviando} onClick={activar} className="w-full rounded-2xl bg-[color:var(--brand)] py-3 font-semibold text-white transition-transform active:scale-[0.98] disabled:opacity-60">
            {enviando ? "Activando..." : "Activar Modo Vendedor"}
          </button>
        </div>
      )}

      {/* ---------------------------------------------------------------- */}
      {/* P4 — Activacion (casual). Para negocio la escritura ya ocurrio    */}
      {/*      en P3; aqui solo se confirma.                                */}
      {/*                                                                   */}
      {/* Se avisa ANTES de lo que se vuelve público, no después. Ese es el */}
      {/* patrón de Instagram al convertir la cuenta.                       */}
      {/* ---------------------------------------------------------------- */}
      {paso === "activar" && (
        <div className="space-y-6 animate-fade-in">
          <h1 className="font-heading text-2xl font-bold">Activa tu Modo Vendedor</h1>

          <ListaDePrivacidad
            nombreMostrado={nombreNegocio.trim() || "Tu nombre, o el nombre de tu negocio"}
          />

          <div className="space-y-2">
            <button
              type="button"
              onClick={activar}
              disabled={enviando}
              className="w-full rounded-2xl bg-[color:var(--brand)] py-3 font-semibold text-white transition-transform active:scale-[0.98] disabled:opacity-60"
            >
              {enviando ? "Activando…" : "Activar Modo Vendedor"}
            </button>
            <button
              type="button"
              onClick={() => irAPaso("tipo")}
              className="w-full py-2 text-sm text-muted-foreground hover:text-foreground"
            >
              Regresar
            </button>
          </div>
        </div>
      )}

      {/* ---------------------------------------------------------------- */}
      {/* P5 — Listo, y lo que falta.                                      */}
      {/*                                                                   */}
      {/* Instagram devuelve un panel profesional justo despues de          */}
      {/* convertir. VICINO no monetiza, asi que no hay metricas: lo que se */}
      {/* ensena es el pendiente, que es lo unico que de verdad le sirve.   */}
      {/* ---------------------------------------------------------------- */}
      {paso === "listo" && (
        <div className="space-y-6 animate-fade-in">
          <h1 className="font-heading text-2xl font-bold">
            Bienvenido a VICINO, {tipo === "business" && nombreNegocio ? nombreNegocio.trim() : (nombre ? nombre.split(" ")[0] : "")}
          </h1>

          {/* El texto de esta pantalla se corrigió tras comprobar la premisa.
              El borrador decía "registra tu colonia: sin ella no apareces en el
              feed de nadie", y ES FALSO: el feed filtra por la ubicación de
              CADA PUBLICACIÓN (ps.ubicacion_geo), no por la colonia del perfil
              — comprobado leyendo search_nearby_products_v4, que ni siquiera
              mira pr.ubicacion. La colonia del perfil solo se muestra en el
              perfil (profile-header.tsx:171).

              Por eso el paso que de verdad hace aparecer a alguien es PUBLICAR,
              y esa pasa a ser la acción principal. Es además lo que distingue a
              un marketplace de Instagram: Instagram termina en un perfil, un
              marketplace tiene que terminar en una publicación. */}
          <div className="space-y-3 text-sm text-muted-foreground">
            <p className="text-foreground">Ya eres vendedor. Esto es lo que se te abre:</p>
            <ul className="space-y-2">
              <li className="flex gap-2">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-[color:var(--brand)]" />
                Tus publicaciones aparecen en el mapa de quien está cerca de ti.
              </li>
              <li className="flex gap-2">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-[color:var(--brand)]" />
                Los compradores de tu zona te escriben directo.
              </li>
              <li className="flex gap-2">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-[color:var(--brand)]" />
                Entras a los rankings de vendedores de tu zona, que se renuevan cada mes.
              </li>
              <li className="flex gap-2">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-[color:var(--brand)]" />
                Se activa Mi tienda, donde ves tus publicaciones, tus ventas del mes y tus reseñas.
              </li>
            </ul>
            <p className="text-foreground">
              Falta una sola cosa para que la gente te encuentre: <strong>publicar.</strong>
            </p>
            <p>
              Cuando publicas eliges en el mapa dónde estás, y es esa ubicación, la de
              cada publicación y no la de tu perfil, la que te hace aparecer cuando
              alguien busca cerca. Un perfil sin publicaciones no sale en ninguna
              búsqueda.
            </p>
            <p>
              VICINO no cobra comisión ni suscripción. El trato lo cierras tú.
            </p>
          </div>

          {/* Esta pantalla pasa a ser un PUENTE hacia los pasos compartidos del
              onboarding (perfil, intereses, ubicacion), que es lo que manda el
              plan para los tres caminos.

              Se van los dos botones que habia. «Ahora no» era un escape, y el
              onboarding es obligatorio. Y «Publicar» mandaba directo a /vender
              saltandose esos pasos, que es como se llega a la app con el perfil
              vacio — justo lo que este flujo viene a evitar.

              El empujon a publicar NO se pierde: activar deja
              alta_vendedor_paso en 'publicacion', y de ahi sale el aviso del
              perfil que le recuerda al vendedor que le falta publicar. Solo
              deja de ser lo primero. */}
          <button
            type="button"
            onClick={() => router.push(yaCompletoOnboarding ? "/vender" : "/completar-perfil")}
            className="w-full rounded-2xl bg-[color:var(--brand)] py-3 font-semibold text-white transition-transform active:scale-[0.98]"
          >
            {yaCompletoOnboarding ? "Publicar" : "Continuar"}
          </button>
        </div>
      )}
    </div>
  );
}
