/** Reintentos acotados por incidente; solo una instantanea confirmada reinicia
 * el presupuesto. Un SUBSCRIBED por si solo no acredita la sincronizacion. */
export function recuperacionConexion(options: {
  reconectar: () => void;
  recuperar: () => void;
  pendiente: () => void;
  disponible: () => boolean;
}) {
  let subscribed = false;
  let disposed = false;
  let attempts = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const clear = () => { clearTimeout(timer); timer = undefined; };
  const retry = () => {
    if (disposed || !options.disponible()) return;
    if (subscribed) options.recuperar();
    else options.reconectar();
  };
  const schedule = (delay: number) => {
    if (disposed || timer || attempts >= 3 || !options.disponible()) return;
    timer = setTimeout(() => {
      timer = undefined;
      if (!options.disponible()) return;
      attempts++;
      retry();
    }, delay);
  };
  return {
    esperando() {
      if (disposed) return;
      subscribed = false;
      clear();
      options.pendiente();
      // Incluye el caso en que subscribe nunca entrega un estado.
      schedule(15_000);
    },
    estado(status: string) {
      if (disposed) return;
      subscribed = status === "SUBSCRIBED";
      clear();
      if (subscribed) options.recuperar();
      else {
        options.pendiente();
        schedule([1_000, 3_000, 10_000][attempts] ?? 10_000);
      }
    },
    falloConsulta() {
      if (disposed) return;
      options.pendiente();
      schedule([1_000, 3_000, 10_000][attempts] ?? 10_000);
    },
    confirmada() { attempts = 0; clear(); },
    reintentar() { clear(); attempts = 0; retry(); },
    pausar() { subscribed = false; clear(); if (!disposed) options.pendiente(); },
    cancelar() { disposed = true; clear(); },
  };
}
