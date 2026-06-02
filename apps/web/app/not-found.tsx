import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="text-center space-y-4">
        <h1 className="text-6xl font-bold text-primary">404</h1>
        <h2 className="text-xl font-bold">VICINO</h2>
        <p className="text-muted-foreground max-w-sm">
          La página que buscas no existe o fue movida.
        </p>
        <Link
          href="/"
          className="inline-flex rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Volver al inicio
        </Link>
      </div>
    </div>
  );
}
