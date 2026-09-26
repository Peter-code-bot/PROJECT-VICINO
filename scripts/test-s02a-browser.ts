/** Componentes React reales en Chrome, acciones y router simulados. No es E2E de Auth. */
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import assert from "node:assert/strict";

const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const esbuild = require(require.resolve("esbuild", { paths: [require.resolve("tsx")] }));
const { chromium, expect } = require("@playwright/test");
const web = fileURLToPath(new URL("../apps/web", import.meta.url));

async function main() {
  const mocks: Record<string, string> = {
    "../actions": `
      export async function signUp(){window.testCalls.push('signup');return window.testResult;}
      export async function signInWithPassword(){window.testCalls.push('login');return window.testResult;}
      export async function verificarCodigo(){window.testCalls.push('verify');return {ok:true};}
      export async function reenviarCodigo(){window.testCalls.push('resend');return {ok:true};}
    `,
    "next/navigation": `export const useRouter=()=>({push:p=>window.testRoutes.push(p),refresh:()=>{}});
      export const useSearchParams=()=>new URLSearchParams(location.search);`,
    "next/link": `import React from 'react';export default function Link(p){return React.createElement('a',p,p.children);}`,
    "@/lib/auth/native-oauth": "export const signInWithGoogle=async()=>({});export const signInWithApple=async()=>({});",
    "@/lib/haptics": "export const hapticLight=()=>{};",
  };
  const bundle = await esbuild.build({
    stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';
      import {RegisterForm} from './app/(auth)/register/register-form';
      import {LoginForm} from './app/(auth)/login/login-form';
      createRoot(document.getElementById('root')).render(React.createElement(location.pathname==='/login'?LoginForm:RegisterForm));`,
      resolveDir: web, loader: "tsx" },
    bundle: true, platform: "browser", format: "iife", write: false, jsx: "automatic",
    tsconfig: path.join(web, "tsconfig.json"), define: { "process.env.NODE_ENV": '"development"' },
    plugins: [{ name: "browser-boundaries", setup(build: any) {
      build.onResolve({ filter: /.*/ }, (args: any) => Object.hasOwn(mocks, args.path) ? { path: args.path, namespace: "mock" } : undefined);
      build.onLoad({ filter: /.*/, namespace: "mock" }, (args: any) => ({ contents: mocks[args.path], loader: "js", resolveDir: web }));
    } }],
  });
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  let passed = 0;
  try {
    for (const viewport of [{ width: 1280, height: 800 }, { width: 375, height: 812 }]) {
      const context = await browser.newContext({ viewport });
      const page = await context.newPage();
      page.setDefaultTimeout(5000);
      const errors: string[] = [];
      const unexpectedNetwork: string[] = [];
      page.on("pageerror", (error: Error) => errors.push(error.message));
      await page.route("**/*", async (route: any) => {
        if (route.request().isNavigationRequest() && new URL(route.request().url()).origin === "https://s02.invalid") {
          await route.fulfill({ contentType: "text/html", body: '<!doctype html><html><body><div id="root"></div></body></html>' });
        } else { unexpectedNetwork.push(route.request().url()); await route.abort(); }
      });
      async function mount(result: object, next = "/buscar?q=mesa", route = "/register") {
        await page.goto(`https://s02.invalid${route}?next=${encodeURIComponent(next)}`);
        await page.evaluate((value: object) => {
          localStorage.clear(); sessionStorage.clear();
          Object.assign(window, { testResult: value, testCalls: [], testRoutes: [] });
        }, result);
        await page.addScriptTag({ content: bundle.outputFiles[0].text });
      }
      async function submit() {
        await page.getByLabel("Nombre completo").fill("Prueba Sintética");
        await page.getByLabel("Email", { exact: true }).fill("synthetic@example.com");
        await page.getByLabel("Contraseña", { exact: true }).fill("synthetic-password");
        await page.getByRole("button", { name: "Crear cuenta", exact: true }).click();
      }
      async function routes() { return page.evaluate(() => (window as any).testRoutes); }
      async function calls() { return page.evaluate(() => (window as any).testCalls); }

      await mount({ hasSession: false }); await submit();
      await expect(page.getByRole("heading", { name: "Revisa tu correo" })).toBeVisible();
      await expect(page.getByRole("link", { name: "Iniciar sesión", exact: true })).toHaveAttribute("href", "/login?next=%2Fbuscar%3Fq%3Dmesa");
      await expect(page.getByRole("link", { name: "Recuperar contraseña" })).toHaveAttribute("href", "/forgot-password?next=%2Fbuscar%3Fq%3Dmesa");
      await expect(page.getByRole("button", { name: "Cambiar correo" })).toBeVisible();
      assert.deepEqual(await calls(), ["signup"]);
      await expect(page.getByText(/Si recibes un código/)).toBeVisible();
      passed++;

      await page.getByRole("button", { name: "Cambiar correo" }).click();
      await expect(page.getByRole("button", { name: "Crear cuenta", exact: true })).toBeEnabled();
      await expect(page.getByRole("heading", { name: "Únete a VICINO" })).toBeVisible();
      passed++;

      await mount({ hasSession: true, alreadyLoggedIn: true }); await submit();
      await expect.poll(routes).toEqual(["/buscar?q=mesa"]);
      await expect(page.getByRole("heading", { name: "Revisa tu correo" })).toHaveCount(0);
      passed++;

      await mount({ hasSession: true }, "/a/../login"); await submit();
      await expect.poll(routes).toEqual(["/"]);
      passed++;

      await mount({ error: "No pudimos comprobar tu sesión. Intenta de nuevo.", sessionUnavailable: true }); await submit();
      await expect(page.getByRole("alert")).toContainText("comprobar tu sesión");
      await expect(page.getByRole("button", { name: "Crear cuenta", exact: true })).toBeEnabled();
      assert.deepEqual(await routes(), []);
      passed++;

      await mount({ error: "For security purposes, you can only request this after 60 seconds" }); await submit();
      await expect(page.getByText(/Si solicitaste un código recientemente/)).toBeVisible();
      await page.getByRole("button", { name: "Cambiar correo" }).click();
      await expect(page.getByRole("button", { name: "Crear cuenta", exact: true })).toBeEnabled();
      passed++;

      await mount({ hasSession: false }); await submit();
      await page.locator('input[autocomplete="one-time-code"]').fill("123456");
      await expect.poll(routes).toEqual(["/buscar?q=mesa"]);
      assert.deepEqual(await calls(), ["signup", "verify"]);
      passed++;

      await mount({ success: true }, "/a/../register", "/login");
      await page.getByLabel("Email", { exact: true }).fill("synthetic@example.com");
      await page.getByLabel("Contraseña", { exact: true }).fill("synthetic-password");
      await page.getByRole("button", { name: "Iniciar sesión", exact: true }).click();
      await expect.poll(routes).toEqual(["/"]);
      passed++;
      assert.deepEqual(errors, []);
      assert.deepEqual(unexpectedNetwork, []);
      console.log(`PASA: 8 casos de componentes reales en Chrome ${viewport.width}x${viewport.height}; Auth y router simulados.`);
      await context.close();
    }
    console.log(`PASA ${passed}/${passed}; sin tráfico externo. No acredita Auth/SMTP remoto.`);
  } finally { await browser.close(); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
