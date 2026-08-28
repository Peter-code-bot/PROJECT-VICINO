"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Search, Plus, MessageCircle, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { useChatUnread } from "@/components/layout/chat-unread-provider";
import { hapticLight } from "@/lib/haptics";
import { CATEGORIES } from "@vicino/shared";

const NAV_ITEMS = [
  { href: "/", label: "Inicio", icon: Home },
  { href: "/buscar", label: "Buscar", icon: Search },
  { href: "/vender", label: "Vender", icon: Plus },
  { href: "/chat", label: "Chat", icon: MessageCircle },
  { href: "/perfil", label: "Perfil", icon: User },
] as const;

/** El ítem que sube al círculo central. Ver openspec/changes/2026-08-27-liquid-navigation. */
const HREF_CENTRAL = "/vender";

// Slugs de categoria validos en URL. A nivel de modulo para no recrear
// el Set en cada render. Sin filtrar hidden_in_form: las ocultas
// tambien son slugs de URL validos.
const CATEGORY_SLUGS = new Set<string>(CATEGORIES.map((c) => c.slug));

interface BottomNavProps {
  /**
   * Whether the current user has opted in to seller mode. When false, the
   * "Vender" item is hidden and the nav renders 4 items instead of 5.
   */
  isVendedor: boolean;
}

/**
 * Barra inferior del móvil, con el acabado de la referencia que pidió Alejandro:
 * píldora flotante de vidrio y botón circular elevado en el centro.
 *
 * ESTE COMPONENTE ES PIEL. Lo que NO cambia, y hay que conservar al tocarlo:
 *   - `aria-current` y `aria-label` de cada ítem.
 *   - Los `id` (`nav-inicio`, `nav-buscar`…): el onboarding los busca POR ID
 *     para señalarlos. Romperlos no falla nada, solo deja de señalar — que es
 *     la peor forma de romper algo.
 *   - El badge de mensajes sin leer.
 *   - La háptica al tocar.
 *   - Que la barra desaparezca dentro del detalle de un chat, donde el teclado
 *     y la caja de escribir necesitan el sitio, y dentro de la ficha de
 *     producto, donde manda el StickyCta y el circulo central se le encimaba.
 *   - `md:hidden`: en escritorio manda el Sidebar.
 */
export function BottomNav({ isVendedor }: BottomNavProps) {
  const pathname = usePathname();
  const unreadChatMessages = useChatUnread();

  const onChatDetail = /^\/chat\/[^/]+/.test(pathname);
  const segments = pathname.split("/").filter(Boolean);
  const onProductDetail =
    segments.length === 2 && CATEGORY_SLUGS.has(segments[0] ?? "");
  if (onChatDetail || onProductDetail) return null;

  const esActivo = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  // Quien no es vendedora sigue viendo cuatro ítems y ninguna burbuja central.
  // NO se sustituye por "Empezar a vender": eso seria cambiar la navegacion, y
  // este cambio es de presentacion.
  const central = isVendedor
    ? NAV_ITEMS.find((i) => i.href === HREF_CENTRAL)
    : undefined;
  // "Vender" sale SIEMPRE de la fila: o sube a la burbuja, o no existe para
  // quien no es vendedora. Los otros cuatro son los mismos en los dos casos.
  const enLaPildora = NAV_ITEMS.filter((i) => i.href !== HREF_CENTRAL);

  // Con burbuja central, la pildora se reparte en dos mitades a su alrededor.
  const mitad = Math.ceil(enLaPildora.length / 2);
  const izquierda = central ? enLaPildora.slice(0, mitad) : enLaPildora;
  const derecha = central ? enLaPildora.slice(mitad) : [];

  return (
    <nav
      className="fixed inset-x-0 z-50 md:hidden"
      style={{ bottom: "calc(env(safe-area-inset-bottom) + 12px)" }}
      aria-label="Navegación principal"
    >
      <div className="relative mx-3">
        <div
          className={cn(
            "liquid-nav flex h-16 items-center rounded-[26px] px-2",
            central ? "justify-between" : "justify-around",
          )}
        >
          <Grupo
            items={izquierda}
            esActivo={esActivo}
            unread={unreadChatMessages}
          />
          {/* Hueco reservado para la burbuja. Se reserva en el FLUJO en vez de
              recortar la pildora: recortar el elemento que lleva el
              backdrop-filter deja el borde del desenfoque mordido. */}
          {central && <span className="w-16 shrink-0" aria-hidden />}
          <Grupo
            items={derecha}
            esActivo={esActivo}
            unread={unreadChatMessages}
          />
        </div>

        {central && (
          <Link
            href={central.href}
            aria-label={central.label}
            aria-current={esActivo(central.href) ? "page" : undefined}
            id={`nav-${central.label.toLowerCase()}`}
            onClick={() => void hapticLight()}
            className={cn(
              "liquid-nav-fab absolute left-1/2 flex h-[60px] w-[60px] -translate-x-1/2",
              "items-center justify-center rounded-full bg-brand text-white",
              "transition-transform duration-150 active:scale-[0.94]",
              "motion-reduce:transition-none motion-reduce:active:scale-100",
            )}
            style={{ top: "-22px" }}
          >
            <central.icon className="h-7 w-7" strokeWidth={2.5} />
          </Link>
        )}
      </div>
    </nav>
  );
}

function Grupo({
  items,
  esActivo,
  unread,
}: {
  items: readonly (typeof NAV_ITEMS)[number][];
  esActivo: (href: string) => boolean;
  unread: number;
}) {
  if (items.length === 0) return null;
  return (
    <div className="flex items-center">
      {items.map(({ href, label, icon: Icon }) => {
        const activo = esActivo(href);
        return (
          <Link
            key={href}
            href={href}
            aria-label={label}
            aria-current={activo ? "page" : undefined}
            id={`nav-${label.toLowerCase()}`}
            onClick={() => void hapticLight()}
            className="relative inline-flex h-12 w-[52px] flex-col items-center justify-center rounded-2xl"
          >
            {/* El indicador es un elemento aparte del icono para poder
                animarlo sin arrastrar el icono en la transicion. */}
            <span
              className={cn(
                "liquid-nav-indicador absolute inset-x-1.5 top-1 h-9 rounded-2xl bg-brand-tint",
                activo ? "scale-100 opacity-100" : "scale-75 opacity-0",
              )}
              aria-hidden
            />
            <Icon
              className={cn(
                "relative h-[22px] w-[22px] transition-colors duration-150",
                activo ? "text-brand-hi" : "text-fg-muted",
              )}
              strokeWidth={activo ? 2.4 : 2}
            />
            {href === "/chat" && unread > 0 && (
              <span
                className="absolute right-0.5 top-0.5 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold leading-none text-white shadow-[0_0_0_2px_var(--bg)]"
                aria-label={`${unread} mensajes sin leer`}
              >
                {unread > 99 ? "99+" : unread}
              </span>
            )}
          </Link>
        );
      })}
    </div>
  );
}
