/**
 * ¿Las fotos de una solicitud son objetos DISTINTOS del bucket? Logica pura.
 *
 * Leer las rutas de la fila (y no de la llamada) cerro que el vendedor eligiera
 * que fotos analiza el modelo, pero no esto: las tres columnas de URL las puede
 * escribir el propio vendedor por REST (20260826301000 le deja el UPDATE), asi
 * que puede apuntar dos ranuras al MISMO objeto. Con la selfie y el frente
 * iguales, el modelo compara la foto del documento consigo misma y la nota
 * diria «todo cuadra»; el revisor veria dos imagenes iguales.
 *
 * Por eso no basta con comparar los textos. storage-js mete la ruta tal cual en
 * la URL de descarga (download() no la codifica), y el analizador de URL de
 * fetch la corta en ? y en #, convierte \ en / y resuelve los segmentos «.»
 * (tambien escritos %2e). Ademas, el enrutador del servidor decodifica %xx en
 * los parametros de la ruta (inferido: no se probo contra Storage). Asi que
 * «uid/selfie», «uid/selfie#1», «uid/./selfie» y, casi seguro, «uid/%73elfie»
 * bajan el mismo archivo. Aqui se compara el objeto que de verdad se pediria.
 *
 * El mismo analizador quita los tabuladores y saltos de linea en cualquier
 * posicion, y los espacios y controles del final. Como download() deja la ruta
 * al final de la URL, sin consulta, «uid/selfie » tambien baja «uid/selfie» (se
 * comprobo con `new URL` en Node). Una ruta con controles o con espacios en los
 * bordes no la escribe la interfaz, y no se sabe con certeza que objeto pediria:
 * cuenta como repetida, igual que su version con %xx (%09, %00, %20...).
 *
 * LO QUE NO VE: el mismo CONTENIDO subido con dos nombres (por ejemplo, los
 * bytes del frente subidos tambien como <uid>/selfie). La policy del bucket
 * admite cualquier nombre bajo <uid>/, asi que eso sigue pasando; detectarlo
 * pediria comparar los bytes ya descargados. Esto solo impide que dos ranuras
 * pidan el mismo objeto.
 *
 * Solo se exige que sean distintas, no las rutas canonicas (<uid>/selfie,
 * <uid>/ine_front, <uid>/ine_back): hay filas legadas con otros nombres y antes
 * hay que revisarlas.
 */

/**
 * ¿Trae controles C0, DEL o espacios en los bordes? El analizador de URL quita
 * unos y codifica otros, y lo que hace el servidor con el resto no se sabe. Se
 * recorre por codigo de caracter para no meter controles en una regex.
 */
function esAmbigua(texto: string): boolean {
  if (texto !== texto.trim()) return true;
  for (let i = 0; i < texto.length; i++) {
    const codigo = texto.charCodeAt(i);
    if (codigo <= 0x1f || codigo === 0x7f) return true;
  }
  return false;
}

/** El objeto que pediria la descarga para esa ruta, o null si no se puede saber con certeza. */
function objetoDeLaRuta(ruta: string): string | null {
  if (esAmbigua(ruta)) return null;
  const sinConsulta = ruta.split(/[?#]/, 1)[0] ?? "";
  let decodificada: string;
  try {
    decodificada = decodeURIComponent(sinConsulta);
  } catch {
    // Un %xx que no se puede decodificar: no se sabe que objeto es.
    return null;
  }
  // Lo mismo escrito con %xx, y un espacio justo antes de la consulta o del
  // fragmento (que la URL codifica en vez de quitar).
  if (esAmbigua(decodificada)) return null;
  const segmentos = decodificada
    .replace(/\\/g, "/")
    .split("/")
    .filter((s) => s !== "" && s !== ".");
  if (segmentos.length === 0 || segmentos.includes("..")) return null;
  return segmentos.join("/");
}

/**
 * true si todas las rutas apuntan a objetos distintos. Una ruta de la que no se
 * puede saber a que objeto apunta cuenta como repetida: ante la duda, no se
 * analiza.
 */
export function sonFotosDistintas(rutas: readonly string[]): boolean {
  const objetos = rutas.map(objetoDeLaRuta);
  if (objetos.some((o) => o === null)) return false;
  return new Set(objetos).size === objetos.length;
}
