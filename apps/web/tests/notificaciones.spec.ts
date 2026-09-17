import { test, expect } from "@playwright/test";

/**
 * Las dos pantallas nuevas del area de notificaciones, con sesion real.
 *
 * POR QUE EXISTE. /configuracion/notificaciones y /activar-notificaciones viven
 * detras del login, asi que ni el build ni el type-check dicen nada sobre como
 * se ven ni sobre si el interruptor guarda de verdad. La regla de
 * apps/web/CLAUDE.md pide validar movil 375x812 Y escritorio 1280x800 en todo
 * push que toque capa visual; el proyecto `mobile` de playwright.config.ts
 * aporta el primero y `chromium` el segundo, asi que este archivo cubre los dos
 * sin duplicarse.
 *
 * DOS TRAMPAS QUE ESTE ARCHIVO YA PISO, por si alguien anade casos aqui:
 *
 *   1. El marcado del servidor ya trae los interruptores, asi que un toque
 *      anterior a la hidratacion se pierde EN SILENCIO y la comprobacion lee el
 *      valor viejo sin que nada falle. De ahi la espera por
 *      `data-preferencias-listas`.
 *   2. En /activar-notificaciones el boton principal cambia de trabajo segun el
 *      permiso del sistema: mientras no se ha leido PIDE el permiso, y en un
 *      navegador esa peticion puede no resolverse nunca. Tocarlo antes de que
 *      la pantalla se asiente deja el boton girando y el caso agota su tiempo
 *      sin que haya ningun fallo de producto. Hay que esperar a "Continuar".
 *
 * El interruptor se toca y se DEVUELVE a su valor original en el mismo caso:
 * escribe en la cuenta de pruebas de verdad (VICINO_TEST_EMAIL), y un caso que
 * deja datos cambiados envenena al siguiente.
 */

/** La pantalla de preferencias, hidratada y con el permiso ya leido. */
async function esperarPreferenciasListas(page: import("@playwright/test").Page) {
  await expect(page.locator("[data-preferencias-listas='true']")).toBeVisible({
    timeout: 20_000,
  });
}

test("las preferencias se pintan, guardan y vuelven a su valor", async ({ page }) => {
  await page.goto("/configuracion/notificaciones");
  await esperarPreferenciasListas(page);

  // Los cuatro tipos del catalogo, no un contenedor vacio: si la lectura del
  // perfil fallara, la pantalla pinta su tarjeta de error y aqui saldrian cero.
  await expect(page.getByRole("switch")).toHaveCount(4);

  const novedades = page.getByRole("switch").last();
  const antes = await novedades.getAttribute("aria-checked");
  expect(antes === "true" || antes === "false").toBe(true);
  const contrario = antes === "true" ? "false" : "true";

  await novedades.click();
  await expect(novedades).toHaveAttribute("aria-checked", contrario);

  // La recarga es lo unico que demuestra que la RPC escribio, y no solo que el
  // optimismo pinto: el estado inicial viene del servidor.
  await page.reload();
  await esperarPreferenciasListas(page);
  await expect(page.getByRole("switch").last()).toHaveAttribute(
    "aria-checked",
    contrario,
    { timeout: 20_000 },
  );

  // Y se deja la cuenta como estaba.
  const trasRecargar = page.getByRole("switch").last();
  await trasRecargar.click();
  await expect(trasRecargar).toHaveAttribute("aria-checked", antes);
});

test("el paso del alta explica el valor antes de pedir nada y deja seguir", async ({ page }) => {
  await page.goto("/activar-notificaciones");

  // El valor ANTES del dialogo del sistema: es la razon de que la pantalla
  // exista, en vez de pedir el permiso a bocajarro al abrir la app. En iOS
  // negarlo es definitivo, asi que pedirlo sin explicar no gana permisos, los
  // quema.
  await expect(page.getByText(/quiere comprarte/i)).toBeVisible();

  // En un navegador no hay tuberia de push, asi que la pantalla se asienta
  // diciendo "Continuar" en vez de prometer un dialogo que no va a salir. Es
  // tambien la senal de que ya leyo el permiso: ver la trampa 2 de arriba.
  const continuar = page.getByRole("button", { name: /^continuar$/i });
  await expect(continuar).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/llegan en la app/i)).toBeVisible();

  await continuar.click();

  // Este paso no es obligatorio y no puede encerrar a nadie.
  await expect(page).not.toHaveURL(/activar-notificaciones/, { timeout: 20_000 });
});

test("un destino ajeno en la URL no saca a nadie de VICINO", async ({ page }) => {
  await page.goto("/activar-notificaciones?siguiente=https://example.com/fuera");

  const continuar = page.getByRole("button", { name: /^continuar$/i });
  await expect(continuar).toBeVisible({ timeout: 20_000 });
  await continuar.click();

  // Sin la lista cerrada de destinos, esto habria navegado al dominio de fuera:
  // un paso del alta convertido en redirector abierto, con la apariencia de
  // haberse quedado dentro de VICINO.
  await expect(page).not.toHaveURL(/activar-notificaciones/, { timeout: 20_000 });
  await expect(page).toHaveURL(/^http:\/\/localhost:3000\//);
});
