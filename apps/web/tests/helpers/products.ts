import { test, type Page } from "@playwright/test";

const PRODUCT_HREF_RE = /^\/[^/]+\/[^/]+$/;

/**
 * Walks /buscar and returns the path of the first product card found
 * (e.g. "/tecnologia/iphone-14-pro-256gb"). Used by visitor-scope tests
 * that need any real product to render against. If the marketplace has
 * no listings (empty seed), test.skip is called with a clear reason so
 * the run does not produce a false red.
 */
export async function findVisitorProductSlug(page: Page): Promise<string> {
  await page.goto("/buscar");

  const card = page.locator(`a[id^="product-"]`).first();
  const count = await card.count();

  if (count === 0) {
    test.skip(true, "No hay productos visibles en /buscar para el test de visitor");
  }

  const href = await card.getAttribute("href");
  if (!href || !PRODUCT_HREF_RE.test(href)) {
    test.skip(true, `Primer card en /buscar tiene href invalido: ${href}`);
  }

  return href as string;
}

/**
 * Navigates /seller/listings (requires authenticated session) and returns
 * the path of the first owned product link. The seller listings page
 * renders each row as <Link href={`/${categoria}/${slug}`}>{titulo}</Link>,
 * so we look for the first such anchor matching the product href shape.
 *
 * Failure modes for the skip:
 *  - Seed account is NOT es_vendedor -> seller layout redirige a
 *    /perfil/editar?prompt=seller-mode; el helper no encuentra product
 *    links y skip-ea con el URL final como pista.
 *  - Seed account es vendedor pero NO tiene listings -> /seller/listings
 *    renderiza el empty state; mismo skip con razon distinta.
 */
export async function findOwnerProductSlug(page: Page): Promise<string> {
  await page.goto("/seller/listings");
  const finalUrl = page.url();

  // Excluir nav y header: usar role link cuyo href empiece con "/" y
  // contenga un slash mas (sea ruta de producto, no de seccion del shell)
  const links = page.locator(`a[href^="/"]:not([href^="/seller"]):not([href^="/vender"])`);
  const count = await links.count();

  let candidate: string | null = null;
  for (let i = 0; i < count; i += 1) {
    const href = await links.nth(i).getAttribute("href");
    if (href && PRODUCT_HREF_RE.test(href)) {
      candidate = href;
      break;
    }
  }

  if (!candidate) {
    test.skip(
      true,
      `No se encontro listing del owner. URL final tras navegar a /seller/listings: ${finalUrl} (si redirige a /perfil/editar el seed no es es_vendedor; si renderiza /seller/listings sin product links la cuenta no tiene listings)`,
    );
  }

  return candidate as string;
}
