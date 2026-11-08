"use client";

import { Instagram, MapPin, MessageCircle, Star } from "lucide-react";
import {
  listarEnlacesNegocio,
  type CanalEnlaceNegocio,
  type EnlacesNegocio as DatosEnlaces,
} from "@vicino/shared";
import { registrarClicEnlaceNegocio } from "@/app/actions/enlaces-negocio";

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

const ICONOS: Record<CanalEnlaceNegocio, typeof Instagram> = {
  instagram: Instagram,
  whatsapp: MessageCircle,
  google_maps: MapPin,
  google_resenas: Star,
};

/**
 * Fila de botones hacia los canales externos del negocio.
 *
 * Son <a> normales con target="_blank": en la web abren pestana (y Android
 * los manda a la app instalada por App Links), y en la app nativa Capacitor
 * intercepta la navegacion externa y la entrega al sistema, que abre WhatsApp,
 * Instagram o Maps si estan instalados. Por eso no hace falta @capacitor/browser
 * aqui: una pestana dentro de la app seria peor que la app del canal.
 *
 * El clic se cuenta aparte y sin esperar: si la cuenta falla, el enlace abre
 * igual. rel lleva nofollow y ugc porque el destino lo escribe el vendedor.
 */
export function EnlacesNegocio({ vendedorId, enlaces, esDueno, mostrarResenasGoogle }: EnlacesNegocioProps) {
  const lista = listarEnlacesNegocio(enlaces, { incluirResenas: esDueno || mostrarResenasGoogle });
  if (lista.length === 0) return null;

  const contar = (canal: CanalEnlaceNegocio) => {
    if (esDueno) return;
    void registrarClicEnlaceNegocio({ vendedorId, canal }).catch(() => undefined);
  };

  return (
    // <nav> con nombre, y no un <div> con aria-label: un div sin rol no se anuncia.
    <nav className="flex flex-wrap items-center gap-2" aria-label="Contacto y redes del negocio">
      {lista.map(({ canal, href, etiqueta }) => {
        const Icono = ICONOS[canal];
        return (
          <a
            key={canal}
            href={href}
            target="_blank"
            rel="noopener noreferrer nofollow ugc"
            onClick={() => contar(canal)}
            // Boton central del raton: abre en pestana nueva sin pasar por onClick.
            onAuxClick={(e) => {
              if (e.button === 1) contar(canal);
            }}
            className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold product-card-tab shadow-[inset_0_0_0_1px_rgba(0,0,0,0.06)] transition-[transform,opacity] active:translate-y-[1px] hover:opacity-90"
          >
            <Icono className="w-3.5 h-3.5" aria-hidden="true" />
            {etiqueta}
            <span className="sr-only"> (se abre fuera de VICINO)</span>
          </a>
        );
      })}
    </nav>
  );
}
