import assert from "node:assert/strict";
import test from "node:test";
import {
  calcularPagina,
  camposQueCoinciden,
  enmascararCorreo,
  hrefDePagina,
  leerPagina,
  MAX_LARGO_BUSQUEDA,
  normalizarTexto,
  palabrasDeBusqueda,
  primerValor,
  rangoVisible,
  USUARIOS_POR_PAGINA,
} from "./busqueda-usuarios";

// Datos inventados: el repositorio es publico y aqui no va ninguna cuenta real.
const tienda = {
  nombre: "Tacos Doña Lupe",
  nombre_negocio: "Tacos Doña Lupe",
  username: "U1234567",
  user_id: "U1234567",
  correo: "contacto@ejemplo.mx",
  nombre_registro: "Guadalupe Martínez Ruiz",
};

const persona = {
  nombre: "Pepe Hernández",
  nombre_negocio: null,
  username: "pepeh",
  user_id: "U7654321",
  correo: "pp.h@ejemplo.com",
  nombre_registro: "José Hernández López",
};

test("normaliza sin acentos, dieresis, mayusculas ni espacios de mas", () => {
  assert.equal(normalizarTexto("  Canción   PEÑÓN  Pingüino "), "cancion penon pinguino");
  assert.equal(normalizarTexto("ÁÉÍÓÚ"), "aeiou");
  assert.equal(normalizarTexto(null), "");
  assert.equal(normalizarTexto(42), "");
});

test("separa palabras sin repetir, quita la arroba inicial y respeta los topes", () => {
  assert.deepEqual(palabrasDeBusqueda("  José   jose @PepeH "), ["jose", "pepeh"]);
  assert.deepEqual(palabrasDeBusqueda(""), []);
  assert.deepEqual(palabrasDeBusqueda("   "), []);
  assert.deepEqual(palabrasDeBusqueda(undefined), []);
  assert.deepEqual(palabrasDeBusqueda(["primera", "segunda"]), ["primera"], "con ?q repetido manda el primero");
  assert.equal(palabrasDeBusqueda("a b c d e f g h i j").length, 8, "no mas de 8 palabras");
  const larga = palabrasDeBusqueda("x".repeat(MAX_LARGO_BUSQUEDA + 50));
  assert.equal(larga[0]?.length, MAX_LARGO_BUSQUEDA, "lo que pasa del largo maximo se ignora");
});

test("encuentra por el nombre del negocio aunque el nombre visible sea otro", () => {
  assert.deepEqual(
    camposQueCoinciden(tienda, palabrasDeBusqueda("doña lupe")),
    ["nombre", "nombre_negocio", "nombre_registro"],
    "dona solo esta en los nombres; lupe tambien dentro de Guadalupe",
  );
  assert.deepEqual(camposQueCoinciden({ ...tienda, nombre: "Lupita" }, palabrasDeBusqueda("tacos")), ["nombre_negocio"]);
});

test("encuentra por el nombre de registro cuando el del perfil es un apodo", () => {
  assert.deepEqual(camposQueCoinciden(persona, palabrasDeBusqueda("Jose")), ["nombre_registro"]);
  assert.deepEqual(
    camposQueCoinciden(persona, palabrasDeBusqueda("jose hernandez")),
    ["nombre", "nombre_registro"],
    "hernandez esta en los dos nombres; jose solo en el de registro",
  );
});

test("encuentra por correo completo o parcial, por usuario y por codigo", () => {
  assert.deepEqual(camposQueCoinciden(persona, palabrasDeBusqueda("pp.h@ejemplo.com")), ["correo"]);
  assert.deepEqual(camposQueCoinciden(persona, palabrasDeBusqueda("EJEMPLO.COM")), ["correo"]);
  assert.deepEqual(camposQueCoinciden(persona, palabrasDeBusqueda("@pepeh")), ["username"]);
  assert.deepEqual(camposQueCoinciden(persona, palabrasDeBusqueda("u7654321")), ["user_id"]);
});

test("cada palabra tiene que aparecer en algun campo, aunque sean campos distintos", () => {
  assert.deepEqual(camposQueCoinciden(persona, palabrasDeBusqueda("jose ejemplo")), ["correo", "nombre_registro"]);
  assert.equal(camposQueCoinciden(persona, palabrasDeBusqueda("jose tacos")), null, "tacos no esta en ningun campo");
  assert.equal(camposQueCoinciden(persona, []), null, "sin palabras no hay busqueda");
});

test("los campos vacios o ausentes no coinciden con nada", () => {
  assert.equal(camposQueCoinciden({ nombre: null, correo: undefined }, ["a"]), null);
  assert.equal(camposQueCoinciden({}, ["a"]), null);
});

test("lee la pagina de la URL y rechaza lo que no es un entero positivo", () => {
  assert.equal(leerPagina("3"), 3);
  assert.equal(leerPagina(["2", "9"]), 2);
  assert.equal(leerPagina(undefined), 1);
  for (const malo of ["0", "-1", "1.5", "abc", "", "1e3", "9999999", " 2"]) {
    assert.equal(leerPagina(malo), 1, `"${malo}" cae en la primera pagina`);
  }
});

test("calcula la pagina y el rango que pide PostgREST", () => {
  assert.equal(USUARIOS_POR_PAGINA, 50);
  assert.deepEqual(calcularPagina(123, 1), { pagina: 1, paginas: 3, desde: 0, hasta: 49, total: 123 });
  assert.deepEqual(calcularPagina(123, 3), { pagina: 3, paginas: 3, desde: 100, hasta: 149, total: 123 });
  assert.deepEqual(rangoVisible(calcularPagina(123, 3)), { primero: 101, ultimo: 123 });
  assert.deepEqual(rangoVisible(calcularPagina(1, 1)), { primero: 1, ultimo: 1 });
  assert.deepEqual(calcularPagina(100, 2), { pagina: 2, paginas: 2, desde: 50, hasta: 99, total: 100 });
  assert.deepEqual(calcularPagina(101, 3), { pagina: 3, paginas: 3, desde: 100, hasta: 149, total: 101 });
});

test("una pagina que ya no existe cae en la ultima y sin datos hay una sola pagina", () => {
  assert.equal(calcularPagina(123, 7).pagina, 3);
  assert.deepEqual(calcularPagina(0, 4), { pagina: 1, paginas: 1, desde: 0, hasta: 49, total: 0 });
  assert.equal(rangoVisible(calcularPagina(0, 1)), null);
  assert.equal(calcularPagina(Number.NaN, 1).total, 0);
  assert.equal(calcularPagina(10, Number.NaN).pagina, 1);
  assert.deepEqual(calcularPagina(5, 1, 0), calcularPagina(5, 1), "un tamano invalido usa el de siempre");
});

test("los enlaces de pagina conservan la busqueda y el rol", () => {
  assert.equal(hrefDePagina("/admin/users", {}, 1), "/admin/users");
  assert.equal(hrefDePagina("/admin/users", {}, 2), "/admin/users?page=2");
  assert.equal(
    hrefDePagina("/admin/users", { q: "José & Cía", role: "moderator" }, 3),
    "/admin/users?q=Jos%C3%A9+%26+C%C3%ADa&role=moderator&page=3",
  );
  assert.equal(hrefDePagina("/admin/users", { q: "lupe" }, 1), "/admin/users?q=lupe");
});

test("enmascara el correo sin perder el dominio", () => {
  assert.equal(enmascararCorreo("contacto.lupe@ejemplo.mx"), "con•••@ejemplo.mx");
  assert.equal(enmascararCorreo("ab@ejemplo.mx"), "a•••@ejemplo.mx");
  assert.equal(enmascararCorreo("  pp.h@ejemplo.com "), "pp.•••@ejemplo.com");
  for (const malo of [null, undefined, "", "sin-arroba", "@ejemplo.mx", "nombre@", 7]) {
    assert.equal(enmascararCorreo(malo), null);
  }
});

test("primerValor acepta texto o arreglo y descarta lo demas", () => {
  assert.equal(primerValor("a"), "a");
  assert.equal(primerValor(["b", "c"]), "b");
  assert.equal(primerValor([1]), undefined);
  assert.equal(primerValor(undefined), undefined);
});
