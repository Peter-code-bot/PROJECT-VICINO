"use client";

import { useState } from "react";
import {
  ETIQUETAS_PLANTILLA,
  LIMITES_LEALTAD,
  PALETA_LEALTAD,
  PLANTILLAS_LEALTAD,
  type ColorLealtad,
  type PlantillaLealtad,
} from "@vicino/shared";
import { cn } from "@/lib/utils";
import { TarjetaLealtad } from "@/components/lealtad/tarjeta-lealtad";
import { guardarPrograma } from "../actions";

interface ProgramaInicial {
  nombre: string;
  premio: string;
  meta_sellos: number;
  condiciones: string | null;
  color: string;
  plantilla: string;
  status: string;
}

interface ProgramaFormProps {
  negocio: string;
  inicial: ProgramaInicial | null;
}

function colorValido(valor: string): ColorLealtad {
  return (PALETA_LEALTAD as readonly string[]).includes(valor) ? (valor as ColorLealtad) : PALETA_LEALTAD[0];
}
function plantillaValida(valor: string): PlantillaLealtad {
  return (PLANTILLAS_LEALTAD as readonly string[]).includes(valor) ? (valor as PlantillaLealtad) : "clasica";
}

const campo =
  "w-full rounded-[var(--r-md)] border border-[color:var(--border)] bg-[color:var(--bg)] px-3 py-2.5 text-sm text-[color:var(--fg)] outline-none focus:ring-2 focus:ring-[color:var(--brand)]";

export function ProgramaForm({ negocio, inicial }: ProgramaFormProps) {
  const [nombre, setNombre] = useState(inicial?.nombre ?? "");
  const [premio, setPremio] = useState(inicial?.premio ?? "");
  // Texto y no numero: al borrar el campo no salta a 3; el servidor valida el rango.
  const [metaTexto, setMetaTexto] = useState(String(inicial?.meta_sellos ?? 5));
  const meta = Math.min(LIMITES_LEALTAD.metaMax, Math.max(LIMITES_LEALTAD.metaMin, Number(metaTexto) || LIMITES_LEALTAD.metaMin));
  const [condiciones, setCondiciones] = useState(inicial?.condiciones ?? "");
  const [color, setColor] = useState<ColorLealtad>(colorValido(inicial?.color ?? PALETA_LEALTAD[0]));
  const [plantilla, setPlantilla] = useState<PlantillaLealtad>(plantillaValida(inicial?.plantilla ?? "clasica"));
  const [vista, setVista] = useState<"apple" | "google">("apple");
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);

  async function enviar(formData: FormData) {
    setError("");
    setEnviando(true);
    try {
      const resultado = await guardarPrograma(formData);
      if (resultado?.error) {
        setError(resultado.error);
        setEnviando(false);
      }
    } catch (fallo) {
      // redirect() tambien llega aqui como excepcion: Next la relanza; lo demas es red.
      if (fallo instanceof Error && fallo.message.includes("NEXT_REDIRECT")) throw fallo;
      setError("Sin conexión. Inténtalo de nuevo.");
      setEnviando(false);
    }
  }

  const publicado = inicial?.status === "activo" || inicial?.status === "pausado";

  return (
    <div className="grid gap-6 md:grid-cols-[1fr_minmax(0,320px)] md:items-start">
      <form action={enviar} className="space-y-4">
        {error ? (
          <div role="alert" className="rounded-[var(--r-md)] bg-danger/10 px-3 py-2 text-sm text-danger">
            {error}
          </div>
        ) : null}

        <div className="space-y-1.5">
          <label htmlFor="nombre" className="text-sm font-medium text-[color:var(--fg)]">
            Nombre del programa
          </label>
          <input
            id="nombre"
            name="nombre"
            required
            maxLength={LIMITES_LEALTAD.nombre}
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            placeholder={`Tarjeta ${negocio}`}
            className={campo}
          />
          <p className="text-xs text-[color:var(--fg-muted)]">{nombre.length}/{LIMITES_LEALTAD.nombre}</p>
        </div>

        <div className="grid gap-4 sm:grid-cols-[1fr_140px]">
          <div className="space-y-1.5">
            <label htmlFor="premio" className="text-sm font-medium text-[color:var(--fg)]">
              Premio
            </label>
            <input
              id="premio"
              name="premio"
              required
              maxLength={LIMITES_LEALTAD.premio}
              value={premio}
              onChange={(e) => setPremio(e.target.value)}
              placeholder="1 café americano"
              className={campo}
            />
            <p className="text-xs text-[color:var(--fg-muted)]">{premio.length}/{LIMITES_LEALTAD.premio}</p>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="meta_sellos" className="text-sm font-medium text-[color:var(--fg)]">
              Meta de sellos
            </label>
            <input
              id="meta_sellos"
              name="meta_sellos"
              type="number"
              required
              min={LIMITES_LEALTAD.metaMin}
              max={LIMITES_LEALTAD.metaMax}
              step={1}
              value={metaTexto}
              onChange={(e) => setMetaTexto(e.target.value.replace(/\D/g, "").slice(0, 2))}
              className={campo}
            />
            <p className="text-xs text-[color:var(--fg-muted)]">De {LIMITES_LEALTAD.metaMin} a {LIMITES_LEALTAD.metaMax}</p>
          </div>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="condiciones" className="text-sm font-medium text-[color:var(--fg)]">
            Condiciones <span className="font-normal text-[color:var(--fg-muted)]">(opcional)</span>
          </label>
          <textarea
            id="condiciones"
            name="condiciones"
            rows={3}
            maxLength={LIMITES_LEALTAD.condiciones}
            value={condiciones}
            onChange={(e) => setCondiciones(e.target.value)}
            placeholder="Exclusiones, horario, cómo canjear, vigencia…"
            className={campo}
          />
          <p className="text-xs text-[color:var(--fg-muted)]">
            {condiciones.length}/{LIMITES_LEALTAD.condiciones}. Una compra confirmada en VICINO = un sello.
          </p>
        </div>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-[color:var(--fg)]">Color</legend>
          <div className="flex flex-wrap gap-2">
            {PALETA_LEALTAD.map((c) => (
              <label key={c} className="cursor-pointer">
                <input
                  type="radio"
                  name="color"
                  value={c}
                  checked={color === c}
                  onChange={() => setColor(c)}
                  className="sr-only"
                />
                <span
                  aria-label={`Color ${c}`}
                  className={cn(
                    "block h-9 w-9 rounded-full border-2 transition-transform",
                    color === c ? "scale-110 border-[color:var(--fg)]" : "border-transparent",
                  )}
                  style={{ backgroundColor: c }}
                />
              </label>
            ))}
          </div>
        </fieldset>

        <div className="space-y-1.5">
          <label htmlFor="plantilla" className="text-sm font-medium text-[color:var(--fg)]">
            Plantilla
          </label>
          <select
            id="plantilla"
            name="plantilla"
            value={plantilla}
            onChange={(e) => setPlantilla(plantillaValida(e.target.value))}
            className={campo}
          >
            {PLANTILLAS_LEALTAD.map((p) => (
              <option key={p} value={p}>
                {ETIQUETAS_PLANTILLA[p]}
              </option>
            ))}
          </select>
        </div>

        {publicado ? (
          <p className="rounded-[var(--r-md)] bg-[color:var(--bg-elev-2)] px-3 py-2 text-xs text-[color:var(--fg)]">
            El programa está publicado: cambiar nombre, premio, meta o condiciones crea una versión nueva. Los
            sellos ya acumulados se conservan.
          </p>
        ) : null}

        <button
          type="submit"
          disabled={enviando}
          className="w-full rounded-[var(--r-pill)] bg-[color:var(--fg)] px-4 py-3 text-sm font-semibold text-[color:var(--bg)] hover:opacity-90 disabled:opacity-60"
        >
          {enviando ? "Guardando…" : inicial ? "Guardar cambios" : "Guardar borrador"}
        </button>
        {!inicial ? (
          <p className="text-center text-xs text-[color:var(--fg-muted)]">
            Se guarda como borrador. Lo publicas después, desde Lealtad.
          </p>
        ) : null}
      </form>

      <aside className="space-y-3 md:sticky md:top-24">
        <div className="flex gap-1 rounded-[var(--r-pill)] bg-[color:var(--sidebar-bg)] p-1" role="tablist" aria-label="Vista previa">
          {(["apple", "google"] as const).map((v) => (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={vista === v}
              onClick={() => setVista(v)}
              className={cn(
                "flex-1 rounded-[var(--r-pill)] px-3 py-1.5 text-xs font-semibold transition-colors",
                vista === v ? "bg-[color:var(--fg)] text-[color:var(--bg)]" : "text-[color:var(--fg-muted)]",
              )}
            >
              {v === "apple" ? "Apple Wallet" : "Google Wallet"}
            </button>
          ))}
        </div>
        <TarjetaLealtad
          negocio={negocio}
          nombre={nombre || "Nombre del programa"}
          premio={premio || "Describe el premio"}
          metaSellos={meta}
          sellos={Math.min(3, Math.max(0, meta - 1))}
          color={color}
          plantilla={plantilla}
          titular="Nombre del cliente"
          estilo={vista}
        />
        <p className="text-xs text-[color:var(--fg-muted)]">
          Vista previa aproximada. Cada cartera decide su presentación final; prueba con nombres largos.
        </p>
      </aside>
    </div>
  );
}
