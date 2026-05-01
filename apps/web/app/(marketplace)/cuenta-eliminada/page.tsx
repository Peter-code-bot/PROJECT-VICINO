import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Cuenta eliminada — VICINO",
  robots: { index: false, follow: false },
};

export default function CuentaEliminadaPage() {
  return (
    <main className="mx-auto flex min-h-[70vh] max-w-md flex-col items-center justify-center px-4 text-center">
      <h1 className="text-2xl font-semibold">Tu cuenta fue eliminada</h1>
      <p className="mt-3 text-gray-600">
        Todos tus datos en VICINO fueron eliminados de manera permanente.
        Gracias por haber sido parte de la comunidad.
      </p>
      <p className="mt-6 text-sm text-gray-500">
        Si fue por error o quieres regresar en el futuro, puedes crear una
        cuenta nueva cuando quieras.
      </p>
      <Link
        href="/"
        className="mt-8 rounded-md bg-blue-600 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-blue-700"
      >
        Volver al inicio
      </Link>
    </main>
  );
}
