/** Exact read-only roots. Query-based contact/checkout URLs are never eligible. */
export const TAB_ROUTES = ["/", "/buscar", "/chat", "/perfil"] as const;
export function isTabRoute(href: string): boolean {
  return (TAB_ROUTES as readonly string[]).includes(href);
}
