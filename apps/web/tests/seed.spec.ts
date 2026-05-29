import { test, expect } from "@playwright/test";

// Seed test: authenticates the VICINO_TEST_EMAIL user via the real login form
// and persists the authenticated session to tests/storage-state.json so the
// Planner (and any future tests) can reuse it without re-logging in.
//
// Selectors are pinned to the real form in apps/web/app/(auth)/login/login-form.tsx:
//   - input#email
//   - input#password
//   - button[type="submit"] (label "Iniciar sesión")
// Post-login the server action calls router.push("/"), so we wait for that.
//
// Rate-limit aware: the /login server action has Upstash sliding-window of
// 5 req / 15 min per IP. Storing the storageState lets every downstream
// test skip re-login.

const STORAGE_STATE = "tests/storage-state.json";

test.describe.configure({ mode: "serial" });

test("seed: login y persistir storageState", async ({ page }) => {
  const email = process.env.VICINO_TEST_EMAIL;
  const password = process.env.VICINO_TEST_PASSWORD;

  if (!email || !password) {
    throw new Error(
      "VICINO_TEST_EMAIL y VICINO_TEST_PASSWORD deben estar definidas en apps/web/.env.local",
    );
  }

  await page.goto("/login");

  // Confirma que estamos en la página de login antes de tocar inputs
  await expect(page.locator("input#email")).toBeVisible({ timeout: 10_000 });

  await page.locator("input#email").fill(email);
  await page.locator("input#password").fill(password);
  await page.locator('button[type="submit"]').click();

  // Server action signInWithPassword → router.push("/") en éxito
  await page.waitForURL("/", { timeout: 15_000 });

  // Sanity: ya no estamos en /login, el form desapareció
  await expect(page.locator("input#email")).toHaveCount(0);

  // Persistir la sesión autenticada
  await page.context().storageState({ path: STORAGE_STATE });
});
