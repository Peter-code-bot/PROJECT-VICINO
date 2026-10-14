import { test, expect, type Page } from "@playwright/test";

/**
 * Cambio de cuenta (openspec/changes/2026-10-13-cambio-de-cuenta), con DOS
 * cuentas de prueba reales: la de siempre (VICINO_TEST_EMAIL) y una segunda
 * (VICINO_TEST_EMAIL_2 / VICINO_TEST_PASSWORD_2) que Pedro crea en produccion.
 *
 * Sin la segunda cuenta los casos se saltan, no fallan: igual que
 * notificaciones.spec.ts con su cuenta, aqui no se inventa nada.
 *
 * El recorrido es el de design.md: cajon -> fila de perfil -> hoja "Cuentas"
 * -> Agregar cuenta -> /login con el aviso -> entrar como B -> /perfil como B
 * -> hoja con A y B -> tocar A -> /perfil como A SIN pasar por /login ->
 * Quitar B -> hoja con solo A. Al final la boveda queda como al principio,
 * para no envenenar al siguiente caso.
 *
 * Corre en los dos proyectos (chromium 1280x800 y mobile 375x812); el cajon de
 * hamburguesa solo existe en movil, asi que el caso principal se limita a ese
 * viewport y en escritorio solo se comprueba que nada rompe.
 */

const EMAIL_2 = process.env.VICINO_TEST_EMAIL_2;
const PASSWORD_2 = process.env.VICINO_TEST_PASSWORD_2;

async function abrirHojaCuentas(page: Page) {
  await page.getByRole("button", { name: "Menú de cuenta" }).click();
  await page.getByRole("button", { name: /^Cuentas:/ }).click();
  const hoja = page.getByRole("dialog", { name: "Cuentas" });
  await expect(hoja).toBeVisible();
  return hoja;
}

async function nombreEnPerfil(page: Page): Promise<string> {
  await page.goto("/perfil");
  await expect(page).toHaveURL(/\/perfil/);
  return (await page.getByRole("heading", { level: 1 }).first().textContent())?.trim() ?? "";
}

test.describe("cambio de cuenta", () => {
  test.skip(!EMAIL_2 || !PASSWORD_2, "Hace falta VICINO_TEST_EMAIL_2 y VICINO_TEST_PASSWORD_2 en apps/web/.env.local");

  test("agregar, cambiar y quitar una cuenta desde el cajon", async ({ page, isMobile }) => {
    test.skip(!isMobile, "El cajon de hamburguesa es solo movil (md:hidden)");
    test.setTimeout(120_000);

    const nombreA = await nombreEnPerfil(page);
    expect(nombreA).not.toEqual("");

    // Con una sola cuenta, la fila de perfil ya abre la hoja: es como se descubre la funcion.
    let hoja = await abrirHojaCuentas(page);
    await expect(hoja.getByRole("button", { name: /Agregar cuenta/ })).toBeVisible();
    await hoja.getByRole("button", { name: /Agregar cuenta/ }).click();

    // /login con sesion y el aviso de que la actual sigue guardada.
    await expect(page).toHaveURL(/\/login\?.*agregar=1/);
    await expect(page.getByText(/Estás agregando otra cuenta/)).toBeVisible();
    await page.locator("input#email").fill(EMAIL_2!);
    await page.locator("input#password").fill(PASSWORD_2!);
    await page.locator('button[type="submit"]').click();

    // Entra como B y aterriza en /perfil, donde se VE que cambio.
    await page.waitForURL(/\/perfil/, { timeout: 30_000 });
    const nombreB = await nombreEnPerfil(page);
    expect(nombreB).not.toEqual(nombreA);

    // La hoja lista las dos, con B activa.
    hoja = await abrirHojaCuentas(page);
    await expect(hoja.getByRole("button", { name: new RegExp(nombreA) })).toBeVisible();
    await expect(hoja.getByRole("button", { name: new RegExp(nombreB) })).toHaveAttribute("aria-current", "true");

    // Volver a A sin pasar por /login.
    const visitasALogin: string[] = [];
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame() && frame.url().includes("/login")) visitasALogin.push(frame.url());
    });
    await hoja.getByRole("button", { name: new RegExp(nombreA) }).click();
    await expect(page.getByText(new RegExp(`Ahora estás en ${nombreA}`))).toBeVisible({ timeout: 30_000 });
    await expect(page).toHaveURL(/\/perfil/, { timeout: 30_000 });
    await expect(page.getByRole("heading", { level: 1 }).first()).toHaveText(nombreA, { timeout: 30_000 });
    expect(visitasALogin).toEqual([]);

    // Quitar B revoca su sesion y la saca de la lista.
    hoja = await abrirHojaCuentas(page);
    await hoja.getByRole("button", { name: "Quitar" }).click();
    await hoja.getByRole("button", { name: "Quitar" }).last().click();
    await expect(hoja.getByRole("button", { name: new RegExp(nombreB) })).toHaveCount(0, { timeout: 30_000 });
    await expect(hoja.getByRole("button", { name: new RegExp(nombreA) })).toHaveAttribute("aria-current", "true");
  });

  test("el botón Atrás (Escape) cierra la hoja y deja el cajón", async ({ page, isMobile }) => {
    test.skip(!isMobile, "El cajon de hamburguesa es solo movil (md:hidden)");
    await page.goto("/");
    const hoja = await abrirHojaCuentas(page);
    await page.keyboard.press("Escape");
    await expect(hoja).toBeHidden();
    await expect(page.getByRole("button", { name: "Cerrar menú" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "Cerrar menú" })).toBeHidden();
  });
});

test("con sesión y sin la cookie de agregar, /login sigue expulsando", async ({ page }) => {
  await page.goto("/login?agregar=1");
  await expect(page).not.toHaveURL(/\/login/, { timeout: 20_000 });
});
