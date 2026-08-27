// Prueba de las piezas puras de los adjuntos del chat.
//
//   ./node_modules/.bin/tsx scripts/test-adjuntos-chat.ts
//
// Se prueban las dos funciones que deciden QUE entra: `admitirFotos`, que filtra
// lo que se elige en el movil, y `leerAdjuntos`, que interpreta lo que llega de
// la base. La segunda es la que importa de verdad: ese jsonb lo escribio otra
// persona, y la policy de INSERT de messages permite escribirlo directamente
// desde el navegador con la llave anon. O sea que puede traer cualquier cosa.
//
// La subida y la firma no se prueban aqui porque no son puras: piden red y una
// sesion. Esas dos se ejercieron contra produccion con scripts/db-probe.mjs,
// bajo el rol authenticated y con transaccion revertida.

import { admitirFotos } from "../apps/web/app/(marketplace)/chat/[id]/photo-tray.tsx";
import { leerAdjuntos } from "../apps/web/lib/chat/attachments.ts";

const archivo = (nombre: string, tipo: string): File =>
  new File([new Uint8Array(1)], nombre, { type: tipo });

/** File.size es de solo lectura, asi que para probar el tope se sustituye. */
const conPeso = (f: File, bytes: number): File => {
  Object.defineProperty(f, "size", { value: bytes });
  return f;
};

const jpg = (n = "a.jpg") => archivo(n, "image/jpeg");
const pdf = () => archivo("x.pdf", "application/pdf");
const gigante = () => conPeso(archivo("g.jpg", "image/jpeg"), 20 * 1024 * 1024);

let fallos = 0;
const comprobar = (nombre: string, real: unknown, esperado: unknown) => {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) fallos++;
  console.log(`${ok ? "OK  " : "FALLA"}  ${nombre}`);
  if (!ok) console.log(`        esperado ${JSON.stringify(esperado)}\n        real     ${JSON.stringify(real)}`);
};

console.log("\n--- admitirFotos ---");

comprobar(
  "acepta imagenes normales",
  admitirFotos([], [jpg("a.jpg"), jpg("b.jpg")]).fotos.length,
  2,
);
comprobar(
  "rechaza lo que no es imagen",
  admitirFotos([], [pdf()]).fotos.length,
  0,
);
comprobar(
  "y lo dice en voz alta",
  admitirFotos([], [pdf()]).aviso.includes("solo se pueden mandar imágenes"),
  true,
);
comprobar(
  "rechaza una foto demasiado pesada",
  admitirFotos([], [gigante()]).fotos.length,
  0,
);
comprobar(
  "corta en el maximo por mensaje",
  admitirFotos([], [jpg(), jpg(), jpg(), jpg(), jpg(), jpg(), jpg()]).fotos.length,
  5,
);
comprobar(
  "y avisa de que corto",
  admitirFotos([], [jpg(), jpg(), jpg(), jpg(), jpg(), jpg()]).aviso.includes("máximo"),
  true,
);
comprobar(
  "respeta las que ya habia",
  admitirFotos([jpg(), jpg(), jpg(), jpg()], [jpg(), jpg()]).fotos.length,
  5,
);
comprobar(
  "sin nada que rechazar, no inventa aviso",
  admitirFotos([], [jpg()]).aviso,
  "",
);

console.log("\n--- leerAdjuntos ---");

const bueno = { path: "chat/uid/a.webp", tipo: "image", w: 100, h: 200 };

comprobar("lee un adjunto correcto", leerAdjuntos([bueno]), [bueno]);
comprobar("array vacio", leerAdjuntos([]), []);
comprobar("null no revienta", leerAdjuntos(null), []);
comprobar("un objeto suelto no es un array", leerAdjuntos({ path: "x" }), []);
comprobar("una cadena tampoco", leerAdjuntos("[]"), []);
comprobar("descarta el elemento sin path", leerAdjuntos([{ tipo: "image" }]), []);
comprobar(
  "descarta el tipo que no es image",
  leerAdjuntos([{ path: "a", tipo: "video" }]),
  [],
);
comprobar("descarta null dentro del array", leerAdjuntos([null, bueno]), [bueno]);
comprobar(
  "un adjunto malo no tira a los buenos",
  leerAdjuntos([{ path: 42 }, bueno]).length,
  1,
);
comprobar(
  "dimensiones que no son numeros se ignoran, no rompen",
  leerAdjuntos([{ path: "a", tipo: "image", w: "100", h: null }]),
  [{ path: "a", tipo: "image", w: undefined, h: undefined }],
);

console.log(
  fallos === 0
    ? "\nTodo en verde.\n"
    : `\n${fallos} caso(s) en rojo.\n`,
);
process.exit(fallos === 0 ? 0 : 1);
