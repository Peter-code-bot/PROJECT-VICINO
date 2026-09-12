import assert from "node:assert/strict";
import { test } from "node:test";
import { createNavigationMetrics } from "../apps/web/lib/observability/navigation-metrics";

test("route commit is not content readiness and an old marker cannot finish navigation", () => {
  let time = 0;
  const metrics = createNavigationMetrics(() => time);
  const id = metrics.begin("/perfil", "/", "swipe", ["old"]);
  time = 20; metrics.feedback(id);
  time = 100; metrics.commit("/perfil"); metrics.ready("old", "profile");
  assert.equal(metrics.read().length, 0);
  time = 800; metrics.ready("new", "profile");
  assert.deepEqual(metrics.read()[0], { id: 1, from: "home", to: "profile", source: "swipe", feedback_ms: 20, route_commit_ms: 100, core_dom_ms: 800, result: "ready" });
});
test("query changes, refresh, cancellation and redirection remain distinguishable without leaking destinations", () => {
  const metrics = createNavigationMetrics(() => 100);
  metrics.begin("/buscar?q=private-person", "/buscar?q=private-address", "link", []);
  metrics.commit("/buscar?q=private-person"); metrics.ready("new", "search");
  metrics.begin("/chat/private-id", "/", "link", []);
  metrics.begin("/perfil", "/", "link", []);
  metrics.commit("/login");
  metrics.begin("/perfil", "/perfil", "refresh", ["old"]);
  metrics.ready("newer", "profile");
  assert.deepEqual(metrics.read().map(sample => sample.result), ["ready", "cancelled", "redirected", "ready"]);
  assert.doesNotMatch(JSON.stringify(metrics.read()), /private|\/buscar|\/chat|q=/);
});
test("timeouts do not fake success and the buffer is bounded and cleared", () => {
  const metrics = createNavigationMetrics();
  for (let i = 0; i < 45; i++) { metrics.begin("/perfil", "/", "link", []); metrics.close("timeout"); }
  assert.equal(metrics.read().length, 40);
  assert.ok(metrics.read().every(sample => sample.core_dom_ms === null));
  metrics.clear(); assert.deepEqual(metrics.read(), []);
});
