import assert from "node:assert/strict";
import test from "node:test";
import { filasCampus } from "./university-rows";
import { universitySearchUrl, UNIVERSITY_SEARCH_URL } from "./university";

const pc = (slug: string) => [{ is_primary: true, categories: { slug, nombre: slug } }];
const prod = (id: string, slug: string | null, categoria: string | null = null) => ({
  id,
  categoria,
  product_categories: slug ? pc(slug) : [],
});

test("agrupa por la categoria primary y conserva el orden de entrada", () => {
  const { filas } = filasCampus([prod("a", "arte"), prod("b", "comida"), prod("c", "arte")]);
  assert.deepEqual(filas.map(([s, ps]) => [s, ps.map((p) => p.id)]), [["arte", ["a", "c"]], ["comida", ["b"]]]);
});

test("sin pivote cae al TEXT y luego a sin-categoria, como el catalogo general", () => {
  const { filas } = filasCampus([prod("a", null, "ropa"), prod("b", null, null)]);
  assert.deepEqual(filas.map(([s]) => s), ["ropa", "sin-categoria"]);
});

test("una categoria con publicaciones viejas SI tiene fila aunque haya 20 mas nuevas de otra", () => {
  const nuevas = Array.from({ length: 22 }, (_, i) => prod(`n${i}`, "comida"));
  const viejas = Array.from({ length: 22 }, (_, i) => prod(`v${i}`, "arte"));
  const { filas } = filasCampus([...nuevas, ...viejas]);
  const arte = filas.find(([s]) => s === "arte");
  assert.ok(arte, "arte debe tener fila");
  assert.equal(arte[1].length, 20, "cada fila se recorta a 20");
  assert.equal(filas.find(([s]) => s === "comida")![1].length, 20);
});

test("truncado solo cuando el pool llego al tope", () => {
  assert.equal(filasCampus([prod("a", "arte")], { tamPool: 150 }).truncado, false);
  const lleno = Array.from({ length: 5 }, (_, i) => prod(`x${i}`, "arte"));
  assert.equal(filasCampus(lleno, { tamPool: 5 }).truncado, true);
});

test("no muta la entrada", () => {
  const entrada = Object.freeze([prod("a", "arte"), prod("b", "arte")]);
  filasCampus(entrada, { tamFila: 1 });
  assert.equal(entrada.length, 2);
});

test("universitySearchUrl conserva la categoria y la codifica", () => {
  assert.equal(universitySearchUrl("comida"), `${UNIVERSITY_SEARCH_URL}&subcategory=comida`);
  assert.equal(universitySearchUrl("a b&c"), `${UNIVERSITY_SEARCH_URL}&subcategory=a%20b%26c`);
  assert.equal(universitySearchUrl(""), UNIVERSITY_SEARCH_URL);
  assert.equal(universitySearchUrl("universidad"), UNIVERSITY_SEARCH_URL);
  assert.equal(universitySearchUrl(undefined), UNIVERSITY_SEARCH_URL);
});
