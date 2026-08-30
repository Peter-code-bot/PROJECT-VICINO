/**
 * redirect() y notFound() de Next viajan como excepciones con un `digest`
 * reservado. Un catch que se las quede cancela la navegación: la accion se
 * ejecuta, el usuario ve un error, y puede repetirla. Hay que relanzarlas.
 *
 * Se comprueba el digest y no `isRedirectError` a proposito: esa funcion
 * vive en next/dist/client/components, que es interno y ha cambiado de ruta
 * entre versiones de Next.
 */
export function esNavegacionDeNext(err: unknown): boolean {
  const digest = (err as { digest?: unknown } | null)?.digest;
  return (
    typeof digest === "string" &&
    (digest.startsWith("NEXT_REDIRECT") || digest === "NEXT_NOT_FOUND")
  );
}
