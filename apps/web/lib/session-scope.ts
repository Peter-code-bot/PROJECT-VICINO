/**
 * Ambito de zona para las entradas del inicio en la cache de sesion.
 *
 * El feed del inicio depende de dos cookies (`vicino_location` y
 * `vicino_radius`). Cambiar de zona tiene que cambiar la clave en memoria,
 * para que la zona anterior nunca preste su feed a la nueva. La misma funcion
 * la usan el cliente (con `document.cookie`) y el servidor (con `cookies()`),
 * para que la semilla del render coincida con la clave que el consumidor
 * calcula tras hidratar.
 */
const COOKIES_DE_ZONA = /^vicino_(location|radius)$/;

export function locationScopeFromPairs(pairs: ReadonlyArray<{ name: string; value: string }>): string {
  return pairs
    .filter(pair => COOKIES_DE_ZONA.test(pair.name))
    .map(pair => `${pair.name}=${pair.value}`)
    .sort()
    .join(";");
}

export function locationScopeFromDocumentCookie(cookie: string): string {
  return locationScopeFromPairs(
    cookie.split(";").map(part => part.trim()).filter(Boolean).map(part => {
      const separator = part.indexOf("=");
      return separator < 0
        ? { name: part, value: "" }
        : { name: part.slice(0, separator), value: part.slice(separator + 1) };
    }),
  );
}

/** Los cuatro feeds del inicio. Cualquier otra cosa es «Para ti». */
const FEEDS = ["parati", "following", "solicitudes", "comunidades"] as const;

/**
 * Clave del inicio en la memoria de sesion.
 *
 * El `feed` se NORMALIZA aqui, y por eso la misma funcion sirve al servidor
 * (que ya validó el parametro) y al cliente (que lee el crudo de la URL): con
 * `?feed=xyz` los dos producen la clave de «Para ti», que es lo que las dos
 * capas pintan. Sin normalizar, la semilla del servidor quedaba bajo una clave
 * que nadie leia y el cliente pedia a la API un feed que ella rechaza con 400.
 */
export function homeSessionKey(feed: string | null | undefined, scope: string): string {
  const params = new URLSearchParams();
  const normalizado = FEEDS.find(nombre => nombre === feed);
  if (normalizado && normalizado !== "parati") params.set("feed", normalizado);
  return `/api/session/home?${params}#${scope}`;
}
