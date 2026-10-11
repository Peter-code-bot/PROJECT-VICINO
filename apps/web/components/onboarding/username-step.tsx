"use client";

import { startTransition, useEffect, useState } from "react";
import { Check, Loader2, RefreshCw } from "lucide-react";
import { usernameLookupSchema, type UsernameLookupResult } from "@/lib/onboarding/username-suggestions";
import { onboardingInputClassName } from "./onboarding-shell";

export function UsernameStep({ value, onChange, onValidityChange, refreshToken = 0 }: {
  value: string;
  onChange: (value: string) => void;
  onValidityChange: (valid: boolean) => void;
  refreshToken?: number;
}) {
  const [lookup, setLookup] = useState<UsernameLookupResult | null>(null);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    startTransition(() => { setChecking(true); setError(""); onValidityChange(false); });
    const timer = setTimeout(async () => {
      const timeout = setTimeout(() => controller.abort(), 10_000);
      try {
        const response = await fetch(`/api/onboarding/usuario?username=${encodeURIComponent(value.trim())}`, {
          signal: controller.signal, cache: "no-store",
        });
        const result = usernameLookupSchema.safeParse(await response.json());
        if (!response.ok || !result.success) throw new Error("lookup-failed");
        if (controller.signal.aborted) return;
        setLookup(result.data);
        onValidityChange(result.data.status === "available" && result.data.username === value.trim());
      } catch {
        // Cleanup cancels obsolete requests; a timeout allows a manual retry.
        if (!cancelled) setError("No pudimos comprobar este ID. Intenta de nuevo.");
      } finally {
        clearTimeout(timeout);
        if (!cancelled) setChecking(false);
      }
    }, 350);
    let cancelled = false;
    return () => { cancelled = true; clearTimeout(timer); controller.abort(); };
  }, [value, retry, refreshToken, onValidityChange]);

  const current = lookup?.username === value.trim() ? lookup : null;
  return (
    <div className="space-y-6">
      <div>
        <label htmlFor="onboarding-username" className="mb-2 block text-sm font-medium">ID de usuario</label>
        <div className="relative">
          <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-4 flex items-center text-fg-muted">@</span>
          <input id="onboarding-username" name="username" type="text" value={value} maxLength={30}
            autoCapitalize="none" autoCorrect="off" spellCheck={false} autoComplete="username"
            aria-describedby="username-help username-status"
            aria-invalid={current && ["invalid", "reserved", "taken"].includes(current.status) ? true : undefined}
            onChange={(event) => { onValidityChange(false); onChange(event.target.value); }}
            className={`${onboardingInputClassName} pl-9`} />
        </div>
        <p id="username-help" className="mt-2 text-sm text-fg-muted">Usa de 3 a 30 letras, números o guiones bajos. Este ID aparecerá en tu perfil.</p>
        <div id="username-status" role="status" aria-live="polite" className="mt-3 min-h-6 text-sm">
          {checking ? <span className="inline-flex items-center gap-2 text-fg-muted"><Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />Comprobando disponibilidad…</span>
            : error ? <span>{error}</span>
              : current?.status === "available" ? <span className="inline-flex items-center gap-2 text-brand dark:text-fg"><Check className="h-4 w-4" aria-hidden="true" />Este ID está disponible.</span>
                : current?.message}
        </div>
      </div>
      <div className="space-y-3">
        <p className="text-sm font-medium">Opciones para ti</p>
        <p className="text-sm text-fg-muted">Las creamos con el nombre de tu correo y números. También puedes escribir tu propio ID.</p>
        <div className="flex flex-wrap gap-2">
          {lookup?.suggestions.map((suggestion) => <button key={suggestion} type="button" onClick={() => {
            onValidityChange(false);
            onChange(suggestion);
            if (value === suggestion) setRetry((count) => count + 1);
          }}
            className="min-h-12 max-w-full break-all rounded-xl border border-brand-tint-strong bg-brand-tint px-3 py-2 text-left text-sm font-medium text-brand dark:border-brand-hi dark:text-fg">@{suggestion}</button>)}
        </div>
        <button type="button" disabled={checking} onClick={() => { onValidityChange(false); setRetry((count) => count + 1); }}
          className="inline-flex min-h-12 items-center gap-2 rounded-xl px-2 text-sm font-medium text-brand disabled:opacity-50 dark:text-fg">
          <RefreshCw className="h-4 w-4" aria-hidden="true" />{error ? "Reintentar" : "Ver otras opciones"}
        </button>
      </div>
      <p className="text-sm text-fg-muted">Si omites este paso, conservarás tu ID actual. Podrás cambiarlo después en tu perfil.</p>
    </div>
  );
}
