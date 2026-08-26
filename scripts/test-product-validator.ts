// Prueba funcional del cruce tipo <-> categoria en el validador de producto.
//
//   npx tsx scripts/test-product-validator.ts
//
// Existe porque compilar no demuestra que una regla de validacion haga lo que
// dice. El filtro del formulario ya ofrecia solo las categorias del tipo
// elegido, pero eso es interfaz: un POST directo con tipo "producto" y la
// categoria "servicios-hogar" pasaba entero.

// Ruta relativa, no "@vicino/shared": el enlace del workspace vive en
// apps/web/node_modules y no resuelve desde scripts/ en la raiz.
import {
  createProductSchema,
  updateProductSchema,
} from "../packages/shared/src/validators/product.ts";

const base = {
  titulo: "Prueba de validacion",
  descripcion: "Descripcion suficientemente larga para pasar el minimo",
  modo_precio: "precio" as const,
  precio: 100,
  tipo_entrega: "punto_encuentro" as const,
};

const casos: Array<[string, unknown, boolean]> = [
  [
    "producto + categoria de producto  -> debe PASAR",
    { ...base, tipo: "producto", categories: [{ slug: "comida", is_primary: true }] },
    true,
  ],
  [
    "producto + categoria de SERVICIO  -> debe FALLAR",
    { ...base, tipo: "producto", categories: [{ slug: "servicios-hogar", is_primary: true }] },
    false,
  ],
  [
    "servicio + categoria de servicio  -> debe PASAR",
    { ...base, tipo: "servicio", categories: [{ slug: "servicios-hogar", is_primary: true }] },
    true,
  ],
  [
    "servicio + categoria de PRODUCTO  -> debe FALLAR",
    { ...base, tipo: "servicio", categories: [{ slug: "comida", is_primary: true }] },
    false,
  ],
  [
    "producto + categoria 'otro'       -> debe PASAR (cajon deliberado)",
    { ...base, tipo: "producto", categories: [{ slug: "otros", is_primary: true }] },
    true,
  ],
  [
    "servicio + categoria 'otro'       -> debe PASAR",
    { ...base, tipo: "servicio", categories: [{ slug: "otros", is_primary: true }] },
    true,
  ],
  [
    "mezcla: una valida y una de otro tipo -> debe FALLAR",
    {
      ...base,
      tipo: "producto",
      categories: [
        { slug: "comida", is_primary: true },
        { slug: "servicios-hogar", is_primary: false },
      ],
    },
    false,
  ],
];

let fallos = 0;
for (const [nombre, dato, deberiaPasar] of casos) {
  const r = createProductSchema.safeParse(dato);
  const ok = r.success === deberiaPasar;
  if (!ok) fallos += 1;
  const detalle = r.success
    ? ""
    : "  ->  " + r.error.issues.map((i) => i.message).join(" | ").slice(0, 90);
  console.log(`${ok ? "  ok  " : "  FALLA"} ${nombre}${ok ? "" : detalle}`);
}

// El de edicion es parcial: no debe exigir nada cuando no manda los dos campos.
const parcial = updateProductSchema.safeParse({ titulo: "Solo cambio el titulo" });
const okParcial = parcial.success === true;
if (!okParcial) fallos += 1;
console.log(`${okParcial ? "  ok  " : "  FALLA"} edicion parcial (solo titulo) -> debe PASAR`);

const parcialMala = updateProductSchema.safeParse({
  tipo: "producto",
  categories: [{ slug: "servicios-hogar", is_primary: true }],
});
const okParcialMala = parcialMala.success === false;
if (!okParcialMala) fallos += 1;
console.log(`${okParcialMala ? "  ok  " : "  FALLA"} edicion con los dos campos incoherentes -> debe FALLAR`);

console.log(fallos === 0 ? "\nTodos los casos pasan." : `\n${fallos} caso(s) FALLAN.`);
process.exit(fallos === 0 ? 0 : 1);
