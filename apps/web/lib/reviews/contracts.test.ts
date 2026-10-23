import assert from "node:assert/strict";
import test from "node:test";
import { sellerReviewsSnapshotSchema, readSellerReviewsSchema } from "./contracts";
import { localReviewReturnPath } from "./navigation";

const summary = { count: 64, average: 4.9375, buckets: { 1: 1, 2: 0, 3: 0, 4: 0, 5: 63 } };
const own = { id: "550e8400-e29b-41d4-a716-446655440000", rating: 4, comentario: "Oculta", visible: false };
const review = { id: own.id, rating: 1, comentario: null, created_at: "2026-10-22T00:00:00Z", review_type: "buyer_to_seller", reviewer_id: own.id, respuesta: null, respuesta_fecha: null, is_verified: false, profiles: null, products_services: null };

test("snapshot supports full aggregate beyond loaded page and author-only hidden prefill", () => {
  const parsed = sellerReviewsSnapshotSchema.parse({ reviews: [review], summary, own_local_review: own });
  assert.equal(parsed.summary.count, 64);
  assert.equal(parsed.reviews.length, 1);
  assert.equal(parsed.own_local_review?.visible, false);
});

test("snapshot requires server verification flag and consistent visible count", () => {
  const { is_verified: omitted, ...legacy } = review;
  assert.equal(omitted, false);
  assert.equal(sellerReviewsSnapshotSchema.safeParse({ reviews: [legacy], summary, own_local_review: null }).success, false);
  assert.equal(sellerReviewsSnapshotSchema.safeParse({ reviews: [review], summary: { ...summary, count: 65 }, own_local_review: null }).success, false);
});

test("pagination boundary rejects malformed seller or negative offset", () => {
  assert.equal(readSellerReviewsSchema.safeParse({ sellerId: own.id, offset: -1 }).success, false);
  assert.equal(readSellerReviewsSchema.safeParse({ sellerId: "other", offset: 0 }).success, false);
  assert.deepEqual(readSellerReviewsSchema.parse({ sellerId: own.id }), { sellerId: own.id, offset: 0 });
});

test("authentication returns to the same local form preserving valid query and anchor", () => {
  assert.equal(localReviewReturnPath("https://vicinomarket.com/comida/pan?source=map#reviews"), "/comida/pan?source=map&reviewLocal=1#reviews");
  assert.equal(localReviewReturnPath("/login?next=%2Fcomida%2Fpan"), "/");
});
