import { test, expect } from "@playwright/test";
import { createRequire } from "node:module";
import path from "node:path";
const requireLocal = createRequire(path.resolve(__dirname, "../package.json"));
const esbuild = requireLocal(requireLocal.resolve("esbuild", { paths: [requireLocal.resolve("tsx")] }));
type Fixture = Window & { following: { calls: number; notices: number; allowed: boolean; resolve: (result: { isFavorite?: boolean; error?: string }) => void } };
let script: string;
test.beforeAll(async () => {
  const web = path.resolve(__dirname, "..");
  const mocks: Record<string, string> = {
    "@/app/(marketplace)/favoritos/actions": "export function toggleFavorite(){window.following.calls++;return new Promise(resolve=>window.following.resolve=resolve)}",
    "@/components/auth/muro-sesion": "export function useMuroSesion(){return {pedirSesion:()=>window.following.allowed}}",
    "@/lib/haptics": "export async function hapticLight(){}",
    "sonner": "export const toast={error:()=>window.following.notices++}",
    "next/link": "import React from 'react';export default React.forwardRef(({children,...props},ref)=><a ref={ref} {...props}>{children}</a>)",
  };
  const result = await esbuild.build({
    stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';
      import {FavoritesProvider} from './components/layout/favorites-provider';
      import {FavoriteButton} from './components/shared/favorite-button';
      import {StorePostOptions} from './components/home/store-post-options';
      window.following={calls:0,notices:0,allowed:true};
      createRoot(document.getElementById('root')).render(<FavoritesProvider initialIds={[]}>
        <FavoriteButton productId="product-a" initialFavorite={false}/>
        <FavoriteButton productId="product-a" initialFavorite={false} variant="standalone" showLabel/>
        <StorePostOptions storeId="seller-a" href={null}/>
      </FavoritesProvider>);`, loader: "tsx", resolveDir: web },
    plugins: [{ name: "local-transport", setup(build: { onResolve: (filter: { filter: RegExp }, cb: (args: { path: string }) => unknown) => void; onLoad: (filter: { filter: RegExp; namespace: string }, cb: (args: { path: string }) => unknown) => void }) {
      build.onResolve({ filter: /.*/ }, args => mocks[args.path] ? { path: args.path, namespace: "mock" } : undefined);
      build.onLoad({ filter: /.*/, namespace: "mock" }, args => ({ contents: mocks[args.path], loader: "jsx", resolveDir: web }));
    } }],
    bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    tsconfig: path.join(web, "tsconfig.json"), define: { "process.env.NODE_ENV": '"production"' },
  });
  script = result.outputFiles[0].text;
});
test.beforeEach(async ({ page }) => {
  await page.route("**/*", route => route.abort());
  await page.setContent('<div id="root"></div>');
  await page.addScriptTag({ content: script });
  await expect(page.getByRole("button", { name: "Agregar a favoritos" })).toHaveCount(2);
});
test("both controls update before the response, share a synchronous lock and roll back on failure", async ({ page }) => {
  await page.evaluate(() => {
    const buttons = document.querySelectorAll<HTMLButtonElement>('[aria-label="Agregar a favoritos"]');
    buttons[0].click(); buttons[1].click();
  });
  const saved = page.getByRole("button", { name: "Quitar de favoritos" });
  await expect(saved).toHaveCount(2);
  await expect(saved.first()).toBeDisabled();
  await expect(saved.last()).toHaveText("Guardado");
  expect(await page.evaluate(() => (window as Fixture).following.calls)).toBe(1);
  await page.evaluate(() => (window as Fixture).following.resolve({ error: "simulated failure" }));
  await expect(page.getByRole("button", { name: "Agregar a favoritos" })).toHaveCount(2);
  expect(await page.evaluate(() => (window as Fixture).following.notices)).toBe(1);
  await page.getByText("Guardar", { exact: true }).click();
  await page.evaluate(() => (window as Fixture).following.resolve({ isFavorite: true }));
  await expect(saved.last()).toBeEnabled();
  await expect(saved.last()).toHaveAttribute("aria-pressed", "true");
});
test("a guest is not shown a saved state and sends no mutation", async ({ page }) => {
  await page.evaluate(() => { (window as Fixture).following.allowed = false; });
  await page.getByText("Guardar", { exact: true }).click();
  await expect(page.getByRole("button", { name: "Agregar a favoritos" })).toHaveCount(2);
  expect(await page.evaluate(() => (window as Fixture).following.calls)).toBe(0);
});
test("options open immediately and omit a missing product route; Escape restores focus", async ({ page }) => {
  const trigger = page.getByRole("button", { name: "Más opciones" });
  await trigger.click();
  await expect(page.getByRole("menuitem", { name: "Ver vendedor" })).toHaveAttribute("href", "/vendedor/seller-a");
  await expect(page.getByRole("menuitem", { name: "Ver producto" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(trigger).toBeFocused();
});
