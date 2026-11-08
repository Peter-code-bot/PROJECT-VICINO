const ORIGEN_PUBLICO = process.env.NEXT_PUBLIC_SITE_URL ?? "https://vicinomarket.com";

export function urlPerfilVendedor(id: string): string {
  return new URL(`/vendedor/${encodeURIComponent(id)}`, ORIGEN_PUBLICO).href;
}
