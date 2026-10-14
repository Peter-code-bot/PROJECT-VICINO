/**
 * Un `window` minimo para probar los stores de lib/cuentas con node:test.
 *
 * Solo lo que esos modulos tocan: localStorage, sessionStorage y los dos
 * metodos de eventos. Cada almacen puede ponerse a fallar (`lanzar`) para
 * cubrir Safari con cookies bloqueadas y la cuota llena, que es donde estos
 * modulos tienen que degradar sin romper.
 */
export interface AlmacenFalso extends Storage {
  lanzar: boolean;
  datos: Map<string, string>;
}

export function crearAlmacenFalso(): AlmacenFalso {
  const datos = new Map<string, string>();
  const almacen = {
    lanzar: false,
    datos,
    get length() {
      return datos.size;
    },
    clear() {
      datos.clear();
    },
    getItem(clave: string) {
      if (almacen.lanzar) throw new Error("almacenamiento bloqueado");
      return datos.get(clave) ?? null;
    },
    key(indice: number) {
      return [...datos.keys()][indice] ?? null;
    },
    removeItem(clave: string) {
      if (almacen.lanzar) throw new Error("almacenamiento bloqueado");
      datos.delete(clave);
    },
    setItem(clave: string, valor: string) {
      if (almacen.lanzar) throw new Error("cuota llena");
      datos.set(clave, valor);
    },
  };
  return almacen as AlmacenFalso;
}

export interface WindowFalso {
  localStorage: AlmacenFalso;
  sessionStorage: AlmacenFalso;
  oyentes: Map<string, Set<() => void>>;
  disparar(evento: string): void;
}

/** Instala `window` (y `localStorage`/`sessionStorage`) en globalThis y lo devuelve. */
export function instalarWindowFalso(): WindowFalso {
  const oyentes = new Map<string, Set<() => void>>();
  const falso: WindowFalso & { addEventListener: (e: string, cb: () => void) => void; removeEventListener: (e: string, cb: () => void) => void } = {
    localStorage: crearAlmacenFalso(),
    sessionStorage: crearAlmacenFalso(),
    oyentes,
    addEventListener(evento, cb) {
      if (!oyentes.has(evento)) oyentes.set(evento, new Set());
      oyentes.get(evento)!.add(cb);
    },
    removeEventListener(evento, cb) {
      oyentes.get(evento)?.delete(cb);
    },
    disparar(evento) {
      for (const cb of oyentes.get(evento) ?? []) cb();
    },
  };
  (globalThis as { window?: unknown }).window = falso;
  return falso;
}
