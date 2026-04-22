import Link from "next/link";
import { MapPin, ShieldCheck } from "lucide-react";

export function Footer() {
  return (
    <footer className="bg-charcoal dark:bg-[#0A0A14] text-white/60 pt-12 pb-6">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8 mb-10">
          {/* Brand */}
          <div className="col-span-2 md:col-span-1">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-7 h-7 rounded-lg bg-terracotta flex items-center justify-center">
                <MapPin className="w-3.5 h-3.5 text-white" />
              </div>
              <span className="font-heading font-bold text-base text-white">
                VICINO
              </span>
            </div>
            <p className="text-xs text-white/35 leading-relaxed max-w-[200px]">
              Tu mercado de confianza. Compra y vende localmente con
              vendedores verificados.
            </p>
          </div>

          {/* Explorar */}
          <div>
            <h4 className="font-semibold text-white text-xs mb-3 tracking-wide uppercase">
              Explorar
            </h4>
            <ul className="flex flex-col gap-2">
              <li>
                <Link
                  href="/buscar"
                  className="text-xs hover:text-terracotta-light transition-colors"
                >
                  Explorar
                </Link>
              </li>
              <li>
                <Link
                  href="/buscar"
                  className="text-xs hover:text-terracotta-light transition-colors"
                >
                  Buscar
                </Link>
              </li>
              <li>
                <Link
                  href="/vender"
                  className="text-xs hover:text-terracotta-light transition-colors"
                >
                  Vender
                </Link>
              </li>
            </ul>
          </div>

          {/* Soporte */}
          <div>
            <h4 className="font-semibold text-white text-xs mb-3 tracking-wide uppercase">
              Soporte
            </h4>
            <ul className="flex flex-col gap-2">
              <li>
                <Link
                  href="/chat"
                  className="text-xs hover:text-terracotta-light transition-colors"
                >
                  Centro de Ayuda
                </Link>
              </li>
              <li>
                <Link
                  href="/perfil"
                  className="text-xs hover:text-terracotta-light transition-colors"
                >
                  Mi Cuenta
                </Link>
              </li>
            </ul>
          </div>

          {/* Legal */}
          <div>
            <h4 className="font-semibold text-white text-xs mb-3 tracking-wide uppercase">
              Legal
            </h4>
            <ul className="flex flex-col gap-2">
              <li>
                <Link
                  href="/terminos"
                  className="text-xs hover:text-terracotta-light transition-colors"
                >
                  Términos
                </Link>
              </li>
              <li>
                <Link
                  href="/privacidad"
                  className="text-xs hover:text-terracotta-light transition-colors"
                >
                  Privacidad
                </Link>
              </li>
            </ul>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="border-t border-white/8 pt-5 flex flex-col sm:flex-row items-center justify-between gap-3">
          <p className="text-[11px] text-white/25">
            © 2026 VICINO. Todos los derechos reservados.
          </p>
          <div className="flex items-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-trust" />
            <span className="text-[11px] text-emerald-trust/70 font-medium">
              VICINO Verificado
            </span>
          </div>
        </div>
      </div>
    </footer>
  );
}
