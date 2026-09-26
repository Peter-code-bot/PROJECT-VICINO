/**
 * Suite de Verificación S03 — Favoritos, Ficha de Producto y Catálogo Público
 *
 * Importa las funciones REALES de producción utilizadas por la aplicación:
 * - `clasificarFavorito` de `apps/web/app/(marketplace)/favoritos/clasificar-favorito`
 * - `getListingStatusBannerMessage` de `apps/web/components/product/listing-status-banner`
 * - `removeFavoriteCore` de `apps/web/app/(marketplace)/favoritos/remove-favorite-core`
 * - `FavoritoInactivoCard` renderizado con react-dom/server
 *
 * Ejecución:
 *   pnpm --filter web exec tsx ../../scripts/test-s03-favoritos-catalogo.ts
 */

import assert from "node:assert/strict";
import { createRequire } from "node:module";
const requireWeb = createRequire(new URL("../apps/web/package.json", import.meta.url));
const React = requireWeb("react");
const { renderToStaticMarkup } = requireWeb("react-dom/server");

// 1. Importaciones de producción
import { clasificarFavorito } from "../apps/web/app/(marketplace)/favoritos/clasificar-favorito";
import {
  getListingStatusBannerMessage,
  ListingStatusBanner,
} from "../apps/web/components/product/listing-status-banner";
import { removeFavoriteCore } from "../apps/web/app/(marketplace)/favoritos/remove-favorite-core";
import { FavoritoInactivoCard } from "../apps/web/app/(marketplace)/favoritos/favorito-inactivo-card";

let totalPassed = 0;
let totalBlocked = 0;

function test(name: string, fn: () => void | Promise<void>) {
  return async () => {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
      totalPassed++;
    } catch (err) {
      console.error(`  ✗ ${name}`);
      console.error(err);
      process.exit(1);
    }
  };
}

function blocked(name: string, reason: string) {
  console.log(`  ⚠ [BLOQUEADO] ${name} (${reason})`);
  totalBlocked++;
}

async function runSuite() {
  console.log("=== Ejecutando pruebas reales S03 (Código de producción) ===\n");

  // -------------------------------------------------------------
  // [1] Pruebas de clasificarFavorito (utilizado en favoritos/page.tsx)
  // -------------------------------------------------------------
  console.log("[1] Función real clasificarFavorito:");

  await test("Producto disponible -> clasifica disponible=true", () => {
    const res = clasificarFavorito({
      estatus: "disponible",
      is_hidden: false,
    });
    assert.deepEqual(res, { disponible: true });
  })();

  await test("Lentes deportivos (estatus='eliminado') -> inactivo con motivo 'eliminado' (Reporte 1)", () => {
    const res = clasificarFavorito({
      estatus: "eliminado",
      is_hidden: false,
    });
    assert.deepEqual(res, { disponible: false, motivo: "eliminado" });
  })();

  await test("Hiking (estatus='pausado') -> inactivo con motivo 'pausado' (Reporte 2)", () => {
    const res = clasificarFavorito({
      estatus: "pausado",
      is_hidden: false,
    });
    assert.deepEqual(res, { disponible: false, motivo: "pausado" });
  })();

  await test("Producto oculto por moderación (is_hidden=true) -> inactivo con motivo 'eliminado'", () => {
    const res = clasificarFavorito({
      estatus: "disponible",
      is_hidden: true,
    });
    assert.deepEqual(res, { disponible: false, motivo: "eliminado" });
  })();

  await test("Producto nulo por RLS / borrado físico -> inactivo con motivo 'no_disponible'", () => {
    const res = clasificarFavorito(null);
    assert.deepEqual(res, { disponible: false, motivo: "no_disponible" });
  })();

  // -------------------------------------------------------------
  // [2] Pruebas reales de removeFavoriteCore (lógica interna desacoplada)
  // -------------------------------------------------------------
  console.log("\n[2] Lógica real removeFavoriteCore (con dependencias inyectadas):");

  const dummyDeps = {
    getSupabaseClient: async () => ({}),
    getUser: async () => null,
    enforceRateLimit: async () => ({ ok: true }),
    revalidate: async () => {},
  };

  await test("ID inválido -> rechaza sin consultar base de datos", async () => {
    const res = await removeFavoriteCore("invalid-uuid-string", dummyDeps);
    assert.deepEqual(res, { error: "ID inválido" });
  })();

  await test("Sin sesión de usuario -> retorna 'No autenticado'", async () => {
    const res = await removeFavoriteCore("d97a54d4-bb46-4b24-a7c4-7a8055b077e8", {
      getSupabaseClient: async () => ({ auth: { getUser: async () => ({ data: { user: null } }) } }),
      getUser: async () => null,
      enforceRateLimit: async () => ({ ok: true }),
      revalidate: async () => {},
    });
    assert.deepEqual(res, { error: "No autenticado" });
  })();

  const userId = "u1111111-1111-4111-8111-111111111111";
  const prodId = "d97a54d4-bb46-4b24-a7c4-7a8055b077e8";

  await test("DELETE limitado estrictamente al usuario autenticado y producto solicitado", async () => {
    let capturedTable = "";
    let capturedFilters: Record<string, string> = {};

    const mockClient = {
      from: (table: string) => {
        capturedTable = table;
        return {
          delete: () => {
            const builder = {
              eq: (col: string, val: string) => {
                capturedFilters[col] = val;
                return builder;
              },
              then: (resolve: any) => resolve({ error: null, data: null }),
            };
            return builder;
          },
        };
      },
    };

    const res = await removeFavoriteCore(prodId, {
      getSupabaseClient: async () => mockClient,
      getUser: async () => ({ id: userId }),
      enforceRateLimit: async () => ({ ok: true }),
      revalidate: async () => {},
    });

    assert.deepEqual(res, { success: true, isFavorite: false });
    assert.equal(capturedTable, "favorites");
    assert.equal(capturedFilters["usuario_id"], userId);
    assert.equal(capturedFilters["producto_id"], prodId);
  })();

  await test("Favorito ya eliminado previamente -> retorna éxito sin error (idempotencia)", async () => {
    const mockClient = {
      from: () => ({
        delete: () => ({
          eq: () => ({
            eq: () => Promise.resolve({ error: null, data: null }),
          }),
        }),
      }),
    };

    const res = await removeFavoriteCore(prodId, {
      getSupabaseClient: async () => mockClient,
      getUser: async () => ({ id: userId }),
      enforceRateLimit: async () => ({ ok: true }),
      revalidate: async () => {},
    });

    assert.deepEqual(res, { success: true, isFavorite: false });
  })();

  await test("Repetición de llamadas -> solo ejecuta DELETE, nunca INSERT", async () => {
    let insertCalled = false;
    let deleteCount = 0;

    const mockClient = {
      from: () => ({
        delete: () => {
          deleteCount++;
          return {
            eq: () => ({
              eq: () => Promise.resolve({ error: null }),
            }),
          };
        },
        insert: () => {
          insertCalled = true;
          return Promise.resolve({ error: null });
        },
      }),
    };

    for (let i = 0; i < 3; i++) {
      const res = await removeFavoriteCore(prodId, {
        getSupabaseClient: async () => mockClient,
        getUser: async () => ({ id: userId }),
        enforceRateLimit: async () => ({ ok: true }),
        revalidate: async () => {},
      });
      assert.equal(res.success, true);
    }

    assert.equal(deleteCount, 3);
    assert.equal(insertCalled, false, "NUNCA debe llamar a insert");
  })();

  await test("Error de base de datos -> retorna mensaje controlado al usuario", async () => {
    const mockClient = {
      from: () => ({
        delete: () => ({
          eq: () => ({
            eq: () => Promise.resolve({ error: { code: "42P01", message: "DB down" } }),
          }),
        }),
      }),
    };

    const res = await removeFavoriteCore(prodId, {
      getSupabaseClient: async () => mockClient,
      getUser: async () => ({ id: userId }),
      enforceRateLimit: async () => ({ ok: true }),
      revalidate: async () => {},
    });

    assert.deepEqual(res, { error: "No se pudo quitar de favoritos. Intenta de nuevo." });
  })();

  await test("Límite de peticiones (rate limit) -> bloquea y retorna aviso de frecuencia", async () => {
    const res = await removeFavoriteCore(prodId, {
      getSupabaseClient: async () => ({}),
      getUser: async () => ({ id: userId }),
      enforceRateLimit: async () => ({
        ok: false,
        error: "Demasiadas solicitudes. Espera un momento.",
      }),
      revalidate: async () => {},
    });

    assert.deepEqual(res, { error: "Demasiadas solicitudes. Espera un momento." });
  })();

  // -------------------------------------------------------------
  // [3] Pruebas de FavoritoInactivoCard real
  // -------------------------------------------------------------
  console.log("\n[3] Componente real FavoritoInactivoCard:");

  await test("Renderizado estático: sin enlaces navegables (<a> ni href=) evitando 404", () => {
    const html = renderToStaticMarkup(
      React.createElement(FavoritoInactivoCard, {
        productoId: "d97a54d4-bb46-4b24-a7c4-7a8055b077e8",
        titulo: "Lentes deportivos",
        motivo: "eliminado",
      })
    );

    assert.equal(html.includes("<a "), false, "No debe contener enlaces <a>");
    assert.equal(html.includes("href="), false, "No debe contener atributo href");
    assert.ok(html.includes("No disponible"), "Debe mostrar badge No disponible");
    assert.ok(html.includes('role="region"'), "Debe tener role region accesible");
    assert.ok(html.includes("Quitar de favoritos"), "Debe contener botón para retirar");
  })();

  await test("Renderizado estático con motivo 'pausado': badge Pausado sin enlaces", () => {
    const html = renderToStaticMarkup(
      React.createElement(FavoritoInactivoCard, {
        productoId: "7fb8153d-9edc-44bb-80cd-1296529e2a24",
        titulo: "HIKING",
        motivo: "pausado",
      })
    );

    assert.equal(html.includes("<a "), false);
    assert.ok(html.includes("Pausado"), "Debe mostrar badge Pausado");
  })();

  // -------------------------------------------------------------
  // [4] Pruebas de ListingStatusBanner real
  // -------------------------------------------------------------
  console.log("\n[4] Componente real ListingStatusBanner:");

  await test("Visitante/Admin en listado pausado -> renderiza aviso de publicación pausada", () => {
    const msg = getListingStatusBannerMessage("pausado", false);
    assert.equal(msg, "Esta publicación está pausada por el vendedor · No disponible para compra");

    const html = renderToStaticMarkup(
      React.createElement(ListingStatusBanner, {
        isOwner: false,
        estatus: "pausado",
      })
    );
    assert.ok(html.includes("Esta publicación está pausada por el vendedor"));
    assert.ok(html.includes('role="status"'));
  })();

  await test("Propietario en listado pausado -> renderiza aviso 'solo tú lo ves'", () => {
    const msg = getListingStatusBannerMessage("pausado", true);
    assert.equal(msg, "Listado pausado · solo tú lo ves");

    const html = renderToStaticMarkup(
      React.createElement(ListingStatusBanner, {
        isOwner: true,
        estatus: "pausado",
      })
    );
    assert.ok(html.includes("Listado pausado · solo tú lo ves"));
  })();

  await test("Producto disponible -> no renderiza ningún banner (retorna null)", () => {
    assert.equal(getListingStatusBannerMessage("disponible", false), null);
    assert.equal(getListingStatusBannerMessage("disponible", true), null);

    const html = renderToStaticMarkup(
      React.createElement(ListingStatusBanner, {
        isOwner: false,
        estatus: "disponible",
      })
    );
    assert.equal(html, "");
  })();

  // -------------------------------------------------------------
  // [5] Casos Bloqueados (requieren navegador real o entorno en vivo)
  // -------------------------------------------------------------
  console.log("\n[5] Casos de Integración y Entorno:");

  blocked(
    "Navegación e2e en navegador real de FavoritoInactivoCard",
    "Falta binario de Playwright (chrome-headless-shell.exe) en este entorno"
  );
  blocked(
    "Persistencia tras recargar y estado vacío en staging/producción",
    "Pruebas de sesión/escritura detenidas en cuentas reales según política estricta de seguridad"
  );
  blocked(
    "Verificación interactiva de citas/compra en ficha móvil/desktop en vivo",
    "Requiere navegador interactivo Playwright o sesión de pruebas autenticada"
  );

  console.log(`\n======================================================`);
  console.log(`Resumen: ${totalPassed} pruebas reales PASADAS, ${totalBlocked} casos BLOQUEADOS.`);
  console.log(`======================================================`);
}

runSuite().catch((e) => {
  console.error("Fallo general:", e);
  process.exit(1);
});
