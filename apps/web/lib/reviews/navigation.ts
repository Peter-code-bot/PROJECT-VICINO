import { destinoAutenticadoSeguro } from "../auth/destino-seguro";

/** Keep the local and valid return context across authentication. */
export function localReviewReturnPath(href: string): string {
  const context = new URL(href, "https://vicino.invalid");
  context.searchParams.set("reviewLocal", "1");
  return destinoAutenticadoSeguro(context.pathname + context.search + context.hash);
}
