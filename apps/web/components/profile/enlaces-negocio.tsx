"use client";

import { useId, useState } from "react";
import { ChevronDown, MapPin, MessageCircle, Star, Users } from "lucide-react";
import { Capacitor } from "@capacitor/core";
import { Browser } from "@capacitor/browser";
import {
  agruparEnlacesNegocio,
  listarEnlacesNegocio,
  type CanalEnlaceNegocio,
  type EnlaceNegocioListo,
  type EnlacesNegocio as DatosEnlaces,
} from "@vicino/shared";
import { registrarClicEnlaceNegocio } from "@/app/actions/enlaces-negocio";
import { cargaDentroDelWebView } from "@/lib/perfil/abrir-enlace-externo";
import { urlPerfilVendedor } from "@/lib/navigation/url-perfil-vendedor";
import { IconoRed, tieneIconoDeMarca } from "./iconos-redes";

interface EnlacesNegocioProps {
  vendedorId: string;
  enlaces: Partial<DatosEnlaces>;
  /** El dueno ve todos sus enlaces (para comprobar que abren) y sus clics no se cuentan. */
  esDueno: boolean;
  /**
   * La resena de Google solo se ofrece a quien ya le compro a este negocio.
   * Es la regla de Google (no pedir resenas de forma selectiva ni a cambio de
   * algo) y la de VICINO: la resena de la compra se escribe dentro de VICINO.
   */
  mostrarResenasGoogle: boolean;
}

/** Iconos genericos de los canales de contacto (no son logos de marca). */
const ICONOS_GENERICOS: Partial<Record<CanalEnlaceNegocio, typeof MapPin>> = {
  whatsapp: MessageCircle,
  google_maps: MapPin,
  google_resenas: Star,
};

const CLASE_CHIP =
  "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold product-card-tab shadow-[inset_0_0_0_1px_rgba(0,0,0,0.06)] transition-[transform,opacity] active:translate-y-[1px] hover:opacity-90";

function IconoCanal({ canal }: { canal: CanalEnlaceNegocio }) {
  if (tieneIconoDeMarca(canal)) return <IconoRed canal={canal} className="w-3.5 h-3.5 shrink-0" />;
  const Generico = ICONOS_GENERICOS[canal];
  // TikTok y LinkedIn van sin icono a proposito (ver iconos-redes.tsx).
  return Generico ? <Generico className="w-3.5 h-3.5 shrink-0" aria-hidden="true" /> : null;
}

/**
 * Botones hacia los canales externos del negocio: contacto (WhatsApp,
 * Messenger, Maps, resena) y redes sociales.
 *
 * Con 4 botones o mas, las redes se pliegan en UN chip «Redes sociales» que
 * despliega la lista (regla de diseno de Alejandro, 8-nov-2026; ver
 * agruparEnlacesNegocio). Es un disclosure (boton con aria-expanded y una
 * region), no un menu: se abre debajo de la fila y no atrapa el foco.
 *
 * Son <a> normales con target="_blank": en la web abren pestana (y Android
 * los manda a la app instalada por App Links). En la app nativa, Capacitor
 * entrega al sistema la navegacion a cualquier host que no este en
 * `allowNavigation`, y el sistema abre la app de la red si esta instalada.
 * Ninguna red nueva usa un host de esa lista.
 *
 * La excepcion es Android con los hosts que SI estan en allowNavigation por
 * el OAuth (`*.google.com`: www.google.com/maps, maps.google.com,
 * search.google.com/local/writereview): ahi el WebView cargaria la web de
 * Google encima de la ficha. Para esos, y solo esos, se abre con
 * @capacitor/browser. Ver lib/perfil/abrir-enlace-externo.ts.
 *
 * El clic se cuenta aparte y sin esperar: si la cuenta falla, el enlace abre
 * igual. rel lleva nofollow y ugc porque el destino lo escribe el vendedor.
 */
export function EnlacesNegocio({ vendedorId, enlaces, esDueno, mostrarResenasGoogle }: EnlacesNegocioProps) {
  const [redesAbiertas, setRedesAbiertas] = useState(false);
  const idPanelRedes = useId();
  const lista = listarEnlacesNegocio(enlaces, {
    incluirResenas: esDueno || mostrarResenasGoogle,
    urlPerfil: urlPerfilVendedor(vendedorId),
  });
  if (lista.length === 0) return null;
  const { visibles, redesPlegadas } = agruparEnlacesNegocio(lista);

  const contar = (canal: CanalEnlaceNegocio) => {
    if (esDueno) return;
    void registrarClicEnlaceNegocio({ vendedorId, canal }).catch(() => undefined);
  };

  const abrir = (e: React.MouseEvent<HTMLAnchorElement>, canal: CanalEnlaceNegocio, href: string) => {
    contar(canal);
    if (cargaDentroDelWebView(href, Capacitor.getPlatform())) {
      e.preventDefault();
      void Browser.open({ url: href }).catch(() => {
        // Si el plugin falla, mejor la web de Google en el WebView que nada.
        window.location.assign(href);
      });
    }
  };

  const chip = ({ canal, href, etiqueta }: EnlaceNegocioListo) => (
    <a
      key={canal}
      href={href}
      target="_blank"
      rel="noopener noreferrer nofollow ugc"
      onClick={(e) => abrir(e, canal, href)}
      // Boton central del raton: abre en pestana nueva sin pasar por onClick.
      onAuxClick={(e) => {
        if (e.button === 1) contar(canal);
      }}
      className={CLASE_CHIP}
    >
      <IconoCanal canal={canal} />
      {etiqueta}
      <span className="sr-only"> (se abre fuera de VICINO)</span>
    </a>
  );

  return (
    // <nav> con nombre, y no un <div> con aria-label: un div sin rol no se anuncia.
    <nav className="space-y-2" aria-label="Contacto y redes del negocio">
      <div className="flex flex-wrap items-center gap-2">
        {visibles.map(chip)}
        {redesPlegadas ? (
          <button
            type="button"
            aria-expanded={redesAbiertas}
            aria-controls={idPanelRedes}
            onClick={() => setRedesAbiertas((abiertas) => !abiertas)}
            className={CLASE_CHIP}
          >
            <Users className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            Redes sociales
            <span className="sr-only"> ({redesPlegadas.length})</span>
            <ChevronDown
              className={`w-3.5 h-3.5 shrink-0 transition-transform ${redesAbiertas ? "rotate-180" : ""}`}
              aria-hidden="true"
            />
          </button>
        ) : null}
      </div>
      {redesPlegadas ? (
        <div id={idPanelRedes} hidden={!redesAbiertas} className="flex flex-wrap items-center gap-2">
          {redesPlegadas.map(chip)}
        </div>
      ) : null}
    </nav>
  );
}
