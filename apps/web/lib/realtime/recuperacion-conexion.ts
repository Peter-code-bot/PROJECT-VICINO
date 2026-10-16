/** Reintentos acotados por incidente; solo una instantanea confirmada reinicia
 * el presupuesto. Un SUBSCRIBED por si solo no acredita la sincronizacion. */
export function recuperacionConexion(options: {
  reconectar: () => void;
  recuperar: () => void;
  pendiente: () => void;
  disponible: () => boolean;
  conexion?: (estado: "connecting" | "connected" | "pending") => void;
}) {
  let subscribed = false;
  let disposed = false;
  let attempts = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const clear = () => { clearTimeout(timer); timer = undefined; };
  const retry = () => {
    if (disposed || !options.disponible()) return;
    if (!subscribed) options.reconectar();
    // La lectura HTTP pertenece al montaje, no a la suscripcion WS.
    options.recuperar();
  };
  const schedule = (delay: number) => {
    if (disposed || timer || attempts >= 3 || !options.disponible()) return;
    timer = setTimeout(() => {
      timer = undefined;
      if (!options.disponible()) return;
      attempts++;
      if (!subscribed) options.conexion?.("pending");
      retry();
    }, delay);
  };
  return {
    esperando() {
      if (disposed) return;
      subscribed = false;
      clear();
      options.conexion?.("connecting");
      // Incluye el caso en que subscribe nunca entrega un estado.
      schedule(15_000);
    },
    estado(status: string) {
      if (disposed) return;
      // Un ACK duplicado no debe borrar un reintento HTTP ya programado.
      if (status === "SUBSCRIBED" && subscribed) return;
      const wasSubscribed = subscribed;
      subscribed = status === "SUBSCRIBED";
      clear();
      if (subscribed) {
        options.conexion?.("connected");
        if (!wasSubscribed) options.recuperar();
      }
      else {
        options.conexion?.("pending");
        schedule([1_000, 3_000, 10_000][attempts] ?? 10_000);
      }
    },
    falloConsulta() {
      if (disposed) return;
      options.pendiente();
      schedule([1_000, 3_000, 10_000][attempts] ?? 10_000);
    },
    // Un snapshot HTTP sano no acredita WS ni cancela sus reintentos.
    confirmada() { if (subscribed) { attempts = 0; clear(); } },
    reintentar() { clear(); attempts = 0; retry(); },
    pausar() { subscribed = false; clear(); if (!disposed) options.conexion?.("pending"); },
    cancelar() { disposed = true; clear(); },
  };
}
