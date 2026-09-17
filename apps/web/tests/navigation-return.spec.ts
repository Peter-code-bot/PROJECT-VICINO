import { test, expect, type Page } from "@playwright/test";

/**
 * Criterio de aceptacion de la Fase 3 (plan del 15-sep-2026, seccion 7):
 * cero esqueletos de pantalla completa en veinte regresos consecutivos a
 * pestañas ya visitadas, y toque -> contenido utilizable por debajo de 200 ms
 * en el p95.
 *
 * Corre contra el servidor real con la sesion del seed (storageState). La
 * primera visita a cada pestaña puede ensenar esqueleto: es la carga inicial
 * que el plan admite. A partir de ahi, cada vuelta tiene que pintar lo que ya
 * habia (cache del router o memoria de sesion) sin pasar por el esqueleto.
 *
 * El umbral de 200 ms se exige solo con VICINO_METRICS_STRICT=1 (build de
 * produccion). En `next dev` la compilacion bajo demanda y React en modo
 * desarrollo inflan los tiempos y el numero dejaria de decir nada.
 */

const PESTANAS = [
  { href: "/chat", kind: "chat_list" },
  { href: "/perfil", kind: "profile" },
  { href: "/", kind: "home" },
] as const;

const REGRESOS = 20;

declare global {
  interface Window {
    __vicinoNavigationMetrics?: () => Array<{ source: string; result: string; core_dom_ms: number | null }>;
  }
}

async function tocarPestana(page: Page, href: string) {
  // La barra inferior (movil) y la lateral (escritorio) enlazan a las mismas
  // rutas; se toca el primer enlace visible a la ruta, sea cual sea.
  const enlace = page.locator(`a[href="${href}"]:visible`).first();
  await expect(enlace).toBeVisible();
  await enlace.click();
}

async function esperarContenido(page: Page, kind: string) {
  await expect(page.locator(`[data-navigation-kind="${kind}"]`).first()).toBeVisible({ timeout: 15_000 });
}

test("veinte regresos a pestañas visitadas no vuelven a ensenar el esqueleto", async ({ page }) => {
  await page.goto("/");
  await esperarContenido(page, "home");

  // Primera visita a cada pestaña: aqui si se admite carga inicial.
  for (const pestana of PESTANAS) {
    await tocarPestana(page, pestana.href);
    await page.waitForURL(pestana.href === "/" ? /\/$/ : new RegExp(`${pestana.href}$`));
    await esperarContenido(page, pestana.kind);
  }

  const esqueletos: string[] = [];
  for (let i = 0; i < REGRESOS; i++) {
    const pestana = PESTANAS[i % PESTANAS.length]!;
    await tocarPestana(page, pestana.href);
    await page.waitForURL(pestana.href === "/" ? /\/$/ : new RegExp(`${pestana.href}$`));
    // Justo tras el cambio de URL: si el fallback pinto un esqueleto, existe en
    // el DOM aunque su animacion de 180 ms aun lo tenga transparente.
    const conEsqueleto = await page.locator(".esqueleto-demorado").count();
    if (conEsqueleto > 0) esqueletos.push(`${i + 1}:${pestana.href}`);
    await esperarContenido(page, pestana.kind);
  }
  expect(esqueletos, "regresos que volvieron a ensenar esqueleto").toEqual([]);

  const muestras = await page.evaluate(() => window.__vicinoNavigationMetrics?.() ?? []);
  const listas = muestras.filter(m => m.source === "link" && m.result === "ready" && m.core_dom_ms !== null);
  expect(listas.length, "navegaciones medidas").toBeGreaterThan(0);
  const tiempos = listas.map(m => m.core_dom_ms as number).sort((a, b) => a - b);
  const p95 = tiempos[Math.min(tiempos.length - 1, Math.floor(tiempos.length * 0.95))]!;
  test.info().annotations.push({ type: "p95_core_dom_ms", description: String(Math.round(p95)) });
  if (process.env.VICINO_METRICS_STRICT) expect(p95).toBeLessThanOrEqual(200);
});
