import { AvisoPrivacidadCuerpo } from "@/components/legal/aviso-privacidad-cuerpo";

export const metadata = { title: "Aviso de Privacidad Integral — VICINO" };

export default function PrivacidadPage() {
  return (
    <div className="max-w-3xl mx-auto px-4 py-8 md:py-12">
      <h1 className="text-3xl font-heading font-bold mb-1">Aviso de Privacidad Integral</h1>
      {/* El texto vive en components/legal/aviso-privacidad-cuerpo.tsx porque
          el modal de la pantalla de verificacion lee EXACTAMENTE el mismo. */}
      <AvisoPrivacidadCuerpo />
    </div>
  );
}
