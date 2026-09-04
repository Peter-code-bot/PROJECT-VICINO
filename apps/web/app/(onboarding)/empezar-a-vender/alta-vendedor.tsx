"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CATEGORIES } from "@vicino/shared";
import { iconoDeCategoria } from "@/lib/categories/icons";
import { Check, ChevronLeft, Store, User, X } from "lucide-react";
import { activarModoVendedor } from "./actions";
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
 *   · BOTONES DE ESCAPE CON NOMBRE PROPIO. Instagram no usa un «saltar» gris:
 *     usa «No usar mi información de contacto». Aquí, «Elegir categoría
 *     después» y «Ahora no».
 *
 * Los pasos 1 a 3 NO tocan la base. Solo el 4 escribe, y es el que desbloquea
 * publicar: hasta entonces la policy «Sellers can create products» lo impide.
 */

type Paso = "valor" | "categoria" | "tipo" | "negocio" | "activar" | "listo";

/** Solo las que se ofrecen en el formulario de publicar: mismo criterio. */
const CATEGORIAS_VISIBLES = CATEGORIES.filter((c) => !c.hidden_in_form);

export function AltaVendedor({ nombre }: { nombre: string | null }) {
  const router = useRouter();
  const [paso, setPaso] = useState<Paso>("valor");
  const [categoria, setCategoria] = useState<string | null>(null);
  const [tipo, setTipo] = useState<"casual" | "business">("casual");
  const [nombreNegocio, setNombreNegocio] = useState("");
  const [descripcionNegocio, setDescripcionNegocio] = useState("");
  const [metodosPago, setMetodosPago] = useState<string[]>([]);
  const [fotoUrl, setFotoUrl] = useState("");
  const [error, setError] = useState("");
  const [enviando, startTransition] = useTransition();

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
      setPaso("listo");
    });
  }

  return (
    <div className="w-full max-w-md px-6 py-10">
      {/* Salida siempre visible. Instagram la tiene y devuelve a un perfil
          funcional, no a un limbo. */}
      <div className="mb-8 flex items-center justify-between">
        {paso !== "valor" && paso !== "listo" ? (
          <button
            type="button"
            onClick={() => {
              if (paso === "activar") setPaso(tipo === "business" ? "negocio" : "tipo");
              else if (paso === "negocio") setPaso("tipo");
              else if (paso === "tipo") setPaso("categoria");
              else setPaso("valor");
            }}
            className="text-muted-foreground hover:text-foreground"
            aria-label="Regresar"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
        ) : (
          <span />
        )}
        {paso !== "listo" && (
          <button
            type="button"
            onClick={() => router.push("/")}
            className="text-muted-foreground hover:text-foreground"
            aria-label="Salir"
          >
            <X className="h-5 w-5" />
          </button>
        )}
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
      {/* P1 — Qué ganas. Ni un campo: el premio antes que el formulario.   */}
      {/* ---------------------------------------------------------------- */}
      {paso === "valor" && (
        <div className="space-y-6 animate-fade-in">
          <h1 className="font-heading text-2xl font-bold">Vende en tu colonia</h1>
          <div className="space-y-3 text-sm text-muted-foreground">
            <p className="text-foreground">Al activar el Modo Vendedor:</p>
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
                Entras a los rankings de vendedores de Puebla.
              </li>
            </ul>
            <p className="pt-2">
              VICINO no cobra comisión ni suscripción. Nosotros solo los conectamos;
              el trato lo cierran ustedes.
            </p>
          </div>
          <div className="space-y-2 pt-2">
            <button
              type="button"
              onClick={() => setPaso("categoria")}
              className="w-full rounded-2xl bg-[color:var(--brand)] py-3 font-semibold text-white transition-transform active:scale-[0.98]"
            >
              Continuar
            </button>
            <button
              type="button"
              onClick={() => router.push("/")}
              className="w-full py-2 text-sm text-muted-foreground hover:text-foreground"
            >
              Ahora no
            </button>
          </div>
        </div>
      )}

      {/* ---------------------------------------------------------------- */}
      {/* P2 — Categoría. Lista cerrada: VICINO tiene 32, no mil.          */}
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
              onClick={() => setPaso("tipo")}
              disabled={!categoria}
              className="w-full rounded-2xl bg-[color:var(--brand)] py-3 font-semibold text-white transition-transform active:scale-[0.98] disabled:opacity-40"
            >
              Continuar
            </button>
            {/* Escape con nombre propio, no un "saltar" gris. */}
            <button
              type="button"
              onClick={() => {
                setCategoria(null);
                setPaso("tipo");
              }}
              className="w-full py-2 text-sm text-muted-foreground hover:text-foreground"
            >
              Elegir categoría después
            </button>
          </div>
        </div>
      )}

      {/* ---------------------------------------------------------------- */}
      {/* P3 — Tipo de vendedor.                                           */}
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
            onClick={() => setPaso(tipo === "business" ? "negocio" : "activar")}
            className="w-full rounded-2xl bg-[color:var(--brand)] py-3 font-semibold text-white transition-transform active:scale-[0.98]"
          >
            Continuar
          </button>
        </div>
      )}
      {/* ---------------------------------------------------------------- */}
      {/* P3.5 — Datos del negocio.                                        */}
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
              <AvatarInlineUpload initial={nombreNegocio.charAt(0)?.toUpperCase() || nombre?.charAt(0)?.toUpperCase() || "?"} avatarUrl={fotoUrl} onUploadSuccess={setFotoUrl} onError={setError} />
            </div>
          </div>
          <button type="button" disabled={!nombreNegocio.trim()} onClick={() => setPaso("activar")} className="w-full rounded-2xl bg-[color:var(--brand)] py-3 font-semibold text-white transition-transform active:scale-[0.98] disabled:opacity-40">
            Continuar
          </button>
        </div>
      )}

      {/* ---------------------------------------------------------------- */}
      {/* P4 — Activación. AQUÍ, y solo aquí, se escribe.                  */}
      {/*                                                                   */}
      {/* Se avisa ANTES de lo que se vuelve público, no después. Ese es el */}
      {/* patrón de Instagram al convertir la cuenta.                       */}
      {/* ---------------------------------------------------------------- */}
      {paso === "activar" && (
        <div className="space-y-6 animate-fade-in">
          <h1 className="font-heading text-2xl font-bold">Activa tu Modo Vendedor</h1>

          <div className="space-y-3 text-sm text-muted-foreground">
            <p className="text-foreground">Al activarlo, esto se vuelve público en tu perfil:</p>
            <ul className="space-y-1.5">
              <li>· {nombreNegocio.trim() ? nombreNegocio.trim() : "Tu nombre, o el nombre de tu negocio"}</li>
              <li>· Tu categoría</li>
              <li>· La colonia que registres — nunca tu dirección exacta</li>
            </ul>
            <p className="pt-1">
              Tu teléfono y tu correo <strong>no</strong> se publican. Tú decides si los
              muestras, y eso lo eliges más adelante.
            </p>
            <p>
              Puedes desactivar el Modo Vendedor cuando quieras. Al desactivarlo, tus
              publicaciones activas se pausan y dejan de verse; no se borran.
            </p>
          </div>

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
              onClick={() => setPaso("tipo")}
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
            <p className="text-foreground">
              Ya eres vendedor. Falta una sola cosa para que la gente te encuentre: <strong>publicar.</strong>
            </p>
            <p>
              Cuando publicas eliges en el mapa dónde estás, y es esa ubicación —la de cada publicación, no la de tu perfil— la que te hace aparecer cuando alguien busca cerca. Un perfil sin publicaciones no sale en ninguna búsqueda.
            </p>
            <p>
              VICINO no cobra comisión ni suscripción. El comprador te escribe directo y el trato lo cierras tú.
            </p>
            <p className="pt-1">
              El aviso de "Termina tu alta de vendedor" se queda en tu perfil hasta que publiques tu primera cosa.
            </p>
          </div>

          <div className="space-y-2">
            <button
              type="button"
              onClick={() => router.push("/vender")}
              className="w-full rounded-2xl bg-[color:var(--brand)] py-3 font-semibold text-white transition-transform active:scale-[0.98]"
            >
              Publicar
            </button>
            <button
              type="button"
              onClick={() => {
                router.refresh();
                router.push("/");
              }}
              className="w-full py-2 text-sm text-muted-foreground hover:text-foreground"
            >
              Ahora no
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
