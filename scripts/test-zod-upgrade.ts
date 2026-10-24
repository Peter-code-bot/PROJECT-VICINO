/** Regressions for the security upgrade: real application schemas, no remote I/O. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { createProductSchema, updateProductSchema } from "../packages/shared/src/validators/product";
import { fundarComunidadSchema } from "../packages/shared/src/validators/community";
import { signUpSchema } from "../packages/shared/src/validators/auth";
import { createSaleConfirmationSchema, respondPurchaseIntentSchema } from "../packages/shared/src/validators/sale-confirmation";
import { chatOperationSchema } from "../apps/web/lib/chat/operations";
import { interpretarRespuesta } from "../apps/web/lib/verificacion/analisis";

const id = "00000000-0000-4000-8000-000000000001";

test("partial product edits preserve omitted description, price mode and delivery", () => {
  const patch = updateProductSchema.parse({ titulo: "Nuevo título" });
  assert.deepEqual(patch, { titulo: "Nuevo título" });
  assert.deepEqual({ descripcion: "Original", modo_precio: "cotizacion", tipo_entrega: "recoger_local", ...patch }, {
    titulo: "Nuevo título", descripcion: "Original", modo_precio: "cotizacion", tipo_entrega: "recoger_local",
  });
  assert.deepEqual(updateProductSchema.parse({ descripcion: "  ", tipo_entrega: "acordar_chat" }), {
    descripcion: "", tipo_entrega: "acordar_chat",
  });
});

test("product creation keeps defaults and still checks price/category coherence", () => {
  const input = { titulo: "Mesa nueva", tipo: "producto", precio: 20, categories: [{ slug: "comida", is_primary: true }] };
  const value = createProductSchema.parse(input);
  assert.equal(value.descripcion, "");
  assert.equal(value.modo_precio, "precio");
  assert.equal(value.tipo_entrega, "punto_encuentro");
  assert.equal(createProductSchema.safeParse({ ...input, precio: undefined }).success, false);
  assert.equal(createProductSchema.safeParse({ ...input, categories: [{ slug: "servicios-hogar", is_primary: true }] }).success, false);
  assert.equal(createProductSchema.safeParse({ ...input, categories: [{ slug: "inventada", is_primary: true }] }).success, false);
});

test("oversized product collections are rejected before traversing attacker-controlled elements", () => {
  let visits = 0;
  const categories = Array.from({ length: 10_000 }, () => ({
    get slug() { visits += 1; return "inventada"; }, is_primary: false,
  }));
  const result = createProductSchema.safeParse({ titulo: "Mesa", tipo: "producto", precio: 20, categories });
  assert.equal(result.success, false);
  assert.equal(visits, 0);
  if (!result.success) assert.ok(result.error.issues.some(issue => issue.code === "too_big"));
});

test("missing optional AI response fields normalize conservatively; mandatory booleans remain strict", () => {
  const input = {
    es_credencial_valida: true, el_nombre_coincide: true, vigente: true,
    frente: { legible: true, vigente: true, sellos_o_elementos_de_seguridad: true },
    reverso: { presente: true, legible: true, corresponde_al_frente: true },
    selfie: { rostro_detectado: true, misma_persona: true },
  };
  const value = interpretarRespuesta(JSON.stringify(input));
  assert.ok(value);
  assert.equal(value.veredicto, "revision_humana");
  assert.equal(value.confianza_porcentaje, 0);
  assert.equal(value.selfie.confianza_rostro_porcentaje, 0);
  assert.equal(value.nombre_en_documento, null);
  assert.equal(value.la_universidad_coincide, null);
  assert.equal(value.frente.observacion, null);
  assert.equal(interpretarRespuesta(JSON.stringify({ ...input, vigente: "true" })), null);
});

test("community required and location errors stay in Spanish", () => {
  const result = fundarComunidadSchema.safeParse({ lat: "invalid", lng: 0 });
  assert.equal(result.success, false);
  if (!result.success) {
    const messages = Object.fromEntries(result.error.issues.map(issue => [issue.path[0], issue.message]));
    assert.equal(messages.nombre, "Escribe un nombre");
    assert.equal(messages.categoria_id, "Elige una categoría");
    assert.equal(messages.lat, "Ubicación inválida");
  }
});

test("registration normalizes email without modifying passwords", () => {
  const result = signUpSchema.parse({ email: "  PERSONA@example.com ", password: "  literal  ", fullName: " Ana " });
  assert.equal(result.email, "persona@example.com");
  assert.equal(result.password, "  literal  ");
  assert.equal(result.fullName, "Ana");
});

test("sale validation preserves quantity default and never invents payment or delivery", () => {
  const value = createSaleConfirmationSchema.parse({ product_id: id, chat_id: id, producto_revision: 0, clave_idempotencia: id, precio_acordado: 19.99 });
  assert.equal(value.cantidad, 1);
  assert.equal(Object.hasOwn(value, "metodo_pago"), false);
  assert.equal(Object.hasOwn(value, "tipo_entrega"), false);
  assert.equal(createSaleConfirmationSchema.safeParse({ ...value, precio_acordado: 19.999 }).success, false);
  assert.equal(respondPurchaseIntentSchema.safeParse({ messageId: id, action: "aceptar", price: 20 }).success, false);
  assert.equal(respondPurchaseIntentSchema.safeParse({ messageId: id, action: "rechazar", price: 20, quantity: 1 }).success, false);
});

test("operation prices accept PostgreSQL numeric strings and preserve null", () => {
  assert.equal(chatOperationSchema.shape.price.parse("19.99"), 19.99);
  assert.equal(chatOperationSchema.shape.price.parse(null), null);
  assert.equal(chatOperationSchema.shape.price.safeParse(undefined).success, false);
});
