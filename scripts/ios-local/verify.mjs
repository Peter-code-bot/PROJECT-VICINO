import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const requireWeb = createRequire(path.join(root, 'apps/web/package.json'));
const { chromium, expect } = requireWeb('@playwright/test');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const errors = [];
  const external = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => {
    if (new URL(route.request().url()).origin === 'http://127.0.0.1:4173') return route.continue();
    external.push(route.request().url());
    return route.abort();
  });
  await page.goto('http://127.0.0.1:4173');
  await expect(page.getByRole('heading', { name: 'Inicio', exact: true })).toBeVisible();
  await page.getByLabel('Nota de Ropa', { exact: true }).fill('Conservar borrador');
  await page.getByRole('button', { name: 'Comida', exact: true }).click();
  await page.getByRole('button', { name: 'Ropa', exact: true }).click();
  await expect(page).toHaveURL(/cats=comida%2Cropa/);
  await expect(page.getByLabel('Nota de Ropa', { exact: true })).toHaveValue('Conservar borrador');
  await page.goBack();
  await expect(page.getByRole('button', { name: 'Ropa', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await page.getByRole('button', { name: 'Cambiar tema' }).click();
  await expect(page.locator('html')).toHaveClass('dark');
  await page.getByRole('navigation').getByRole('link', { name: 'Chat', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Chat', exact: true })).toBeVisible();
  await page.getByLabel('Mensaje simulado').fill('Mensaje local');
  await page.getByRole('button', { name: 'Enviar a la muestra' }).click();
  await expect(page.getByText('Mensaje local', { exact: true })).toBeVisible();
  await page.getByRole('navigation').getByRole('link', { name: 'Inicio', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Inicio', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Cambiar tema' }).click();
  await page.screenshot({ path: path.join(root, 'node_modules/.cache/vicino-ios-lab/browser.png') });
  assert.deepEqual(errors, [], 'Browser errors');
  assert.deepEqual(external, [], 'External requests');
  console.log('PASS: carga, categorías, borrador, Atrás, tema, navegación y chat simulado.');
  console.log('Browser errors: 0. External requests: 0.');
} finally {
  await browser.close();
}
