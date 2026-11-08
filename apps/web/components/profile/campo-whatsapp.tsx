"use client";

import { useRef, useState, type ChangeEvent } from "react";
import { normalizarNumeroWhatsApp } from "@vicino/shared";
import { desglosarWhatsApp, digitosWhatsApp, mostrarWhatsApp, PAISES_WHATSAPP, type TelefonoWhatsApp } from "@/lib/perfil/telefono-whatsapp";

const control = "min-h-11 rounded-lg border border-border/35 bg-transparent px-2 text-base text-foreground focus-visible:ring-2 focus-visible:ring-primary/40";

export function CampoWhatsApp({ inicial, activo }: { inicial: string; activo: boolean }) {
  const [original] = useState(() => desglosarWhatsApp(inicial));
  const [telefono, setTelefono] = useState(original);
  const numeroRef = useRef<HTMLInputElement>(null);

  function valorParaGuardar(siguiente: TelefonoWhatsApp) {
    return siguiente.pais === original.pais && siguiente.nacional === original.nacional
      ? inicial
      : digitosWhatsApp(siguiente);
  }

  function aplicarValidez(input: HTMLInputElement, siguiente: TelefonoWhatsApp) {
    const digitos = valorParaGuardar(siguiente);
    const requiereDiezDigitos = siguiente.pais === "MX" && siguiente.nacional.length !== 10;
    let mensaje = "";
    if (digitos && digitos !== inicial) {
      if (requiereDiezDigitos) mensaje = "Escribe los 10 dígitos del número de México.";
      else if (!normalizarNumeroWhatsApp(digitos)) mensaje = "El número con lada debe tener entre 11 y 15 dígitos.";
    }
    input.setCustomValidity(mensaje);
  }

  function cambiarNumero(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const valor = input.value;
    const digitos = valor.replace(/\D/g, "");
    const esLocal = /^[\d\s().-]*$/.test(valor);
    const pegadoConLadaMexicana = telefono.pais === "MX" && esLocal && /^52\d{10}$/.test(digitos);
    const internacional = pegadoConLadaMexicana || /^(?:\s*\+|\s*00|(?:https?:\/\/)?(?:wa\.me\/|api\.whatsapp\.com\/send))/i.test(valor)
      ? normalizarNumeroWhatsApp(valor)
      : null;
    if (!internacional && !esLocal) return;
    const siguiente = internacional
      ? desglosarWhatsApp(internacional)
      : { ...telefono, nacional: digitos.slice(0, 15) };
    setTelefono(siguiente);
    aplicarValidez(input, siguiente);
    if (!internacional && input.selectionStart !== null) {
      const antesDelCursor = valor.slice(0, input.selectionStart).replace(/\D/g, "").length;
      const formateado = mostrarWhatsApp(siguiente);
      let posicion = 0;
      let digitosVistos = 0;
      while (posicion < formateado.length && digitosVistos < antesDelCursor) {
        if (/\d/.test(formateado.charAt(posicion))) digitosVistos++;
        posicion++;
      }
      requestAnimationFrame(() => {
        if (document.activeElement === input && input.value === formateado) {
          input.setSelectionRange(posicion, posicion);
        }
      });
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        aria-label="Lada del país de WhatsApp"
        disabled={!activo}
        className={`${control} min-w-0 max-w-[min(100%,11rem)] text-sm`}
        value={telefono.pais}
        onChange={(event) => {
          const pais = PAISES_WHATSAPP.find((opcion) => opcion.pais === event.currentTarget.value)?.pais ?? "";
          const siguiente: TelefonoWhatsApp = { ...telefono, pais };
          setTelefono(siguiente);
          const input = numeroRef.current;
          if (input) aplicarValidez(input, siguiente);
        }}
      >
        {!telefono.pais && <option value="">Internacional</option>}
        {PAISES_WHATSAPP.map(({ pais, nombre, lada }) => (
          <option key={pais} value={pais}>{nombre} (+{lada})</option>
        ))}
      </select>
      <input
        ref={numeroRef}
        id="whatsapp_nacional"
        disabled={!activo}
        type="tel"
        inputMode="tel"
        autoComplete="tel-national"
        className={`${control} min-w-[9rem] flex-1 placeholder:text-muted-foreground`}
        value={mostrarWhatsApp(telefono)}
        placeholder={telefono.pais === "MX" ? "222 123 4567" : "Número local"}
        onChange={cambiarNumero}
      />
      <input type="hidden" name="whatsapp_numero" value={valorParaGuardar(telefono)} />
    </div>
  );
}
