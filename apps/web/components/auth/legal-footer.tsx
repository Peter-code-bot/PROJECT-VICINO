import Link from "next/link";

export function LegalFooter() {
  return (
    <p className="mx-auto max-w-prose px-1 pt-1 text-center text-xs leading-relaxed text-muted-foreground">
      Consulta los{" "}
      <Link
        href="/terminos"
        target="_blank"
        rel="noopener noreferrer"
        className="rounded-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        Términos y Condiciones
      </Link>{" "}
      y el{" "}
      <Link
        href="/privacidad"
        target="_blank"
        rel="noopener noreferrer"
        className="rounded-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        Aviso de Privacidad
      </Link>{" "}
      de VICINO.
    </p>
  );
}
