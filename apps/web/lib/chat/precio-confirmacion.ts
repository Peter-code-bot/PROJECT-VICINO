import type { ProductoChat } from "./producto-activo";

const MAX_TOTAL_CENTS = 9_999_999_900;
const money = new Intl.NumberFormat("es-MX", {
  style: "currency", currency: "MXN", minimumFractionDigits: 0, maximumFractionDigits: 2,
});

export function precioFijo(product: ProductoChat | null): boolean {
  return product?.modo_precio === "precio" && product.precio_negociable === false;
}

/** Catalog prices and the total have two decimal places; do arithmetic in cents. */
export function totalPrecioFijo(price: number | null, quantity: string): number | null {
  if (price === null || !Number.isFinite(price) || price <= 0) return null;
  const cents = Math.round(price * 100);
  const units = Number(quantity);
  if (Math.abs(price * 100 - cents) > .000001 || !Number.isInteger(units) || units < 1 || units > 9999) return null;
  const total = cents * units;
  return Number.isSafeInteger(total) && total > 0 && total <= MAX_TOTAL_CENTS ? total / 100 : null;
}

export function importeVenta(value: number): string {
  return money.format(value);
}
