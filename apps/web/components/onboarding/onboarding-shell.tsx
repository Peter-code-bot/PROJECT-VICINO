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
  /** The bar describes the local question position, independently of its ACK. */
  progressPending?: boolean;
  /** Only set after the server confirms finalization. Never delays navigation. */
  progressComplete?: boolean;
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
  progressPending = false,
  progressComplete = false,
  footer,
  error,
  busy,
}: OnboardingShellProps) {
  const id = useId();
  const titleId = `${id}-title`;
  const descriptionId = `${id}-description`;
  const questionCount = totalSteps ?? 0;
  const questionNumber = step ?? 1;
  const hasProgress = step !== undefined && Number.isInteger(questionNumber)
    && Number.isInteger(questionCount) && questionCount > 0;
  const currentStep = hasProgress ? Math.min(questionCount, Math.max(1, questionNumber)) : 1;
  // The current question is still in progress. 100% requires a final server ACK.
  const progress = hasProgress ? (progressComplete ? 1 : (currentStep - 1) / questionCount) : 0;
  const progressText = progressComplete ? "Onboarding confirmado"
    : `Etapa ${currentStep} de ${questionCount}${progressPending ? ". Guardado pendiente" : ""}`;
  const backClassName =
    "inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-fg-muted hover:bg-brand-tint hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fg";

  return (
    <section
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      aria-busy={busy || undefined}
      className="mx-auto flex min-h-0 w-full max-w-md flex-1 flex-col"
    >
      <header className="flex min-h-16 shrink-0 items-center justify-between gap-4 py-2 pl-4 pr-6">
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
          <span aria-hidden="true" className="h-12 w-12 shrink-0" />
        )}
        {hasProgress && (
          <div
            role="progressbar"
            aria-label="Progreso del onboarding"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(progress * 100)}
            aria-valuetext={progressText}
            className="relative h-2 min-w-0 flex-1 overflow-hidden rounded-full border border-onboarding-progress-border bg-onboarding-progress-track"
          >
            <span
              aria-hidden="true"
              data-onboarding-progress-fill
              className="block h-full w-full origin-left bg-onboarding-progress-fill transition-transform duration-150 ease-out motion-reduce:transition-none"
              style={{ transform: `scaleX(${progress})` }}
            />
          </div>
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
  disabledReason?: string;
  disabledReasonId?: string;
  continueLabel?: string;
  onContinue?: () => void;
  onSkip?: () => void;
  skipLabel?: string;
  skipDisabled?: boolean;
  disabled?: boolean;
  busy?: boolean;
  form?: string;
  type?: "button" | "submit";
}

export function OnboardingActions({
  disabledReason,
  disabledReasonId,
  continueLabel = "Continuar",
  onContinue,
  onSkip,
  skipLabel = "Omitir",
  skipDisabled = false,
  disabled,
  busy,
  form,
  type = "button",
}: OnboardingActionsProps) {
  const generatedHelpId = useId();
  const helpId = disabledReasonId ?? generatedHelpId;
  const showReason = !!disabledReason && (disabled || busy);
  return (
    <div className="flex flex-col gap-2">
      {showReason && <p id={helpId} role="status" aria-live="polite" className="text-sm text-fg-muted">{disabledReason}</p>}
      <Button
        type={type}
        form={form}
        onClick={onContinue}
        disabled={disabled || busy}
        loading={busy}
        aria-busy={busy || undefined}
        aria-describedby={showReason ? helpId : undefined}
        size="lg"
        className="h-auto min-h-12 w-full rounded-xl py-3 !shadow-none hover:bg-brand-dark motion-reduce:transition-none motion-reduce:active:scale-100 [&>span]:motion-reduce:animate-none"
      >
        {continueLabel}
      </Button>
      {onSkip && (
        <Button
          type="button"
          onClick={onSkip}
          disabled={busy || skipDisabled}
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
