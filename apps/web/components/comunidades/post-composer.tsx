"use client";

import { useState } from "react";
import { Send, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { COMMUNITY_POST_MAX } from "@vicino/shared";
import { UserAvatar } from "@/components/ui/user-avatar";

interface PostComposerProps {
  placeholder: string;
  /** Devuelve un error legible o null si se envio. */
  onEnviar: (texto: string) => Promise<string | null>;
  autor?: { nombre: string; foto: string | null } | null;
  /** Compacto: una linea que crece, para el hilo (molde: chat-window). */
  compacto?: boolean;
  etiquetaBoton?: string;
  className?: string;
}

/**
 * Cuadro de texto + boton, comun al muro y al hilo. Mantiene el texto si el
 * envio falla, para que reintentar cueste un toque y no volver a escribir.
 */
export function PostComposer({
  placeholder,
  onEnviar,
  autor,
  compacto = false,
  etiquetaBoton = "Publicar",
  className,
}: PostComposerProps) {
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const listo = texto.trim().length > 0 && texto.trim().length <= COMMUNITY_POST_MAX && !enviando;

  async function enviar() {
    if (!listo) return;
    setEnviando(true);
    setError(null);
    const fallo = await onEnviar(texto.trim());
    setEnviando(false);
    if (fallo) {
      setError(fallo);
      return;
    }
    setTexto("");
  }

  return (
    <div className={cn("space-y-2", className)}>
      <div
        className={cn(
          "flex gap-3 rounded-2xl bg-[color:var(--card)] p-3 shadow-[inset_0_0_0_1px_var(--border)] transition-shadow focus-within:shadow-[inset_0_0_0_1px_var(--brand-hi)]",
          compacto ? "items-end" : "items-start",
        )}
      >
        {autor && !compacto && <UserAvatar src={autor.foto} name={autor.nombre} size="sm" />}
        <textarea
          value={texto}
          onChange={(e) => setTexto(e.target.value.slice(0, COMMUNITY_POST_MAX))}
          onKeyDown={(e) => {
            // Enter con Ctrl/Cmd envia; Enter solo hace salto de linea, como
            // en cualquier muro. En el hilo compacto, Enter envia y Shift+Enter
            // hace el salto, como en el chat.
            const enviaConEnter = compacto ? !e.shiftKey : e.ctrlKey || e.metaKey;
            if (e.key === "Enter" && enviaConEnter) {
              e.preventDefault();
              void enviar();
            }
          }}
          placeholder={placeholder}
          rows={compacto ? 1 : 3}
          maxLength={COMMUNITY_POST_MAX}
          disabled={enviando}
          aria-label={placeholder}
          className={cn(
            "min-w-0 flex-1 resize-none bg-transparent text-sm text-[color:var(--fg)] outline-none placeholder:text-[color:var(--fg-dim)] disabled:opacity-60",
            compacto ? "max-h-32 py-2" : "min-h-[72px]",
          )}
        />
        {compacto ? (
          <button
            type="button"
            onClick={() => void enviar()}
            disabled={!listo}
            aria-label={etiquetaBoton}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[color:var(--brand)] text-white transition-all hover:bg-[color:var(--brand-dark)] active:scale-95 disabled:opacity-40"
          >
            {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </button>
        ) : null}
      </div>
      {!compacto && (
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-[color:var(--fg-dim)]">
            {texto.length}/{COMMUNITY_POST_MAX}
          </span>
          <button
            type="button"
            onClick={() => void enviar()}
            disabled={!listo}
            className="inline-flex h-9 items-center gap-2 rounded-full bg-[color:var(--brand)] px-4 text-[13px] font-semibold text-white shadow-[var(--shadow-glow)] transition-all hover:bg-[color:var(--brand-dark)] active:scale-[0.97] disabled:opacity-40 disabled:shadow-none"
          >
            {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            {etiquetaBoton}
          </button>
        </div>
      )}
      {error && <p className="text-xs font-medium text-destructive">{error}</p>}
    </div>
  );
}
