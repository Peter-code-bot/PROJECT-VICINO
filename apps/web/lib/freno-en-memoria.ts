/**
 * Suelo de cuota que NO depende de Upstash.
 *
 * Sin `server-only` a proposito: es logica pura y asi se puede probar con
 * node:test sin el arnes de esbuild (`server-only` lo resuelve el bundler de
 * Next, no node). Nada aqui es secreto; un contador en memoria en el cliente
 * seria inutil, pero no peligroso.
 *
 * Los limitadores de `lib/rate-limit.ts` son la cuota de verdad, pero sin
 * credenciales de Upstash `enforce()` deja pasar todo (documentado alli). Para
 * la mayoria de las rutas eso solo significa trabajo extra de servidor. Para
 * las que gastan dinero de un tercero en cada peticion —el snapshot firmado de
 * Apple Maps— significa una factura, asi que hace falta un tope que exista
 * aunque Redis no.
 *
 * QUE ES Y QUE NO ES. Es un contador por instancia del proceso, en memoria:
 * Vercel puede tener varias instancias vivas, asi que el tope real es este
 * numero por instancia, no global. No sustituye a Upstash —por eso el
 * limitador compartido sigue delante— pero convierte «sin freno» en «freno
 * flojo», que es la diferencia entre una factura abierta y una acotada.
 *
 * Ventana deslizante por tramos de un segundo: cuesta un Map pequeño y no
 * tiene el escalon de las ventanas fijas (dos rafagas seguidas a caballo del
 * corte no pasan como una).
 */
type Cubeta = { tramos: Map<number, number>; visto: number };

const cubetas = new Map<string, Cubeta>();
/** Cuantas cubetas distintas se recuerdan; por encima, se olvida la mas vieja. */
const MAX_CUBETAS = 5_000;

export interface FrenoEnMemoria {
  /** true si la peticion cabe en la cuota; false si hay que rechazarla. */
  permitir: (identificador: string, ahora?: number) => boolean;
}

export function frenoEnMemoria({ tope, ventanaMs }: { tope: number; ventanaMs: number }): FrenoEnMemoria {
  return {
    permitir(identificador: string, ahora: number = Date.now()): boolean {
      const tramoActual = Math.floor(ahora / 1000);
      const desde = tramoActual - Math.ceil(ventanaMs / 1000);
      let cubeta = cubetas.get(identificador);
      if (!cubeta) {
        if (cubetas.size >= MAX_CUBETAS) {
          const masVieja = cubetas.keys().next().value;
          if (masVieja !== undefined) cubetas.delete(masVieja);
        }
        cubeta = { tramos: new Map(), visto: ahora };
        cubetas.set(identificador, cubeta);
      }
      cubeta.visto = ahora;
      let total = 0;
      for (const [tramo, cuantas] of cubeta.tramos) {
        if (tramo <= desde) cubeta.tramos.delete(tramo);
        else total += cuantas;
      }
      if (total >= tope) return false;
      cubeta.tramos.set(tramoActual, (cubeta.tramos.get(tramoActual) ?? 0) + 1);
      return true;
    },
  };
}
