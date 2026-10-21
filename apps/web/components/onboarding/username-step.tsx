"use client";

import { startTransition, useEffect, useState } from "react";
import { Check, Loader2, RefreshCw } from "lucide-react";
import { onboardingUsernameSchema } from "@vicino/shared";
import { usernameLookupSchema, type UsernameLookupResult } from "@/lib/onboarding/username-suggestions";
import { onboardingInputClassName } from "./onboarding-shell";

export interface UsernameFeedback { username: string; valid: boolean; message: string }
const CHECKING_MESSAGE = "Comprobando disponibilidad…";
function lookupFailure(status: number): string {
  if (status === 401) return "Tu sesión venció. Inicia sesión de nuevo para comprobar el ID.";
  if (status === 429) return "Hiciste varios intentos seguidos. Espera un minuto y vuelve a comprobar el ID.";
  return "La comprobación no está disponible. Conservamos tu ID para que reintentes.";
}

export function UsernameStep({ value, onChange, onFeedbackChange, refreshToken = 0 }: {
  value: string;
  onChange: (value: string) => void;
  onFeedbackChange: (feedback: UsernameFeedback) => void;
  refreshToken?: number;
}) {
  const [lookup, setLookup] = useState<UsernameLookupResult | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestionsError, setSuggestionsError] = useState("");
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const format = onboardingUsernameSchema.safeParse(value);
  const formatError = format.success ? "" : format.error.errors[0]!.message;
  const validFormat = format.success;

  // Accounts can arrive with an automatic uppercase ID. Ask only for options,
  // without sending that invalid draft for an availability check.
  useEffect(() => {
    if (validFormat || suggestions.length > 0) {
      startTransition(() => { setSuggesting(false); setSuggestionsError(""); });
      return;
    }
    const controller = new AbortController();
    let cancelled = false;
    startTransition(() => { setSuggesting(true); setSuggestionsError(""); });
    const timeout = setTimeout(() => controller.abort(), 10_000);
    void (async () => {
      try {
        const response = await fetch("/api/onboarding/usuario", { signal: controller.signal, cache: "no-store" });
        const result = usernameLookupSchema.safeParse(await response.json());
        if (!response.ok || !result.success) throw new Error("suggestions-failed");
        if (!cancelled && !controller.signal.aborted) setSuggestions(result.data.suggestions);
      } catch {
        if (!cancelled) setSuggestionsError("No pudimos cargar tus opciones. Intenta de nuevo.");
      } finally {
        clearTimeout(timeout);
        if (!cancelled) setSuggesting(false);
      }
    })();
    return () => { cancelled = true; clearTimeout(timeout); controller.abort(); };
  }, [validFormat, suggestions.length, retry]);

  useEffect(() => {
    const controller = new AbortController();
    startTransition(() => { setLookup(null); setChecking(validFormat); setError(""); });
    if (!validFormat) return () => controller.abort();
    const timer = setTimeout(async () => {
      const timeout = setTimeout(() => controller.abort(), 10_000);
      try {
        const response = await fetch(`/api/onboarding/usuario?username=${encodeURIComponent(value)}`, {
          signal: controller.signal, cache: "no-store",
        });
        if (cancelled || controller.signal.aborted) return;
        if (!response.ok) { setError(lookupFailure(response.status)); return; }
        const result = usernameLookupSchema.safeParse(await response.json().catch(() => null));
        if (cancelled || controller.signal.aborted) return;
        if (!result.success || result.data.username !== value) {
          setError("No pudimos confirmar la respuesta para este ID. Vuelve a comprobarlo.");
          return;
        }
        setLookup(result.data);
        setSuggestions(result.data.suggestions);
      } catch {
        // Cleanup cancels obsolete requests; a timeout allows a manual retry.
        if (!cancelled) setError(controller.signal.aborted
          ? "La comprobación tardó demasiado. Reintenta para continuar."
          : "No pudimos comprobar este ID. Revisa tu conexión y vuelve a intentarlo.");
      } finally {
        clearTimeout(timeout);
        if (!cancelled) setChecking(false);
      }
    }, 350);
    let cancelled = false;
    return () => { cancelled = true; clearTimeout(timer); controller.abort(); };
  }, [value, validFormat, retry, refreshToken]);

  const current = validFormat && lookup?.username === value ? lookup : null;
  const messages: Record<UsernameLookupResult["status"], string> = {
    empty: "Escribe un ID de 3 a 30 caracteres o elige Omitir.",
    invalid: "Revisa el formato del ID antes de continuar.",
    reserved: "Este ID está reservado. Elige otro o una de las sugerencias.",
    taken: "Este ID ya está en uso. Elige otro o una de las sugerencias.",
    available: "Este ID está disponible.",
  };
  const message = formatError || (checking ? CHECKING_MESSAGE : error || (current ? messages[current.status] : CHECKING_MESSAGE));
  const available = validFormat && !checking && !error && current?.status === "available";
  useEffect(() => {
    onFeedbackChange({ username: value, valid: !!available, message });
  }, [value, available, message, onFeedbackChange]);

  function invalidate(nextValue: string) {
    const parsed = onboardingUsernameSchema.safeParse(nextValue);
    onFeedbackChange({ username: nextValue, valid: false, message: parsed.success ? CHECKING_MESSAGE : parsed.error.errors[0]!.message });
  }
  return (
    <div className="space-y-6">
      <div>
        <label htmlFor="onboarding-username" className="mb-2 block text-sm font-medium">ID de usuario</label>
        <div className="relative">
          <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-4 flex items-center text-fg-muted">@</span>
          <input id="onboarding-username" name="username" type="text" value={value}
            autoCapitalize="none" autoCorrect="off" spellCheck={false} autoComplete="username"
            aria-describedby="username-help username-count username-status"
            aria-invalid={(!validFormat && value.length > 0) || (current && ["invalid", "reserved", "taken"].includes(current.status)) ? true : undefined}
            onChange={(event) => { invalidate(event.target.value); onChange(event.target.value); }}
            className={`${onboardingInputClassName} pl-9`} />
        </div>
        <p id="username-help" className="mt-2 text-sm text-fg-muted">De 3 a 30 caracteres: letras minúsculas (a–z), números y guion bajo (_). Sin puntos (.), guiones (-), espacios ni acentos. Ejemplo: ana_lopez.</p>
        <p id="username-count" className="mt-1 text-sm text-fg-muted">{value.length}/30 caracteres</p>
        <div id="username-status" role="status" aria-live="polite" className="mt-3 min-h-6 text-sm">
          {formatError ? <span>{formatError}</span>
            : checking ? <span className="inline-flex items-center gap-2 text-fg-muted"><Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />Comprobando disponibilidad…</span>
            : error ? <span>{error}</span>
              : available ? <span className="inline-flex items-center gap-2 text-brand dark:text-fg"><Check className="h-4 w-4" aria-hidden="true" />{message}</span>
                : message}
        </div>
      </div>
      <div className="space-y-3">
        <p className="text-sm font-medium">Opciones para ti</p>
        <p className="text-sm text-fg-muted">Las creamos con el nombre de tu correo y números. También puedes escribir tu propio ID.</p>
        {(suggesting || suggestionsError) && <p role="status" className="text-sm text-fg-muted">{suggesting ? "Cargando opciones…" : suggestionsError}</p>}
        <div className="flex flex-wrap gap-2">
          {suggestions.map((suggestion) => <button key={suggestion} type="button" onClick={() => {
            invalidate(suggestion);
            onChange(suggestion);
            if (value === suggestion) setRetry((count) => count + 1);
          }}
            className="min-h-12 max-w-full break-all rounded-xl border border-brand-tint-strong bg-brand-tint px-3 py-2 text-left text-sm font-medium text-brand dark:border-brand-hi dark:text-fg">@{suggestion}</button>)}
        </div>
        <button type="button" disabled={checking || suggesting} onClick={() => { invalidate(value); if (!validFormat) setSuggestions([]); setRetry((count) => count + 1); }}
          className="inline-flex min-h-12 items-center gap-2 rounded-xl px-2 text-sm font-medium text-brand disabled:opacity-50 dark:text-fg">
          <RefreshCw className="h-4 w-4" aria-hidden="true" />{error || suggestionsError ? "Reintentar" : "Ver otras opciones"}
        </button>
      </div>
      <p className="text-sm text-fg-muted">Si omites este paso, conservarás tu ID actual. Podrás cambiarlo después en tu perfil.</p>
    </div>
  );
}
