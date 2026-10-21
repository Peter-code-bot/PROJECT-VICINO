/**
 * Validadores zod del programa de lealtad (@vicino/shared). Mismos limites que
 * la migracion: nombre 32, premio 60, meta 3-20, condiciones 500, color de la
 * paleta, plantilla del catalogo.
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/test-lealtad-validadores.ts
 */
import assert from "node:assert/strict";
import {
  LIMITES_LEALTAD,
  PALETA_LEALTAD,
  loyaltyConfirmRedemptionSchema,
  loyaltyProgramSchema,
  loyaltyProgramStatusSchema,
  loyaltyRedeemStartSchema,
  loyaltyReverseEventSchema,
} from "../packages/shared/src";

let checks = 0;
function test(name: string, run: () => void) {
  run();
  checks++;
  console.log(`PASS ${name}`);
}

const base = { nombre: "Tarjeta Strudel", premio: "1 café", meta_sellos: "5", condiciones: "", color: PALETA_LEALTAD[0], plantilla: "sellos" };

test("programa valido: recorta espacios, convierte la meta y vacia condiciones", () => {
  const r = loyaltyProgramSchema.parse({ ...base, nombre: "  Tarjeta Strudel  ", condiciones: "   " });
  assert.equal(r.nombre, "Tarjeta Strudel");
  assert.equal(r.meta_sellos, 5);
  assert.equal(r.condiciones, undefined);
  assert.equal(r.color, "#1F5A4E");
});

test("programa: limites del PDF", () => {
  assert.equal(loyaltyProgramSchema.safeParse({ ...base, nombre: "x".repeat(LIMITES_LEALTAD.nombre + 1) }).success, false);
  assert.equal(loyaltyProgramSchema.safeParse({ ...base, nombre: "x".repeat(LIMITES_LEALTAD.nombre) }).success, true);
  assert.equal(loyaltyProgramSchema.safeParse({ ...base, premio: "" }).success, false);
  assert.equal(loyaltyProgramSchema.safeParse({ ...base, premio: "x".repeat(LIMITES_LEALTAD.premio + 1) }).success, false);
  assert.equal(loyaltyProgramSchema.safeParse({ ...base, meta_sellos: "2" }).success, false);
  assert.equal(loyaltyProgramSchema.safeParse({ ...base, meta_sellos: "21" }).success, false);
  assert.equal(loyaltyProgramSchema.safeParse({ ...base, meta_sellos: "5.5" }).success, false);
  assert.equal(loyaltyProgramSchema.safeParse({ ...base, condiciones: "x".repeat(LIMITES_LEALTAD.condiciones + 1) }).success, false);
  assert.equal(loyaltyProgramSchema.safeParse({ ...base, color: "#FFFFFF" }).success, false, "fuera de la paleta");
  assert.equal(loyaltyProgramSchema.safeParse({ ...base, color: "rojo" }).success, false);
  assert.equal(loyaltyProgramSchema.safeParse({ ...base, plantilla: "neon" }).success, false);
});

test("estado: solo activo y pausado", () => {
  assert.equal(loyaltyProgramStatusSchema.safeParse("activo").success, true);
  assert.equal(loyaltyProgramStatusSchema.safeParse("archivado").success, false);
  assert.equal(loyaltyProgramStatusSchema.safeParse("borrador").success, false);
});

test("canje: codigo de 6 digitos, claves uuid, motivo acotado", () => {
  assert.equal(loyaltyConfirmRedemptionSchema.parse({ codigo: " 123456 " }).codigo, "123456");
  assert.equal(loyaltyConfirmRedemptionSchema.safeParse({ codigo: "12345" }).success, false);
  assert.equal(loyaltyConfirmRedemptionSchema.safeParse({ codigo: "12345a" }).success, false);
  assert.equal(loyaltyRedeemStartSchema.safeParse({ membershipId: "x", clave: "y" }).success, false);
  assert.equal(
    loyaltyRedeemStartSchema.safeParse({ membershipId: "00000000-0000-4000-8000-000000000001", clave: "00000000-0000-4000-8000-000000000002" }).success,
    true,
  );
  const reversa = loyaltyReverseEventSchema.parse({ eventId: "00000000-0000-4000-8000-000000000001", motivo: "  " });
  assert.equal(reversa.motivo, undefined);
  assert.equal(loyaltyReverseEventSchema.safeParse({ eventId: "00000000-0000-4000-8000-000000000001", motivo: "x".repeat(201) }).success, false);
});

console.log(`PASA ${checks}/${checks} pruebas de validadores de lealtad.`);
