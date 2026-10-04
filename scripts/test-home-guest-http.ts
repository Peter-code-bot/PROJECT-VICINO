/** Next + Supabase real, read-only. No Auth POST, accounts, fixtures or email. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";

const req = createRequire(new URL("../apps/web/package.json", import.meta.url));
const { chromium, webkit, expect } = req("@playwright/test");
const base = new URL(process.env.HOME_GUEST_BASE_URL ?? "http://127.0.0.1:3116");
assert.ok(base.protocol === "http:" && ["localhost", "127.0.0.1"].includes(base.hostname) && !base.username && !base.password,
  "Only a local Next server is allowed");
const engine = process.env.TEST_BROWSER === "webkit" ? webkit : chromium;
const output = `apps/web/test-results/guest-preview/http-${process.env.TEST_BROWSER ?? "chromium"}`;

async function main() {
  let checks = 0;
  const pass = (name: string) => { checks++; console.log(`PASS ${name}`); };
  let requests: Array<{ id: string; titulo: string }> = [];
  const help = await fetch(new URL("/centro-de-ayuda", base), { redirect: "manual", signal: AbortSignal.timeout(30_000) });
  assert.equal(help.status, 200); pass("help page remains public without login");
  for (const [query, kind] of [["feed=solicitudes", "solicitudes"], ["feed=comunidades", "comunidades"], ["feed=comunidades&tab=descubrir", "comunidades"]]) {
    const response = await fetch(new URL(`/?${query}`, base), { redirect: "manual", signal: AbortSignal.timeout(30_000) });
    assert.equal(response.status, 200, query);
    assert.match(await response.text(), new RegExp(`data-guest-preview="${kind}"`));
    pass(`SSR ${query}: public preview without redirect`);
    const api = await fetch(new URL(`/api/session/home?${query}`, base), { signal: AbortSignal.timeout(30_000) });
    assert.equal(api.status, 200, query);
    assert.match(api.headers.get("cache-control") ?? "", /private.*no-store/);
    const result = await api.json();
    assert.equal(result.userId, ""); assert.equal(result.value.user, null);
    assert.equal(result.value.userLat, null); assert.equal(result.value.userLng, null);
    const preview = result.value.guestPreview;
    assert.equal(preview.kind, kind);
    const verifyRows = (rows: Record<string, unknown>[], allowed: string[]) => {
      assert.ok(rows.length <= 12);
      for (const row of rows) assert.deepEqual(Object.keys(row).sort(), allowed.toSorted());
    };
    if (kind === "solicitudes") {
      assert.equal(preview.failure, null);
      verifyRows(preview.requests, ["id", "titulo", "descripcion", "presupuesto_max", "categoria", "created_at"]);
      requests = preview.requests;
      console.log(`DATA requests=${requests.length}; no contact/identity/media/geographic columns`);
    } else {
      assert.equal(preview.communityFailure, null); assert.equal(preview.postFailure, null);
      verifyRows(preview.communities, ["id", "nombre", "descripcion", "miembros_count", "publicaciones_count", "ultima_publicacion_at"]);
      verifyRows(preview.posts, ["id", "community_id", "community_nombre", "contenido", "created_at", "likes_count", "comentarios_count"]);
      console.log(`DATA communities=${preview.communities.length}; posts=${preview.posts.length}; no fabricated rows`);
    }
    pass(`API ${query}: limited allowlist, no-store, anonymous and no location`);
  }
  const privateRoutes = ["/?feed=following", "/?feed=comunidades&tab=mias", "/?feed=solicitudes&cats=comida",
    "/?feed=solicitudes&feed=following", "/?feed=comunidades&tab=muro&tab=mias"];
  if (requests[0]) privateRoutes.push(`/solicitudes/${requests[0].id}`);
  for (const route of privateRoutes) {
    const response = await fetch(new URL(route, base), { redirect: "manual", signal: AbortSignal.timeout(30_000) });
    assert.equal(response.status, 307, route);
    const login = new URL(response.headers.get("location")!, base);
    assert.equal(login.pathname, "/login"); assert.equal(login.searchParams.get("next"), route);
    if (route.startsWith("/?")) {
      assert.equal((await fetch(new URL(`/api/session/home${route.slice(1)}`, base), { signal: AbortSignal.timeout(30_000) })).status, 401);
    }
    pass(`private ${route}: login exact next; Home API unauthorized`);
  }
  await mkdir(output, { recursive: true });
  const browser = await engine.launch({ headless: true });
  try {
    // The product intentionally renders its footer only on desktop.
    const desktop = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    try {
      await desktop.goto(new URL("/?feed=solicitudes", base).href);
      const helpLink = desktop.getByRole("link", { name: "Centro de Ayuda", exact: true });
      await expect(helpLink).toHaveAttribute("href", "/centro-de-ayuda");
      await helpLink.click();
      await expect(desktop).toHaveURL(new URL("/centro-de-ayuda", base).href);
      pass("desktop footer opens the public help page, never the private chat");
    } finally { await desktop.close(); }
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    page.setDefaultTimeout(30_000);
    const authPosts: string[] = [];
    page.on("request", (request: { method(): string; url(): string }) => {
      if (request.method() === "POST" && /\/auth\/|\/login|\/register|\/comunidades|\/solicitudes/.test(request.url())) authPosts.push(new URL(request.url()).pathname);
    });
    await page.goto(new URL("/?feed=solicitudes", base).href);
    await expect(page.locator('[data-guest-preview="solicitudes"]')).toBeVisible();
    const request = requests.at(-1);
    if (request) {
      const href = `/login?next=${encodeURIComponent(`/solicitudes/${request.id}`)}`;
      const card = page.locator(`[data-guest-preview] a[href="${href}"]`);
      await expect(card).toBeVisible();
      await card.scrollIntoViewIfNeeded();
      await card.focus();
      let clickedY = 0;
      await page.evaluate(() => document.addEventListener("click", () => { document.documentElement.dataset.clickedY = String(scrollY); }, { capture: true, once: true }));
      await card.press("Enter");
      clickedY = Number(await page.locator("html").getAttribute("data-clicked-y"));
      if (requests.length > 1) assert.ok(clickedY > 0, "Real request return must exercise a nonzero scroll");
      await expect(page).toHaveURL(new URL(href, base).href);
      await expect(page.getByRole("heading", { name: "¡Hola de nuevo!" })).toBeVisible();
      const logo = page.getByRole("link", { name: "Volver a Inicio", exact: true });
      await expect(logo).toHaveAttribute("href", "/?feed=solicitudes");
      await expect(logo).toBeVisible();
      await logo.click();
      await expect(page).toHaveURL(new URL("/?feed=solicitudes", base).href);
      await expect(page.locator('[data-guest-preview="solicitudes"]')).toBeVisible();
      await expect.poll(() => page.evaluate(() => scrollY)).toBe(clickedY);
      await page.waitForTimeout(1000); assert.equal(await page.evaluate(() => scrollY), clickedY);
      pass(`real request -> login -> original preview/scroll ${clickedY}px stable`);
    } else console.log("PENDING real request-card navigation: no eligible data; never fabricated");
    await page.screenshot({ path: `${output}/solicitudes.png`, fullPage: false });
    await page.getByRole("link", { name: "Comunidades", exact: true }).click();
    await expect(page.locator('[data-guest-preview="comunidades"]')).toBeVisible();
    await page.getByRole("tab", { name: "Descubrir", exact: true }).click();
    await expect(page).toHaveURL(new URL("/?feed=comunidades&tab=descubrir", base).href);
    await expect(page.locator('[data-guest-preview="comunidades"]')).toBeVisible();
    pass("primary tabs and public discovery navigate without login");
    await page.screenshot({ path: `${output}/comunidades.png`, fullPage: false });
    await page.getByRole("tab", { name: "Mis comunidades", exact: true }).click();
    await expect(page).toHaveURL(new URL(`/login?next=${encodeURIComponent("/?feed=comunidades&tab=mias")}`, base).href);
    const returnLogo = page.getByRole("link", { name: "Volver a Inicio", exact: true });
    await expect(returnLogo).toHaveAttribute("href", "/?feed=comunidades&tab=descubrir");
    await returnLogo.click();
    await expect(page.locator('[data-guest-preview="comunidades"]')).toBeVisible();
    await page.getByRole("button", { name: "Fundar comunidad", exact: true }).click();
    await expect(page).toHaveURL(new URL(`/login?next=${encodeURIComponent("/?feed=comunidades&tab=descubrir")}`, base).href);
    assert.deepEqual(authPosts, []);
    pass("private community actions -> login, logo returns discovery; zero Auth/action POST");
  } finally { await browser.close(); }
  console.log(`RESULT ${process.env.TEST_BROWSER ?? "chromium"}: ${checks}/${checks} PASS; Next/Supabase real read-only; device/Auth completion pending`);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
