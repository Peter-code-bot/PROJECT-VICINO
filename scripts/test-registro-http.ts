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
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.goto(base.href);
    const search = page.locator('a[href="/login?next=%2Fbuscar"]:visible');
    await expect(search.first()).toBeVisible();
    await search.first().click(); await expect(page).toHaveURL(/\/login\?next=%2Fbuscar/);
    await expect(page.getByRole("heading", { name: "¡Hola de nuevo!" })).toBeVisible();
    await page.screenshot({ path: `apps/web/test-results/registro-http/login-${process.env.TEST_BROWSER ?? "chromium"}.png` });
    console.log(`PASA navegador Next real ${process.env.TEST_BROWSER ?? "chromium"}: Home → Buscar → login, destino conservado.`);
    await page.goto(base.href);
    const product = page.locator('main a[href^="/login?next=%2F"]:has(h3)').first();
    await expect(product).toBeVisible({ timeout: 30_000 });
    await product.scrollIntoViewIfNeeded();
    const homeY = await page.evaluate(() => window.scrollY);
    assert.ok(homeY > 0, "Home must have scrollable catalogue content");
    const requested = await product.getAttribute("href");
    await product.click(); await expect(page).toHaveURL(new URL(requested!, base).href);
    await page.locator('a[href="/"]').first().click();
    await expect(page).toHaveURL(base.href);
    await expect.poll(() => page.evaluate(() => window.scrollY), { timeout: 30_000 }).toBe(homeY);
    console.log(`PASA Home real: producto → login → Home restaura scroll ${homeY}px.`);
    if (process.env.REGISTRO_TEST_EMAIL) {
      const { createClient } = require("@supabase/supabase-js");
      const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
      const email = process.env.REGISTRO_TEST_EMAIL.trim().toLowerCase();
      const check = await admin.rpc("registration_email_exists", { p_email: email });
      assert.equal(check.error, null); assert.equal(check.data, true, "Test must use an existing account; never create it");
      await page.goto(new URL("/register?next=%2Ftecnologia%2Fproducto", base).href);
      await page.getByLabel("Nombre completo").fill("Prueba de formulario");
      await page.getByLabel("Email", { exact: true }).fill(email);
      await page.getByLabel("Contraseña", { exact: true }).fill("synthetic-unused-password");
      await page.getByRole("button", { name: "Crear cuenta", exact: true }).click();
      if (process.env.REGISTRO_EXPECT_UNAVAILABLE === "1") {
        await expect(page.getByRole("alert")).toBeVisible({ timeout: 30_000 });
        await expect(page.locator('input[autocomplete="one-time-code"]')).toHaveCount(0);
        await expect(page.getByRole("button", { name: "Crear cuenta", exact: true })).toBeEnabled();
        console.log("PASA fallo real de Redis: error recuperable, formulario habilitado y sin OTP. Aviso de cuenta existente real pendiente de Redis funcional.");
        return;
      }
      await expect(page.getByRole("heading", { name: "Ya existe una cuenta con este correo." })).toBeVisible({ timeout: 30_000 });
      await expect(page.locator('input[autocomplete="one-time-code"]')).toHaveCount(0);
      await page.screenshot({ path: `apps/web/test-results/registro-http/existing-${process.env.TEST_BROWSER ?? "chromium"}.png`, mask: [page.locator("p.break-all")] });
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
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
