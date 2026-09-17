/**
 * El catalogo de tipos de notificacion, en UN solo sitio.
 *
 * Antes eran dos listas de cadenas independientes: CLAVES_PERMITIDAS en
 * configuracion/notificaciones/actions.ts y el catalogo visual TIPOS de
 * preferencias-form.tsx, cuyo campo `clave` era un `string` cualquiera. Una
 * errata en una sola de las dos compilaba limpio: el interruptor se pintaba,
 * la persona lo tocaba y la accion rechazaba la clave que ella no eligio. Y al
 * contrario —un tipo anadido solo en la accion— deja una clave que nadie puede
 * apagar. Con el tipo derivado de esta lista, esa divergencia pasa a ser un
 * error de compilacion.
 *
 * Este modulo es NORMAL, no "use server", y es a proposito: en un modulo
 * "use server" toda exportacion tiene que ser una funcion async (cualquier otra
 * cosa es un 500 en runtime con la pantalla ya pintada), asi que la lista no
 * puede vivir en actions.ts. Tampoco lleva "use client": lo importan el cliente
 * y el servidor.
 *
 * La base NO conoce este catalogo a proposito (DECISION 1 de la migracion
 * 20260916180000): valida forma —clave con pinta de slug, valor booleano— y no
 * contenido, para que anadir un tipo no cueste una migracion. El filtro de
 * contenido vive aqui, que es el borde por donde entra el dato.
 *
 * OJO, la tercera copia que TypeScript no puede vigilar: supabase/functions/
 * send-push/index.ts corre en Deno, no comparte tsconfig ni alias con la app, y
 * tiene su propio mapa de tabla -> grupo con estas mismas cadenas. Al anadir o
 * renombrar un grupo hay que tocarlo tambien; alli queda dicho con un comentario
 * que apunta a este archivo.
 */
export const CLAVES_NOTIFICACION = [
  "chat",
  "ventas",
  "comunidades",
  "novedades",
] as const;

export type ClaveNotificacion = (typeof CLAVES_NOTIFICACION)[number];

/**
 * Si una cadena cualquiera es uno de los tipos del catalogo.
 *
 * Recibe `unknown` porque quien pregunta es un endpoint HTTP: el argumento
 * puede llegar como numero, null o una cadena de un megabyte, y ahi TypeScript
 * no protege nada.
 */
export function esClaveNotificacion(valor: unknown): valor is ClaveNotificacion {
  return (
    typeof valor === "string" &&
    (CLAVES_NOTIFICACION as readonly string[]).includes(valor)
  );
}
