// Componentes/acciones reales; router y Auth/DB/Storage simulados en el fixture.
// Primero: node scripts/listing-flow-fixture.mjs
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs/promises";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const requireWeb = createRequire(path.join(root, "apps/web/package.json"));
const { chromium, webkit, expect } = requireWeb("@playwright/test");
const output = path.resolve(root, "../../../reports/pub-perfil-20261022-integrado");
await fs.mkdir(output, { recursive: true });
const results = [];
const origin = "http://127.0.0.1:4318";
const state = page => page.locator("#fixture-state").evaluate(el => JSON.parse(el.textContent));
const menu = page => page.getByRole("button", { name: "Mas opciones", exact: true }).click();
async function setup(page, scenario = "success", empty = false) {
  await page.goto(`${origin}/perfil`);
  await expect(page.getByRole("heading", { name: "Mi perfil", exact: true })).toBeVisible();
  await page.evaluate(async data => {
    const response = await fetch("/__configure", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data) });
    window.__fixtureUpdate(await response.json());
  }, { scenario, empty, delayMs: 750 });
}
async function detail(page) {
  await page.locator('main a[href="/comida/producto-prueba"]').click();
  await expect(page.getByRole("heading", { name: "Producto de prueba", exact: true })).toBeVisible();
}
async function profile(page, count = 1) {
  await expect(page).toHaveURL(`${origin}/perfil?tab=products`);
  await expect(page.getByRole("heading", { name: "Mi perfil", exact: true })).toBeVisible();
  await expect(page.getByTestId("profile-count")).toHaveText(`Publicaciones: ${count}`);
  await expect(page.getByText("Sin reseñas aún")).not.toBeVisible();
}
for (const [engine, browserType] of [["chromium", chromium], ["webkit", webkit]]) {
  const browser = await browserType.launch({ headless: true });
  try {
    for (const width of [375, 1280]) {
      async function run(name, check) {
        const page = await browser.newPage({ viewport: { width, height: 812 } });
        const errors = [];
        page.on("pageerror", error => errors.push(error.message));
        page.on("dialog", dialog => dialog.dismiss());
        try {
          await check(page);
          expect(errors).toEqual([]);
          results.push({ engine, width, name, status: "passed" });
          console.log(`PASA ${engine}/${width}: ${name}`);
        } catch (error) {
          const screenshot = path.join(output, `${engine}-${width}-${results.length}-failure.png`);
          await page.screenshot({ path: screenshot, fullPage: true });
          results.push({ engine, width, name, status: "failed", error: error.message, errors, screenshot });
          console.error(`FALLA ${engine}/${width}: ${name}: ${error.message}`);
        } finally { await page.close(); }
      }
      await run("publicar desde Reseñas muestra la primera tarjeta; las pestañas siguen funcionando", async page => {
        await setup(page, "success", true);
        await page.getByRole("button", { name: "Reseñas" }).click();
        await page.getByRole("button", { name: "Abrir formulario", exact: true }).click();
        await page.getByRole("button", { name: "Publicar", exact: true }).click();
        await profile(page);
        await expect(page.getByRole("img", { name: "Producto de prueba", exact: true })).toBeVisible();
        expect((await state(page)).writes).toHaveLength(1);
        await page.screenshot({ path: path.join(output, `${engine}-${width}-perfil.png`), fullPage: true });
        await page.getByRole("button", { name: "Reseñas" }).click();
        await expect(page.getByText("Sin reseñas aún")).toBeVisible();
        await page.getByRole("button", { name: "Productos", exact: true }).click();
        await expect(page.getByRole("img", { name: "Producto de prueba", exact: true })).toBeVisible();
        await page.goBack();
        await expect(page).not.toHaveURL(/\/vender/);
      });
      await run("guardar desde Mi tienda actualiza la tarjeta y sustituye el formulario", async page => {
        await setup(page);
        await page.getByRole("button", { name: "Reseñas" }).click();
        await page.getByRole("button", { name: "Ir a Mi tienda", exact: true }).click();
        await page.getByRole("link", { name: "Editar publicación", exact: true }).click();
        await page.locator('input[name="titulo"]').fill("Titulo editado");
        await page.getByRole("button", { name: "Guardar", exact: true }).click();
        await profile(page);
        await expect(page.getByRole("img", { name: "Titulo editado", exact: true })).toBeVisible();
        await page.goBack();
        await expect(page).not.toHaveURL(/\/vender/);
      });
      for (const source of ["ficha", "tienda"]) {
        await run(`eliminar desde ${source}: cancelar conserva; confirmar elimina la ultima tarjeta`, async page => {
          await setup(page);
          if (source === "ficha") {
            await detail(page); await menu(page);
            await page.getByRole("menuitem", { name: "Eliminar publicación", exact: true }).click();
          } else {
            await page.getByRole("button", { name: "Ir a Mi tienda", exact: true }).click();
            await page.getByRole("button", { name: "Eliminar publicación", exact: true }).click();
          }
          const url = page.url();
          await page.getByRole("button", { name: "Cancelar", exact: true }).click();
          expect(page.url()).toBe(url); expect((await state(page)).writes).toHaveLength(0);
          if (source === "ficha") { await menu(page); await page.getByRole("menuitem", { name: "Eliminar publicación", exact: true }).click(); }
          else await page.getByRole("button", { name: "Eliminar publicación", exact: true }).click();
          await page.getByRole("dialog").getByRole("button", { name: "Eliminar publicación", exact: true }).click();
          await profile(page, 0);
          await expect(page.getByText("Sin productos publicados", { exact: true })).toBeVisible();
          await page.goBack();
          await expect(page).not.toHaveURL(/\/comida\/producto-prueba/);
        });
      }
      await run("ocultar conserva ficha y URL; el perfil marca oculta; mostrar funciona", async page => {
        await setup(page); await detail(page);
        const url = page.url();
        await menu(page); await page.getByRole("menuitem", { name: "Ocultar publicación", exact: true }).click();
        await expect.poll(async () => (await state(page)).record.estatus).toBe("pausado");
        expect(page.url()).toBe(url);
        await page.getByRole("button", { name: "Ir al perfil", exact: true }).click();
        await expect(page.getByLabel("Publicación oculta", { exact: true })).toBeVisible();
        await detail(page); await menu(page);
        await page.getByRole("menuitem", { name: "Mostrar publicación", exact: true }).click();
        await expect.poll(async () => (await state(page)).record.estatus).toBe("disponible");
        expect(page.url()).toBe(url);
      });
      await run("error de red al eliminar conserva la confirmacion y permite reintentar", async page => {
        await setup(page, "network-once"); await detail(page); await menu(page);
        await page.getByRole("menuitem", { name: "Eliminar publicación", exact: true }).click();
        const url = page.url();
        const confirm = page.getByRole("dialog").getByRole("button", { name: "Eliminar publicación", exact: true });
        await confirm.click(); await expect(page.getByRole("alert")).toBeVisible();
        expect(page.url()).toBe(url); expect((await state(page)).writes).toHaveLength(0);
        await confirm.click(); await profile(page, 0);
      });
      await run("guardar fallido conserva datos y formulario; reintentar abre perfil", async page => {
        await setup(page, "error-once");
        await page.getByRole("button", { name: "Editar prueba", exact: true }).click();
        await page.locator('input[name="titulo"]').fill("Edicion recuperada");
        await page.getByRole("button", { name: "Guardar", exact: true }).click();
        await expect(page.getByRole("alert")).toBeVisible();
        await expect(page.locator('input[name="titulo"]')).toHaveValue("Edicion recuperada");
        await expect(page).toHaveURL(/\/vender\/editar$/);
        await page.getByRole("button", { name: "Guardar", exact: true }).click();
        await profile(page);
        await expect(page.getByRole("img", { name: "Edicion recuperada", exact: true })).toBeVisible();
      });
      await run("doble confirmacion durante peticion lenta ejecuta una eliminacion", async page => {
        await setup(page, "slow"); await detail(page); await menu(page);
        await page.getByRole("menuitem", { name: "Eliminar publicación", exact: true }).click();
        const confirm = page.getByRole("dialog").getByRole("button", { name: "Eliminar publicación", exact: true });
        await confirm.evaluate(button => { button.click(); button.click(); });
        await expect(page.getByRole("button", { name: "Cancelar", exact: true })).toBeDisabled();
        await profile(page, 0);
        expect((await state(page)).requests).toBe(1); expect((await state(page)).writes).toHaveLength(1);
      });
      await run("publicar con doble toque durante peticion lenta no duplica", async page => {
        await setup(page, "slow", true);
        await page.getByRole("button", { name: "Abrir formulario", exact: true }).click();
        await page.getByRole("button", { name: "Publicar", exact: true }).evaluate(button => { button.click(); button.click(); });
        await profile(page);
        expect((await state(page)).requests).toBe(1); expect((await state(page)).writes).toHaveLength(1);
      });
      await run("fallo al ocultar conserva estado y ficha; reintento recuperable", async page => {
        await setup(page, "error-once"); await detail(page); const url = page.url();
        await menu(page); await page.getByRole("menuitem", { name: "Ocultar publicación", exact: true }).click();
        await expect.poll(async () => (await state(page)).requests).toBe(1);
        expect((await state(page)).record.estatus).toBe("disponible"); expect(page.url()).toBe(url);
        await menu(page); await page.getByRole("menuitem", { name: "Ocultar publicación", exact: true }).click();
        await expect.poll(async () => (await state(page)).record.estatus).toBe("pausado");
        expect(page.url()).toBe(url);
      });
      await run("ocultar con doble toque ejecuta un cambio y mantiene la ficha", async page => {
        await setup(page, "slow"); await detail(page); const url = page.url();
        await menu(page);
        await page.getByRole("menuitem", { name: "Ocultar publicación", exact: true }).evaluate(item => { item.click(); item.click(); });
        await expect.poll(async () => (await state(page)).record.estatus).toBe("pausado");
        expect(page.url()).toBe(url); expect((await state(page)).requests).toBe(1);
      });
      await run("visita normal recuerda Reseñas y el perfil publico ignora el retorno propio", async page => {
        await setup(page);
        await page.getByRole("button", { name: "Reseñas" }).click();
        await page.getByRole("button", { name: "Ir a Mi tienda", exact: true }).click();
        await page.getByRole("button", { name: "Ir al perfil", exact: true }).click();
        await expect(page.getByText("Sin reseñas aún")).toBeVisible();
        await page.evaluate(() => window.__fixtureNavigate('/vendedor/prueba'));
        await page.getByRole("button", { name: "Reseñas" }).click();
        await page.evaluate(() => window.__fixtureNavigate('/vendedor/prueba?tab=products'));
        await expect(page.getByText("Sin reseñas aún")).toBeVisible();
      });
    }
  } finally { await browser.close(); }
}
await fs.writeFile(path.join(output, "results.json"), JSON.stringify({ testedAt: new Date().toISOString(), scope: "Componentes y acciones reales, Auth/DB/router simulados", results }, null, 2));
const failed = results.filter(result => result.status === "failed");
console.log(`${results.length - failed.length}/${results.length} recorridos pasan. Evidencia: ${output}`);
if (failed.length) process.exitCode = 1;
