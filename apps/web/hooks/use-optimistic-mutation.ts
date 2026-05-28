"use client";

import { useRef, useState, useTransition } from "react";

export interface OptimisticMutationOpts<TArgs, TResult> {
  /**
   * Fires synchronously before the server action. Apply the optimistic UI
   * update here. Return a rollback function and the hook will call it
   * automatically when the action errors out so local state goes back.
   */
  onMutate?: (args: TArgs) => void | (() => void);
  /**
   * Fires after the action resolves successfully (no thrown error and no
   * `{ error: string }` payload). Use to reconcile local state with the
   * authoritative server response.
   */
  onSuccess?: (result: TResult, args: TArgs) => void;
  /**
   * Fires when the action throws or returns `{ error: string }`. The
   * rollback function from `onMutate` has already been invoked at this
   * point, so this is for user-visible feedback (toast, banner) only.
   */
  onError?: (error: unknown, args: TArgs) => void;
  /**
   * Allow multiple mutations to be in-flight at the same time. Default
   * is `false` so a fast double-tap on an idempotent toggle (favorite,
   * pause/resume) is collapsed to a single request. Opt in to `true`
   * for streaming writes like chat sends where every user action must
   * produce a distinct request, even if previous ones are still pending.
   */
  allowConcurrent?: boolean;
}

export interface UseOptimisticMutationResult<TArgs> {
  mutate: (args: TArgs) => Promise<void>;
  isPending: boolean;
  error: string | null;
  clearError: () => void;
}

/**
 * Wraps a Next.js server action with optimistic UI semantics: snapshot via
 * `onMutate` (which returns a rollback), fire the action inside a
 * `useTransition` so concurrent rendering stays responsive, and roll back +
 * surface `error` if the action fails.
 *
 * Designed for VICINO's existing Server Action style where most actions
 * return either `{ success: true, ... }` or `{ error: "..." }`. If the
 * action throws, that is also treated as failure.
 *
 * Double-click protection: a ref-based guard skips additional invocations
 * while a previous mutation is still pending. The returned `isPending`
 * tracks the underlying `useTransition` state so callers can render a
 * disabled button or a spinner.
 */
export function useOptimisticMutation<TArgs, TResult>(
  action: (args: TArgs) => Promise<TResult>,
  opts: OptimisticMutationOpts<TArgs, TResult> = {},
): UseOptimisticMutationResult<TArgs> {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const inFlightRef = useRef(false);

  const mutate = (args: TArgs): Promise<void> => {
    if (!opts.allowConcurrent && inFlightRef.current) {
      return Promise.resolve();
    }
    inFlightRef.current = true;
    setError(null);

    const rollback = opts.onMutate?.(args);

    return new Promise<void>((resolve) => {
      startTransition(async () => {
        try {
          const result = await action(args);
          const actionError = readErrorFromResult(result);
          if (actionError) {
            if (typeof rollback === "function") rollback();
            setError(actionError);
            opts.onError?.(new Error(actionError), args);
          } else {
            opts.onSuccess?.(result, args);
          }
        } catch (err) {
          if (typeof rollback === "function") rollback();
          const message =
            err instanceof Error && err.message ? err.message : "Algo salio mal";
          setError(message);
          opts.onError?.(err, args);
        } finally {
          inFlightRef.current = false;
          resolve();
        }
      });
    });
  };

  const clearError = () => setError(null);

  return { mutate, isPending, error, clearError };
}

function readErrorFromResult(result: unknown): string | null {
  if (!result || typeof result !== "object") return null;
  const maybe = (result as { error?: unknown }).error;
  if (typeof maybe === "string" && maybe.length > 0) return maybe;
  return null;
}
