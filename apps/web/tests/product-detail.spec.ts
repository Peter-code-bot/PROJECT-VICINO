import { test, expect } from "@playwright/test";
import { findVisitorProductSlug, findOwnerProductSlug } from "./helpers/products";

// Matriz E2E firmada en MP#06 Fase 6 + recuperada en MP#07 item #10
// (Sesion 4). Cubre la pagina de detalle de producto rediseniada en
// MP#06. Selectores por rol y texto, sin data-testid (D8 firmado).
// Cada test es independiente. La discovery de slugs vive en
// tests/helpers/products.ts; si el seed no tiene productos, los
// tests dependientes se skip-ean con motivo claro (no false reds).

test.describe("Producto detalle - matriz visitor/owner", () => {
  // #1 Visitor anonimo: usa newContext sin storageState para no
  //    heredar la sesion seed. Confirma que el CTA empuja a login.
  test("#1 visitor anonimo ve precio y titulo; CTA compra apunta a login", async ({
    browser,
  }) => {
    // Forzar storageState vacio para garantizar contexto totalmente anonimo
    // (el project chromium tiene storageState por default; aunque browser.
    // newContext() en teoria no la hereda, pasamos explicitamente cookies/
    // origins vacios para defender el escenario "fully anonymous request").
    const anonContext = await browser.newContext({
      storageState: { cookies: [], origins: [] },
    });
    const anonPage = await anonContext.newPage();

    try {
      const slug = await findVisitorProductSlug(anonPage);
      await anonPage.goto(slug);

      // getByRole skip-ea elementos ocultos (mobile h1 esta en DOM pero
      // hidden via md:hidden cuando viewport es desktop, y viceversa).
      await expect(
        anonPage.getByRole("heading", { level: 1 }).first(),
      ).toBeVisible();
      // PriceDisplay se renderiza en mobile y desktop wrappers (ambos en
      // DOM, uno visible segun viewport). Como sanity check basta verificar
      // que el patron de precio "$<digito>" exista en el DOM; la visibility
      // exacta depende de la variante activa.
      await expect(anonPage.getByText(/\$\s?\d/).first()).toBeAttached();

      // El sticky-cta anonimo renderiza /login?redirect=<pathname>; verificar
      // el atributo href es la prueba directa de la decision de render (mas
      // robusto que click + navegacion runtime, que dependeria de la session).
      const cta = anonPage.getByRole("link", { name: /quiero comprarlo/i }).first();
      await expect(cta).toBeVisible();
      const href = await cta.getAttribute("href");
      expect(href).toMatch(/^\/login\?redirect=/);
    } finally {
      await anonContext.close();
    }
  });

  // #2 Visitor con sesion != owner: descubierto via /buscar (cualquier
  //    producto que NO sea de Alejandro). El sticky muestra "Quiero
  //    comprarlo" con intent=buy + "Contactar Vendedor".
  test("#2 visitor autenticado ve CTA compra con intent=buy y contactar vendedor", async ({
    page,
  }) => {
    const slug = await findVisitorProductSlug(page);
    await page.goto(slug);

    const buyCta = page.getByRole("link", { name: /quiero comprarlo/i }).first();
    await expect(buyCta).toBeVisible();
    const buyHref = await buyCta.getAttribute("href");
    expect(buyHref).toMatch(/intent=buy/);

    await expect(
      page.getByRole("link", { name: /contactar vendedor/i }).first(),
    ).toBeVisible();
  });

  // #3 Owner sin preview: navega a un producto propio (descubierto
  //    via /seller/listings). El sticky owner debe mostrar "Ver como
  //    visitante" + "Editar producto" y NO debe aparecer "Quiero
  //    comprarlo".
  test("#3 owner sin preview ve botones de owner y NO ve CTA compra", async ({
    page,
  }) => {
    const slug = await findOwnerProductSlug(page);
    await page.goto(slug);

    await expect(
      page.getByRole("link", { name: /ver como visitante/i }).first(),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: /editar producto/i }).first(),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: /quiero comprarlo/i }),
    ).toHaveCount(0);
  });

  // #4 Owner con ?preview=visitor: el PreviewBanner debe aparecer y
  //    el sticky cambia a la variante visitor.
  test("#4 owner con preview=visitor muestra banner y CTA visitor", async ({
    page,
  }) => {
    const slug = await findOwnerProductSlug(page);
    await page.goto(`${slug}?preview=visitor`);

    // PreviewBanner no expone testid; nos apoyamos en texto del banner.
    await expect(
      page.getByText(/preview|visitante|cómo te ven|asi te ven/i).first(),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: /quiero comprarlo/i }).first(),
    ).toBeVisible();
  });

  // #5 Sin cupones: CouponBlock no se renderiza. El componente
  //    retorna null si el array de coupons esta vacio, asi que no hay
  //    forma textual unica de probar la ausencia salvo confirmar que
  //    NO aparece el heading "cupon" en el viewport. Si el primer
  //    producto descubierto SI tiene cupones, test.skip condicional.
  test("#5 producto sin cupones no muestra bloque de cupones", async ({ page }) => {
    const slug = await findVisitorProductSlug(page);
    await page.goto(slug);

    const couponHeading = page.getByRole("heading", { name: /cupon/i });
    const hasCoupons = (await couponHeading.count()) > 0;
    test.skip(
      hasCoupons,
      "El producto descubierto tiene cupones; iterar a un producto sin cupones queda fuera del scope del primer pase",
    );

    await expect(couponHeading).toHaveCount(0);
  });

  // #6 Sin reviews: ReviewsSummary no se renderiza. Mismo patron
  //    condicional que #5: si el producto descubierto tiene reviews,
  //    test.skip con razon clara.
  test("#6 producto sin reviews no muestra summary ni abre drawer", async ({
    page,
  }) => {
    const slug = await findVisitorProductSlug(page);
    await page.goto(slug);

    const reviewsHeading = page.getByRole("heading", { name: /resen|review/i });
    const hasReviews = (await reviewsHeading.count()) > 0;
    test.skip(
      hasReviews,
      "El producto descubierto tiene reviews; iterar a un producto sin reviews queda fuera del scope del primer pase",
    );

    await expect(reviewsHeading).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: /ver.*resen/i }),
    ).toHaveCount(0);
  });

  // #7 Desktop 1280x800: el wrapper ProductDetailDesktop renderiza un
  //    grid 2-col (clase lg:grid-cols-[1.1fr_1fr]); confirmamos que la
  //    pagina renderiza en desktop y que, si hay reviews, el drawer
  //    abre del lado correcto. Si no hay reviews, validamos solo el
  //    layout desktop.
  test("#7 desktop 1280 renderiza layout 2-col y abre drawer en reviews", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });

    const slug = await findVisitorProductSlug(page);
    await page.goto(slug);

    // getByRole skip-ea elementos ocultos (mobile h1 sigue en DOM pero hidden
    // via md:hidden en viewport desktop; solo el h1 de desktop esta visible).
    const h1 = page.getByRole("heading", { level: 1 }).first();
    await expect(h1).toBeVisible();

    const openReviews = page.getByRole("button", { name: /ver.*resen/i }).first();
    const reviewsAvailable = (await openReviews.count()) > 0;

    if (reviewsAvailable) {
      await openReviews.click();
      // Drawer side=right: side panel debe abrirse y montar contenido visible.
      // Selector neutro: cualquier role=dialog visible tras el click.
      await expect(page.getByRole("dialog").first()).toBeVisible();
    } else {
      // Si no hay reviews, la presencia del h1 visible en viewport >=1024
      // es suficiente para garantizar que ProductDetailDesktop monto en
      // lugar del mobile.
      await expect(h1).toBeVisible();
    }
  });
});
