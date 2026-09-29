export const HISTORIAL_PAGE_SIZE = 50;
export type HistorialTab = "ventas" | "compras";
export type HistorialParams = Record<string, string | string[] | undefined>;
export interface HistorialLocation {
  tab: HistorialTab;
  ventasPage: number;
  comprasPage: number;
}

export function parsePage(value: unknown): number {
  if (typeof value !== "string" || !/^[1-9]\d{0,5}$/.test(value)) return 1;
  return Number(value);
}

export function parseHistorialLocation(params: HistorialParams): HistorialLocation {
  return {
    tab: params.tab === "compras" ? "compras" : "ventas",
    ventasPage: parsePage(params.ventasPage),
    comprasPage: parsePage(params.comprasPage),
  };
}

// Build only this internal route; never accept an arbitrary return URL.
export function historialHref(location: HistorialLocation): string {
  const params = new URLSearchParams({ tab: location.tab });
  if (location.ventasPage > 1) params.set("ventasPage", String(location.ventasPage));
  if (location.comprasPage > 1) params.set("comprasPage", String(location.comprasPage));
  return `/historial?${params}`;
}

export function reviewHref(sale: string, location: HistorialLocation): string {
  const params = new URLSearchParams(historialHref(location).split("?")[1]);
  params.set("sale", sale);
  params.set("type", location.tab === "ventas" ? "seller_to_buyer" : "buyer_to_seller");
  return `/historial/review?${params}`;
}
