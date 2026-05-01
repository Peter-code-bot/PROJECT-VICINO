"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AlertTriangle, Loader2, Trash2, X } from "lucide-react";

const CONFIRM_WORD = "ELIMINAR";

export function DeleteAccountSection() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canConfirm = confirmText === CONFIRM_WORD && !isDeleting;

  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !isDeleting) {
        closeModal();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, isDeleting]);

  function openModal() {
    setOpen(true);
    setConfirmText("");
    setError(null);
  }

  function closeModal() {
    if (isDeleting) return;
    setOpen(false);
    setConfirmText("");
    setError(null);
  }

  async function handleDelete() {
    if (!canConfirm) return;
    setError(null);
    setIsDeleting(true);

    try {
      const res = await fetch("/api/account/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmText: CONFIRM_WORD }),
      });

      const data = (await res.json()) as { error?: string };

      if (!res.ok) {
        throw new Error(data.error ?? "No se pudo eliminar la cuenta.");
      }

      router.push("/cuenta-eliminada");
      router.refresh();
    } catch (err: unknown) {
      const message =
        err instanceof Error
          ? err.message
          : "Error desconocido al eliminar la cuenta.";
      setError(message);
      setIsDeleting(false);
    }
  }

  return (
    <>
      <section
        aria-labelledby="delete-account-heading"
        className="mt-6 rounded-lg border border-red-200 bg-red-50/40 p-6"
      >
        <header className="flex items-start gap-3">
          <AlertTriangle
            className="mt-0.5 h-5 w-5 flex-shrink-0 text-red-600"
            aria-hidden
          />
          <div>
            <h2
              id="delete-account-heading"
              className="text-lg font-semibold text-red-900"
            >
              Eliminar cuenta
            </h2>
            <p className="mt-1 text-sm text-red-800">
              Esta acción es <strong>permanente e irreversible</strong>. Se
              eliminarán todos tus datos de VICINO: perfil, productos
              publicados, chats, reviews emitidas, favoritos y verificaciones.
            </p>
            <p className="mt-2 text-sm text-red-800">
              ¿Tienes dudas? Lee la{" "}
              <Link
                href="/eliminar-cuenta"
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium underline"
              >
                política de eliminación de cuenta
              </Link>
              .
            </p>
          </div>
        </header>

        <div className="mt-5">
          <button
            type="button"
            onClick={openModal}
            className="inline-flex items-center gap-2 rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-red-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600 disabled:opacity-50"
            data-testid="delete-account-button"
          >
            <Trash2 className="h-4 w-4" aria-hidden />
            Eliminar mi cuenta
          </button>
        </div>
      </section>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-modal-title"
          aria-describedby="delete-modal-desc"
          className="fixed inset-0 z-50 flex items-center justify-center px-4"
        >
          <button
            type="button"
            aria-label="Cerrar"
            onClick={closeModal}
            disabled={isDeleting}
            className="absolute inset-0 bg-black/50 disabled:cursor-not-allowed"
          />

          <div className="relative z-10 w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
            <button
              type="button"
              onClick={closeModal}
              disabled={isDeleting}
              aria-label="Cerrar"
              className="absolute right-3 top-3 rounded-md p-1 text-gray-400 transition hover:text-gray-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <X className="h-5 w-5" aria-hidden />
            </button>

            <h3
              id="delete-modal-title"
              className="text-lg font-semibold text-gray-900"
            >
              ¿Estás seguro de eliminar tu cuenta?
            </h3>

            <p
              id="delete-modal-desc"
              className="mt-2 text-sm text-gray-600"
            >
              Esta acción no se puede deshacer. Todos tus datos en VICINO
              serán eliminados permanentemente.
            </p>

            <div className="mt-5 space-y-2">
              <label
                htmlFor="confirm-text"
                className="block text-sm font-medium text-gray-700"
              >
                Para confirmar, escribe{" "}
                <code className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-xs text-gray-900">
                  {CONFIRM_WORD}
                </code>{" "}
                abajo:
              </label>
              <input
                id="confirm-text"
                type="text"
                value={confirmText}
                onChange={(e) =>
                  setConfirmText(e.target.value.toUpperCase().trim())
                }
                placeholder={CONFIRM_WORD}
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                disabled={isDeleting}
                className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm placeholder:text-gray-400 focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500 disabled:bg-gray-100"
                data-testid="delete-confirm-input"
              />

              {error && (
                <p
                  className="mt-2 rounded-md bg-red-50 p-3 text-sm text-red-800"
                  role="alert"
                >
                  {error}
                </p>
              )}
            </div>

            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={closeModal}
                disabled={isDeleting}
                className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={!canConfirm}
                className="inline-flex items-center justify-center gap-2 rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                data-testid="delete-confirm-button"
              >
                {isDeleting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                    Eliminando...
                  </>
                ) : (
                  "Sí, eliminar mi cuenta"
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
