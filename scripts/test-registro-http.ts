/** Actual Next server. Optional existing-email check; never creates test accounts. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";
import { MAP_AREA } from "../packages/shared/src";

const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const { chromium, webkit, expect } = require("@playwright/test");
const base = new URL(process.env.REGISTRO_BASE_URL ?? "http://localhost:3105");
assert.ok(["localhost", "127.0.0.1", "vicinomarket.com"].includes(base.hostname) && !base.username && !base.password, "Only VICINO or local Next server");

async function main() {
  let passed = 0;
  for (const path of ["/buscar?q=mesa", "/tecnologia/producto", "/vendedor/123", "/mapa", "/favoritos", "/vender", "/chat", "/?cats=comida", "/?feed=following"]) {
    const response = await fetch(new URL(path, base), { redirect: "manual" });
    assert.equal(response.status, 307, path);
    const login = new URL(response.headers.get("location")!, base);
    assert.equal(login.pathname, "/login"); assert.equal(login.searchParams.get("next"), path); passed++;
  }
  for (const path of ["/", "/login", "/register", "/forgot-password", "/reset-password", "/privacidad", "/terminos", "/centro-de-ayuda"]) {
    const response = await fetch(new URL(path, base), { redirect: "manual" });
    assert.equal(response.status, 200, path); passed++;
  }
  for (const [path, body] of [["/api/publications/map", { bounds: MAP_AREA }], ["/api/publications/map/coverage", { action: "overview", query: { bounds: MAP_AREA }, coverage_center: null, revision: null, cell_cursor: null }]] as const) {
    const response = await fetch(new URL(path, base), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    assert.equal(response.status, 401, path); passed++;
  }
  assert.equal((await fetch(new URL("/api/mapkit/token", base))).status, 401); passed++;
  console.log(`PASA HTTP ${passed}/${passed}: Next real, sin sesión; rutas, legales y API privadas.`);
  await mkdir("apps/web/test-results/registro-http", { recursive: true });
  const engine = process.env.TEST_BROWSER === "webkit" ? webkit : chromium;
  const browser = await engine.launch({ headless: true });
  let huboError = false;
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    page.setDefaultTimeout(30_000);
    await page.goto(base.href);
    const search = page.locator('a[href="/login?next=%2Fbuscar"]:visible');
    await expect(search.first()).toBeVisible();
    await search.first().click(); await expect(page).toHaveURL(/\/login\?next=%2Fbuscar/, { timeout: 30_000 });
    await expect(page.getByRole("heading", { name: "¡Hola de nuevo!" })).toBeVisible();
    await page.screenshot({ path: `apps/web/test-results/registro-http/login-${process.env.TEST_BROWSER ?? "chromium"}.png` });
    console.log(`PASA navegador Next real ${process.env.TEST_BROWSER ?? "chromium"}: Home → Buscar → login, destino conservado.`);
    await page.goto(base.href);
    const products = page.locator('main a[href^="/login?next=%2F"]:has(h3)');
    await expect(products.first()).toBeVisible({ timeout: 30_000 });
    // A font promise may stay pending in a headless engine; click-time scroll
    // capture below makes the assertion independent of later font layout.
    await page.evaluate(() => Promise.race([document.fonts.ready, new Promise(resolve => setTimeout(resolve, 5_000))]));
    await page.mouse.wheel(0, 600);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(500);
    const target = await products.evaluateAll((links: HTMLAnchorElement[]) => links.map((link, index) => {
      const r = link.getBoundingClientRect();
      return { index, href: link.getAttribute("href"), left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
    }).find(r => r.left >= 0 && r.right <= window.innerWidth && r.top >= 80 && r.top < window.innerHeight - 150 && r.height > 120));
    assert.ok(target, "A product must be visible after scrolling Home");
    // Capture at the actual click: WebKit's wheel can still be settling, and
    // Playwright may adjust the viewport when it brings the link into view.
    await page.evaluate(() => document.addEventListener("click", () => {
      sessionStorage.setItem("qa-home-click-y", String(window.scrollY));
    }, { capture: true, once: true }));
    // A product can occur in several preview rows. Click the visible instance,
    // rather than the first anchor sharing its href higher up the catalogue.
    await products.nth(target.index).click({ position: { x: Math.min(40, target.width / 2), y: 60 } });
    await expect(page).toHaveURL(new URL(target.href!, base).href, { timeout: 30_000 });
    const homeY = await page.evaluate(() => Number(sessionStorage.getItem("qa-home-click-y")));
    // The wheel assertion above proves substantial scroll. WebKit can adjust
    // it when clicking a partly clipped card; preserve the actual click-time
    // position, rather than demand that Playwright leave it at exactly 600px.
    assert.ok(homeY > 0, `Click must start from a scrolled Home catalogue; observed ${homeY}px`);
    await page.locator('a[href="/"]').first().click();
    await expect(page).toHaveURL(base.href, { timeout: 30_000 });
    await expect.poll(() => page.evaluate(() => window.scrollY), { timeout: 30_000 }).toBe(homeY);
    await page.waitForTimeout(1000);
    assert.equal(await page.evaluate(() => window.scrollY), homeY, "Home restoration must remain stable after Next handles scroll/focus");
    console.log(`PASA Home real: producto → login → Home restaura scroll ${homeY}px.`);
    // Hold application JS to exercise the initial HTML, then let React hydrate.
    // Text must only become editable once its change handlers are installed.
    const inicio = await browser.newPage({ viewport: { width: 390, height: 844 } });
    inicio.setDefaultTimeout(30_000);
    let habilitar!: () => void;
    const listo = new Promise<void>(resolve => { habilitar = resolve; });
    await inicio.route("**/_next/**/*.js", async route => { await listo; await route.continue(); });
    try {
      await inicio.goto(new URL("/register", base).href, { waitUntil: "commit" });
      for (const nombre of ["Nombre completo", "Email", "Contraseña"]) {
        await expect(inicio.getByLabel(nombre, { exact: true })).toBeDisabled();
      }
      habilitar();
      await expect(inicio.getByLabel("Nombre completo")).toBeEnabled();
      await inicio.getByLabel("Nombre completo").fill("Nombre conservado");
      await inicio.getByLabel("Email", { exact: true }).fill("qa@example.invalid");
      await inicio.getByLabel("Contraseña", { exact: true }).fill("synthetic-unused-password");
      await expect(inicio.getByLabel("Nombre completo")).toHaveValue("Nombre conservado");
      console.log(`PASA hidratación ${process.env.TEST_BROWSER ?? "chromium"}: campos iniciales protegidos y nombre conservado al habilitarse; sin enviar registro.`);
    } finally { habilitar(); await inicio.close(); }
    if (process.env.REGISTRO_TEST_EMAIL) {
      const { createClient } = require("@supabase/supabase-js");
      const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
      const email = process.env.REGISTRO_TEST_EMAIL.trim().toLowerCase();
      const check = await admin.rpc("registration_email_exists", { p_email: email }).abortSignal(AbortSignal.timeout(15_000));
      assert.equal(check.error, null); assert.equal(check.data, true, "Test must use an existing account; never create it");
      console.log("PRECONDICIÓN: correo existente confirmado; empieza formulario real.");
      await page.goto(new URL("/register?next=%2Ftecnologia%2Fproducto", base).href);
      await page.getByLabel("Nombre completo").fill("Prueba de formulario");
      await page.getByLabel("Email", { exact: true }).fill(email);
      await page.getByLabel("Contraseña", { exact: true }).fill("synthetic-unused-password");
      await expect(page.getByLabel("Nombre completo")).toHaveValue("Prueba de formulario");
      await expect(page.getByLabel("Email", { exact: true })).toHaveValue(email);
      await expect(page.getByLabel("Contraseña", { exact: true })).toHaveValue("synthetic-unused-password");
      const enviada = page.waitForResponse(response => response.request().method() === "POST" && new URL(response.url()).pathname === "/register");
      await page.getByRole("button", { name: "Crear cuenta", exact: true }).click();
      assert.equal((await enviada).status(), 200);
      console.log("PASA envío real: los tres campos conservados y POST de registro recibido por Next.");
      if (process.env.REGISTRO_EXPECT_UNAVAILABLE === "1") {
        await expect(page.getByRole("alert")).toBeVisible({ timeout: 30_000 });
        await expect(page.locator('input[autocomplete="one-time-code"]')).toHaveCount(0);
        await expect(page.getByRole("button", { name: "Crear cuenta", exact: true })).toBeEnabled();
        console.log("PASA fallo real de Redis: error recuperable, formulario habilitado y sin OTP. Aviso de cuenta existente real pendiente de Redis funcional.");
        return;
      }
      await expect(page.getByRole("heading", { name: "Ya existe una cuenta con este correo." })).toBeVisible({ timeout: 30_000 });
      await expect(page.locator('input[autocomplete="one-time-code"]')).toHaveCount(0);
      await page.screenshot({ path: `apps/web/test-results/registro-http/existing-${process.env.TEST_BROWSER ?? "chromium"}.png`, mask: [page.locator("p.break-all")], timeout: 15_000, animations: "disabled" });
      await page.getByRole("link", { name: "Recuperar contraseña", exact: true }).click();
      await expect(page.getByLabel("Email", { exact: true })).toHaveValue(email);
      await expect(page).toHaveURL(/\/forgot-password\?next=%2Ftecnologia%2Fproducto/);
      console.log("PASA cuenta existente real: aviso en formulario, sin OTP, correo temporal y destino conservados; Redis/lookup funcionales.");
      if (process.env.REGISTRO_TEST_RECOVERY === "1") {
        assert.equal(base.hostname, "vicinomarket.com", "Recovery link points to deployed application");
        await page.getByRole("button", { name: "Enviar enlace de recuperación" }).click();
        await expect(page.getByText(/Si este correo puede recibir recuperación/)).toBeVisible({ timeout: 30_000 });
        console.log("RECUPERACIÓN: solicitud real aceptada. Entrega y cambio de contraseña requieren confirmación del titular.");
      }
    }
  } catch (error) { huboError = true; throw error; }
  finally {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([browser.close(), new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("No se pudo cerrar el navegador de pruebas en 10s.")), 10_000);
      })]);
    } catch (error) {
      if (!huboError) throw error;
      console.warn("El cierre del navegador falló; se conserva el error original de la prueba.");
    } finally { if (timer) clearTimeout(timer); }
  }
}
const tiempoMaximo = setTimeout(() => {
  console.error("La prueba HTTP/navegador excedió el máximo global de 180s.");
  process.exit(1);
}, 180_000);
main().finally(() => clearTimeout(tiempoMaximo)).catch(error => {
  const mensaje = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(process.env.REGISTRO_TEST_EMAIL ? mensaje.replaceAll(process.env.REGISTRO_TEST_EMAIL, "[correo de prueba]") : mensaje);
  process.exit(1);
});
