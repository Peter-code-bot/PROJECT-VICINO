import assert from "node:assert/strict";
import { test } from "node:test";
import { discardOnboardingStepDraft, fieldsForOnboardingStep, initialOnboardingDraft, reconcileOnboardingDraft, restoreOnboardingDraft } from "../apps/web/lib/onboarding/draft.ts";
import type { OnboardingProfile } from "../apps/web/app/(onboarding)/completar-perfil/load-profile";
const saved: OnboardingProfile = { id: "synthetic-a", username: "ana_1000", nombre: "Ana", bio: "Descripción confirmada",
  foto: "https://example.invalid/avatar.jpg", intereses: ["hogar"], onboarding_camino: "vender", onboarding_paso: "descripcion",
  has_seen_onboarding: false, es_vendedor: false, seller_type: "business", categoria_negocio: "comida",
  nombre_negocio: "Nombre confirmado", descripcion_negocio: "Negocio confirmado", metodos_pago_aceptados: "Efectivo", onboarding_revision: 5 };

test("a newer snapshot refreshes untouched values while preserving personal and business edits", () => {
  const edited = { ...initialOnboardingDraft(saved), nombre: "Nombre en edición", nombreNegocio: "Negocio en edición", intereses: ["ropa"] };
  const fresh = { ...saved, onboarding_revision: 6, username: "ana_2000", foto: "https://example.invalid/new.jpg",
    nombre: "Nombre de otra pestaña", nombre_negocio: "Negocio de otra pestaña", intereses: ["tecnologia"], metodos_pago_aceptados: "Transferencia" };
  const reconciled = reconcileOnboardingDraft(edited, saved, fresh);
  assert.equal(reconciled.nombre, edited.nombre); assert.equal(reconciled.nombreNegocio, edited.nombreNegocio);
  assert.deepEqual(reconciled.intereses, ["ropa"]);
  assert.equal(reconciled.username, "ana_2000"); assert.equal(reconciled.foto, fresh.foto);
  assert.deepEqual(reconciled.pagos, ["Transferencia"]);
  assert.equal(edited.username, saved.username, "neither the draft nor the previous snapshot is mutated");
});

test("continuing one question cannot submit edits from any other question", () => {
  const draft = { ...initialOnboardingDraft(saved), nombre: "Otra persona", nombreNegocio: "Otro negocio", bio: "Borrador sin confirmar", pagos: ["Transferencia"] };
  assert.deepEqual(fieldsForOnboardingStep("nombre", draft, false), { nombre: "Otra persona" });
  assert.deepEqual(fieldsForOnboardingStep("nombre", draft, true), { nombre_negocio: "Otro negocio" });
  assert.deepEqual(fieldsForOnboardingStep("descripcion", draft, false), { bio: "Borrador sin confirmar" });
  assert.deepEqual(fieldsForOnboardingStep("descripcion", draft, true), { descripcion_negocio: "Negocio confirmado" });
  assert.deepEqual(fieldsForOnboardingStep("pagos", draft, true), { metodos_pago_aceptados: "Transferencia" });
  for (const step of ["ubicacion", "notificaciones", "listo"] as const) assert.deepEqual(fieldsForOnboardingStep(step, draft, true), {});
});

test("Omitir restores just the current field from confirmed state", () => {
  const draft = { ...initialOnboardingDraft(saved), nombreNegocio: "Omitido", descripcionNegocio: "Editar después", foto: "https://example.invalid/uploaded.jpg" };
  const skippedName = discardOnboardingStepDraft(draft, saved, "nombre", true);
  assert.equal(skippedName.nombreNegocio, saved.nombre_negocio);
  assert.equal(skippedName.descripcionNegocio, "Editar después");
  assert.equal(skippedName.foto, draft.foto);
  const skippedPhoto = discardOnboardingStepDraft(skippedName, saved, "foto", true);
  assert.equal(skippedPhoto.foto, saved.foto);
  assert.equal(skippedPhoto.descripcionNegocio, "Editar después");
});

test("business/casual branch changes use the intended field only", () => {
  const draft = { ...initialOnboardingDraft(saved), tipo: "casual" as const, nombre: "Nombre personal editado", nombreNegocio: "Negocio anterior" };
  assert.deepEqual(fieldsForOnboardingStep("tipo", draft, true), { seller_type: "casual" });
  assert.deepEqual(fieldsForOnboardingStep("nombre", draft, false), { nombre: "Nombre personal editado" });
  assert.equal(discardOnboardingStepDraft(draft, saved, "tipo", true).tipo, "business");
});

test("interests payload detaches from future checkbox edits", () => {
  const draft = initialOnboardingDraft(saved);
  const payload = fieldsForOnboardingStep("intereses", draft, false);
  draft.intereses.push("ropa");
  assert.deepEqual(payload.intereses, ["hogar"]);
});

test("a corrupt optional draft falls back without altering the confirmed profile", () => {
  for (const raw of [null, "{", "null", "[]", "42"]) assert.deepEqual(restoreOnboardingDraft(saved, raw), initialOnboardingDraft(saved));
  assert.deepEqual(restoreOnboardingDraft(saved, JSON.stringify({ nombre: 24, pagos: [42], es_vendedor: true })), initialOnboardingDraft(saved));
  assert.equal(saved.es_vendedor, false);
});
