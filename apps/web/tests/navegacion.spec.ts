import { test, expect } from "@playwright/test";

/**
 * Que ningun boton visible lleve a un 404.
 *
 * POR QUE EXISTE. El 27-ago-2026 Alejandro reporto que los botones de iniciar
 * sesion y crear cuenta no funcionaban. Eran seis enlaces a cuatro rutas
 * inventadas —/ingresar, /registro, /producto/<id>, /resenar/<id>— y dos de
 * ellos eran las UNICAS puertas que el home ofrece a quien no tiene sesion.
 *
 * `scripts/check-rutas.mjs` ya compara cada href del CODIGO contra el arbol de
 * rutas, y eso atrapa la clase entera de forma estatica. Esto es la otra mitad:
 * comprueba lo que de verdad se PINTA en la pagina y que responde de verdad,
 * incluidos los destinos que se arman en tiempo de ejecucion y que ningun
 * analisis estatico puede seguir.
 *
 * La barra inferior solo existe en movil (`md:hidden`), asi que sus pruebas
 * viven en el proyecto `mobile` y se saltan en escritorio.
 */

/** Rutas de la app, sin dominio, tal como aparecen en un href. */
function esInterna(href: string | null): href is string {
  return !!href && href.startsWith("/") && !href.startsWith("//");
}

test.describe("Navegacion - ningun boton lleva a 404", () => {
  test("#1 los enlaces visibles del home anonimo responden", async ({
    browser,
    baseURL,
  }) => {
    const contexto = await browser.newContext({
      storageState: { cookies: [], origins: [] },
    });
    const pagina = await contexto.newPage();

    try {
      await pagina.goto("/");
      const hrefs = await pagina
        .locator("a[href]")
        .evaluateAll((as) => as.map((a) => a.getAttribute("href")));

      // Se deduplica por RUTA, no por href completo: /buscar?category=comida y
      // /buscar?category=belleza son el mismo destino para lo que aqui importa,
      // y el home pinta una treintena de esas. Pedirlas todas en serie contra
      // el servidor de desarrollo agotaba el tiempo de la prueba.
      const porRuta = new Map<string, string>();
      for (const href of hrefs.filter(esInterna)) {
        const ruta = href.split("?")[0]!;
        if (!porRuta.has(ruta)) porRuta.set(ruta, href);
      }
      expect(porRuta.size, "el home deberia tener enlaces").toBeGreaterThan(0);

      // Y en paralelo, que son peticiones independientes.
      const respuestas = await Promise.all(
        [...porRuta.values()].map(async (href) => ({
          href,
          // 3xx y 401 son respuestas legitimas: el muro de sesion redirige. Un
          // 404 no lo es nunca: significa que el boton apunta a algo que no
          // existe, que es justo el fallo que esto viene a cerrar.
          status: (await pagina.request.get(new URL(href, baseURL).toString())).status(),
        })),
      );
      const rotas = respuestas.filter((r) => r.status === 404).map((r) => `${r.href} -> 404`);
      expect(rotas, "enlaces del home anonimo que dan 404").toEqual([]);
    } finally {
      await contexto.close();
    }
  });

  test("#2 el feed Siguiendo sin sesion ofrece dos puertas y las dos abren", async ({
    browser,
    baseURL,
  }) => {
    const contexto = await browser.newContext({
      storageState: { cookies: [], origins: [] },
    });
    const pagina = await contexto.newPage();

    try {
      // Es la pantalla exacta que reporto Alejandro: sin sesion, la pestana
      // Siguiendo ofrece "Iniciar sesion" y "Crear cuenta".
      await pagina.goto("/?feed=following");
      await expect(pagina.getByText(/Sigue a tus tiendas/i)).toBeVisible();

      for (const nombre of [/iniciar sesi/i, /crear cuenta/i]) {
        // Acotado a la tarjeta de la pestana: `.first()` a secas agarraba el
        // "Iniciar sesion" del menu LATERAL, que es otro boton distinto — y
        // asi fue como esta prueba descubrio que aquel no llevaba destino.
        const tarjeta = pagina.getByText(/Sigue a tus tiendas/i).locator("xpath=ancestor::div[1]");
        const boton = tarjeta.getByRole("link", { name: nombre }).first();
        await expect(boton, `falta el boton ${nombre}`).toBeVisible();

        const destino = await boton.getAttribute("href");
        expect(esInterna(destino), `${nombre} sin destino interno`).toBe(true);

        const res = await pagina.request.get(
          new URL(destino as string, baseURL).toString(),
        );
        expect(res.status(), `${destino} deberia abrir`).toBeLessThan(400);
        // Y tiene que conservar a donde volver: sin ?next= la persona entra y
        // aterriza en la portada, sin lo que habia ido a hacer.
        expect(destino).toContain("next=");
      }
    } finally {
      await contexto.close();
    }
  });

  test("#3 la barra inferior conserva su contrato", async ({ page }, testInfo) => {
    test.skip(
      testInfo.project.name !== "mobile",
      "la barra inferior es md:hidden, solo existe en movil",
    );

    await page.goto("/");
    const barra = page.locator('nav[aria-label="Navegación principal"]');
    await expect(barra).toBeVisible();

    // Los cuatro que ve todo el mundo. "Vender" depende de si la cuenta es
    // vendedora, asi que no se afirma aqui: se comprueba aparte que si esta,
    // apunta a /vender.
    for (const id of ["nav-inicio", "nav-buscar", "nav-chat", "nav-perfil"]) {
      // Por ID a proposito: el onboarding busca estos elementos POR ID para
      // señalarlos, y si se renombran no falla nada — simplemente deja de
      // señalar, que es la peor forma de romperse.
      await expect(page.locator(`#${id}`), `falta ${id}`).toHaveCount(1);
    }

    const vender = page.locator("#nav-vender");
    if ((await vender.count()) > 0) {
      await expect(vender).toHaveAttribute("href", "/vender");
    }

    // Ninguno de los destinos de la barra puede dar 404.
    const destinos = await barra
      .locator("a[href]")
      .evaluateAll((as) => as.map((a) => a.getAttribute("href")));
    for (const destino of destinos.filter(esInterna)) {
      const res = await page.request.get(destino);
      expect(res.status(), `${destino} desde la barra inferior`).not.toBe(404);
    }
  });

  // Los otros dos estados que pidio Pedro: registrado y vendedor. El proyecto
  // trae sesion (storageState del seed), asi que aqui se recorren las paginas
  // que SOLO existen con cuenta, que son justo las que el caso anonimo no
  // puede alcanzar.
  const PAGINAS_CON_SESION = [
    "/",
    "/perfil",
    "/chat",
    "/favoritos",
    "/historial",
    "/notificaciones",
    "/citas",
    "/solicitudes/nueva",
  ];

  const PAGINAS_DE_VENDEDOR = [
    "/seller",
    "/seller/listings",
    "/seller/ventas",
    "/seller/reviews",
    "/seller/cupones",
    "/seller/verificacion",
    "/vender",
  ];

  async function enlacesRotos(
    pagina: import("@playwright/test").Page,
    rutas: string[],
    baseURL: string | undefined,
  ) {
    // Cache COMPARTIDA entre las paginas del recorrido. Sin ella el test
    // agotaba su tiempo: las siete paginas del panel comparten menu lateral y
    // barra inferior, asi que los mismos veinte enlaces se pedian siete veces.
    const vistos = new Map<string, number>();
    const rotos: string[] = [];
    for (const ruta of rutas) {
      const respuesta = await pagina.goto(ruta);
      // Si la propia pagina no existe o rebota a login, no es su turno: este
      // test mira los ENLACES que pinta, no el muro, que ya se prueba aparte.
      if (!respuesta || respuesta.status() >= 400) continue;
      if (new URL(pagina.url()).pathname.startsWith("/login")) continue;

      const hrefs = await pagina
        .locator("a[href]")
        .evaluateAll((as) => as.map((a) => a.getAttribute("href")));

      const porRuta = new Map<string, string>();
      for (const href of hrefs.filter(esInterna)) {
        const solo = href.split("?")[0]!;
        if (!porRuta.has(solo)) porRuta.set(solo, href);
      }

      const nuevos = [...porRuta.values()].filter((h) => !vistos.has(h.split("?")[0]!));
      const respuestas = await Promise.all(
        nuevos.map(async (href) => ({
          href,
          status: (await pagina.request.get(new URL(href, baseURL).toString())).status(),
        })),
      );
      for (const r of respuestas) vistos.set(r.href.split("?")[0]!, r.status);

      for (const href of porRuta.values()) {
        if (vistos.get(href.split("?")[0]!) === 404) rotos.push(`${ruta} -> ${href} (404)`);
      }
    }
    return rotos;
  }

  test("#4 con sesion: ningun enlace de las paginas de cuenta da 404", async ({
    page,
    baseURL,
  }) => {
    test.setTimeout(180_000);
    const rotos = await enlacesRotos(page, PAGINAS_CON_SESION, baseURL);
    expect(rotos, "enlaces rotos en las paginas con sesion").toEqual([]);
  });

  test("#5 como vendedor: ningun enlace del panel da 404", async ({
    page,
    baseURL,
  }) => {
    test.setTimeout(180_000);
    // Si la cuenta del seed no es vendedora, cada pagina rebota a login o al
    // home y enlacesRotos las salta sola. El test no miente: no afirma haber
    // probado lo que no pudo alcanzar.
    const rotos = await enlacesRotos(page, PAGINAS_DE_VENDEDOR, baseURL);
    expect(rotos, "enlaces rotos en el panel de vendedor").toEqual([]);
  });
});
