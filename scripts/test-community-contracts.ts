import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { CATEGORIES } from "../packages/shared/src/constants/categories";
import { COMMUNITY_CATEGORIES, groupCommunitiesByCategory } from "../packages/shared/src/constants/community-categories";
import { fundarComunidadSchema } from "../packages/shared/src/validators/community";
import { isCommunityPhotoPath, readCommunityPhotoPath, withCommunityPhotos, cleanupUnreferencedCommunityPhoto, uploadCommunityPhoto } from "../apps/web/lib/comunidades/group-photo";

const id = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
let passed = 0;
async function test(name: string, fn: () => void | Promise<void>) { await fn(); passed++; console.log(`PASS ${name}`); }
async function main() {
  const valid = `${id(1)}/${id(2)}/${id(3)}.webp`;
  await test("community_only_catalog_does_not_mutate_product_options", () => {
    assert.equal(COMMUNITY_CATEGORIES.length, CATEGORIES.filter(category => !category.hidden_in_form).length + 1);
    assert.equal(CATEGORIES.some(category => String(category.id) === "comunidad-vecinal"), false);
    assert.equal(new Set(COMMUNITY_CATEGORIES.map(category => category.id)).size, COMMUNITY_CATEGORIES.length);
  });
  await test("one_required_category_and_valid_geo_in_new_creation", () => {
    const baseline = { nombre: "Mi grupo", lat: 17.99, lng: -92.94 };
    for (const category of COMMUNITY_CATEGORIES) assert.equal(fundarComunidadSchema.safeParse({ ...baseline, categoria_id: category.id }).success, true);
    assert.equal(fundarComunidadSchema.safeParse(baseline).success, false);
    assert.equal(fundarComunidadSchema.safeParse({ ...baseline, categoria_id: "Negocios" }).success, false);
    assert.equal(fundarComunidadSchema.safeParse({ ...baseline, categoria_id: "otros", lat: Infinity }).success, false);
    assert.equal(fundarComunidadSchema.safeParse({ ...baseline, categoria_id: "otros", lng: 181 }).success, false);
  });
  await test("rows_preserve_activity_or_distance_order_within_categories", () => {
    const items = [{ id: "first", categoria_id: "tecnologia" }, { id: "second", categoria_id: "comunidad-vecinal" }, { id: "third", categoria_id: "tecnologia" }, { id: "legacy", categoria_id: null }, { id: "future", categoria_id: "future-category" }];
    const groups = groupCommunitiesByCategory(items);
    assert.deepEqual(groups.find(group => group.id === "tecnologia")?.items.map(item => item.id), ["first", "third"]);
    assert.deepEqual(groups.find(group => group.id === "otros")?.items.map(item => item.id), ["legacy", "future"]);
  });
  await test("photo_paths_reject_foreign_groups_traversal_and_bad_uuid", () => {
    assert.equal(readCommunityPhotoPath(valid, id(1)), valid);
    assert.equal(isCommunityPhotoPath(valid, id(1), id(2)), true);
    assert.equal(isCommunityPhotoPath(valid, id(1), id(9)), false);
    for (const path of [valid.replace(id(1), id(9)), valid + "/other", valid.replace(id(2), ".."), valid.replace(id(3), "-".repeat(36)), "https://example.invalid/photo.webp"]) assert.equal(readCommunityPhotoPath(path, id(1)), null);
  });
  await test("server_signs_only_valid_row_paths_with_cache_lifetime_buffer", async () => {
    let requested: string[] = [], ttl = 0;
    const client = { storage: { from: () => ({ createSignedUrls: async (paths: string[], lifetime: number) => { requested = paths; ttl = lifetime; return { data: paths.map(path => ({ path, signedUrl: "https://fixture.invalid/signed" })) }; } }) } } as unknown as SupabaseClient;
    const rows = await withCommunityPhotos(client, [{ id: id(1), foto_path: valid }, { id: id(9), foto_path: valid }, { id: id(10), foto_path: null }]);
    assert.deepEqual(requested, [valid]); assert.equal(ttl, 600);
    assert.equal(rows[0].foto_url, "https://fixture.invalid/signed"); assert.equal(rows[1].foto_url, null); assert.equal(rows[2].foto_url, null);
  });
  await test("photo_service_outage_preserves_directory_with_initial_fallback", async () => {
    const client = { storage: { from: () => ({ createSignedUrls: async () => { throw new Error("offline"); } }) } } as unknown as SupabaseClient;
    const rows = await withCommunityPhotos(client, [{ id: id(1), nombre: "Conservada", foto_path: valid }]);
    assert.equal(rows[0].nombre, "Conservada"); assert.equal(rows[0].foto_url, null);
  });
  await test("uncertain_identity_cleanup_keeps_committed_or_unknown_photos", async () => {
    let removed: string[] = [], data: unknown = [{ id: id(1), mi_rol: "owner", foto_path: valid }], error: unknown = null;
    const client = { rpc: async () => ({ data, error }), storage: { from: () => ({ remove: async (paths: string[]) => { removed.push(...paths); return {}; } }) } } as unknown as SupabaseClient;
    await cleanupUnreferencedCommunityPhoto(client, id(1), valid); assert.deepEqual(removed, []);
    data = [{ id: id(1), mi_rol: "owner", foto_path: null }]; error = { message: "offline" };
    await cleanupUnreferencedCommunityPhoto(client, id(1), valid); assert.deepEqual(removed, []);
    error = null; data = [{ id: id(1), mi_rol: "moderator", foto_path: null }];
    await cleanupUnreferencedCommunityPhoto(client, id(1), valid); assert.deepEqual(removed, []);
    data = [{ id: id(9), mi_rol: "owner", foto_path: null }];
    await cleanupUnreferencedCommunityPhoto(client, id(1), valid); assert.deepEqual(removed, []);
    data = [{ id: id(1), mi_rol: "owner", foto_path: null }];
    await cleanupUnreferencedCommunityPhoto(client, id(1), valid); assert.deepEqual(removed, [valid]);
  });
  await test("upload_response_loss_cleans_staged_object_and_reuses_compression", async () => {
    const globals = globalThis as any;
    const originalBitmap = globals.createImageBitmap, originalDocument = globals.document;
    let uploaded = "", removed = "", closed = false;
    globals.createImageBitmap = async () => ({ width: 10, height: 10, close: () => { closed = true; } });
    globals.document = { createElement: () => ({ getContext: () => ({ drawImage: () => {} }), toBlob: (done: (blob: Blob) => void) => done(new Blob(["compressed"], { type: "image/webp" })) }) };
    const client = { storage: { from: () => ({ upload: async (path: string) => { uploaded = path; throw new Error("lost response"); }, remove: async (paths: string[]) => { removed = paths[0]; return {}; } }) } } as unknown as SupabaseClient;
    try {
      await assert.rejects(uploadCommunityPhoto(client, id(1), id(2), new File(["source"], "photo.png", { type: "image/png" })), /lost response/);
      assert.equal(isCommunityPhotoPath(uploaded, id(1), id(2)), true); assert.equal(removed, uploaded); assert.equal(closed, true);
    } finally { globals.createImageBitmap = originalBitmap; globals.document = originalDocument; }
  });
  console.log(`COMMUNITY_CONTRACTS=${passed}/${passed}`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
