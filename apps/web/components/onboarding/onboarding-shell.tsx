"use client";

import { useEffect, useId, useState, type ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

/** All onboarding safe-area insets belong to this wrapper, once per route group. */
export function OnboardingViewport({ children }: { children: ReactNode }) {
  const [viewportHeight, setViewportHeight] = useState<number>();

  useEffect(() => {
    const viewport = window.visualViewport;
    const resize = () => setViewportHeight(viewport?.height ?? window.innerHeight);
    resize();
    viewport?.addEventListener("resize", resize);
    window.addEventListener("resize", resize);
    return () => {
      viewport?.removeEventListener("resize", resize);
      window.removeEventListener("resize", resize);
    };
  }, []);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const field = document.activeElement;
      if (!(field instanceof HTMLElement) || !field.matches("input, textarea, select, [contenteditable='true']")) return;
      const body = field.closest<HTMLElement>("[data-onboarding-scroll]");
      if (!body) return;
      const bounds = body.getBoundingClientRect();
      const rect = field.getBoundingClientRect();
      const gap = 8;
      if (rect.bottom > bounds.bottom - gap) {
        body.scrollTop += rect.bottom - bounds.bottom + gap;
      } else if (rect.top < bounds.top + gap) {
        body.scrollTop -= bounds.top - rect.top + gap;
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [viewportHeight]);

  return (
    <div
      className="flex h-dvh min-h-0 w-full flex-col overflow-hidden bg-auth-card text-foreground"
      style={{
        height: viewportHeight,
        paddingTop: "env(safe-area-inset-top, 0px)",
        paddingBottom: "env(safe-area-inset-bottom, 0px)",
        paddingLeft: "env(safe-area-inset-left, 0px)",
        paddingRight: "env(safe-area-inset-right, 0px)",
      }}
    >
      {/* The WebView/visual viewport already shrinks for the keyboard. Do not
          subtract --keyboard-height or add another keyboard-sized spacer. */}
      {children}
    </div>
  );
}

export interface OnboardingShellProps {
  title: string;
  description?: string;
  children: ReactNode;
  backHref?: string;
  onBack?: () => void;
  step?: number;
  totalSteps?: number;
  footer?: ReactNode;
  error?: string;
  busy?: boolean;
}

export function OnboardingShell({
  title,
  description,
  children,
  backHref,
  onBack,
  step,
  totalSteps,
  footer,
  error,
  busy,
}: OnboardingShellProps) {
  const id = useId();
  const titleId = `${id}-title`;
  const descriptionId = `${id}-description`;
  const hasProgress = step !== undefined && totalSteps !== undefined && totalSteps > 0;
  const backClassName =
    "inline-flex h-12 w-12 items-center justify-center rounded-xl text-fg-muted hover:bg-brand-tint hover:text-fg";

  return (
    <section
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      aria-busy={busy || undefined}
      className="mx-auto flex min-h-0 w-full max-w-md flex-1 flex-col"
    >
      <header className="flex min-h-16 shrink-0 items-center justify-between gap-4 px-6 py-2">
        {onBack ? (
          <button type="button" onClick={onBack} disabled={busy} aria-label="Regresar" className={backClassName}>
            <ArrowLeft className="h-5 w-5" aria-hidden="true" />
          </button>
        ) : backHref ? (
          <Link
            href={backHref}
            aria-label="Regresar"
            aria-disabled={busy || undefined}
            tabIndex={busy ? -1 : undefined}
            onClick={(event) => { if (busy) event.preventDefault(); }}
            className={backClassName}
          >
            <ArrowLeft className="h-5 w-5" aria-hidden="true" />
          </Link>
        ) : (
          <span aria-hidden="true" className="h-12 w-12" />
        )}
        {hasProgress && (
          <span className="text-sm font-medium text-fg-muted">
            Paso {step} de {totalSteps}
          </span>
        )}
      </header>

      <div data-onboarding-scroll className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 pb-6 pt-3">
        <h1 id={titleId} className="font-heading text-[32px] font-bold leading-[1.12] tracking-[-0.025em]">
          {title}
        </h1>
        {description && (
          <p id={descriptionId} className="mt-3 text-base leading-relaxed text-fg-muted">
            {description}
          </p>
        )}
        <div className="mt-6">{children}</div>
        {error && (
          <p role="alert" className="mt-5 rounded-xl border border-danger p-3 text-sm leading-relaxed text-fg">
            {error}
          </p>
        )}
      </div>

      {footer && (
        <footer className="shrink-0 border-t border-brand-tint-strong px-6 py-4">
          {footer}
        </footer>
      )}
    </section>
  );
}

export interface OnboardingActionsProps {
  continueLabel?: string;
  onContinue?: () => void;
  onSkip?: () => void;
  skipLabel?: string;
  disabled?: boolean;
  busy?: boolean;
  form?: string;
  type?: "button" | "submit";
}

export function OnboardingActions({
  continueLabel = "Continuar",
  onContinue,
  onSkip,
  skipLabel = "Omitir",
  disabled,
  busy,
  form,
  type = "button",
}: OnboardingActionsProps) {
  return (
    <div className="flex flex-col gap-2">
      <Button
        type={type}
        form={form}
        onClick={onContinue}
        disabled={disabled || busy}
        loading={busy}
        aria-busy={busy || undefined}
        size="lg"
        className="h-auto min-h-12 w-full rounded-xl py-3 !shadow-none hover:bg-brand-dark motion-reduce:transition-none motion-reduce:active:scale-100 [&>span]:motion-reduce:animate-none"
      >
        {continueLabel}
      </Button>
      {onSkip && (
        <Button
          type="button"
          onClick={onSkip}
          disabled={busy}
          variant="ghost"
          size="lg"
          className="h-auto min-h-12 w-full rounded-xl py-3 text-fg-muted hover:text-fg motion-reduce:transition-none"
        >
          {skipLabel}
        </Button>
      )}
    </div>
  );
}

export const onboardingInputClassName =
  "min-h-12 w-full rounded-xl border border-fg-muted bg-card-2 px-4 py-3 text-base text-fg placeholder:text-fg-muted disabled:opacity-60";
