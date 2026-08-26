/**
 * Cabecera de cache para los objetos de Storage cuya ruta es unica.
 *
 * Supabase pone max-age=3600 por defecto. Con eso, cada visitante vuelve a
 * descargar la misma foto de producto una vez por hora: el 91% del egress del
 * proyecto sale de ahi, y el egress es lo que decide si el plan aguanta.
 *
 * Un ano es seguro AQUI y solo aqui porque estas rutas llevan timestamp
 * (y en un caso ademas un sufijo aleatorio), asi que cada subida aterriza en
 * una ruta nueva y NINGUN objeto se sobrescribe jamas. Editar una foto no
 * reemplaza el archivo: crea otro y cambia la URL guardada en la fila.
 *
 * NO usar en verification-documents: esa ruta si es determinista y se
 * sobrescribe a proposito (para no acumular un archivo por reintento), asi que
 * un cache largo serviria el documento viejo despues de resubirlo.
 */
export const CACHE_INMUTABLE = "31536000"; // 1 ano, en segundos
