import assert from "node:assert/strict";
import test from "node:test";
import {
  CODIGO_SERVICIOS_APAGADOS,
  ESTADO_PERMISO_INICIAL,
  leerPermisoUbicacion,
  observarPermisoUbicacion,
  pedirPermisoUbicacion,
  traducirErrorNativo,
  traducirPermisosNativos,
  traducirPermisoWeb,
  type DependenciasPermiso,
  type EntornoPermiso,
  type EstadoPermisoUbicacion,
  type PuenteApp,
  type PuenteGeolocalizacion,
} from "./permiso-ubicacion";

type Permisos = { location: string; coarseLocation: string };
const esperar = () => new Promise<void>((resolver) => setImmediate(resolver));

/** Doble del plugin nativo; cuenta las llamadas y permite colgarlas o hacerlas fallar. */
function pluginFalso(opciones: { permisos?: Permisos; error?: unknown; colgado?: boolean; alPedir?: Permisos } = {}) {
  const llamadas = { check: 0, request: [] as unknown[] };
  const geo = {
    checkPermissions: async () => {
      llamadas.check++;
      if (opciones.colgado) return new Promise<never>(() => {});
      if (opciones.error) throw opciones.error;
      return opciones.permisos ?? { location: "prompt", coarseLocation: "prompt" };
    },
    requestPermissions: async (pedido?: unknown) => {
      llamadas.request.push(pedido);
      if (opciones.error) throw opciones.error;
      return opciones.alPedir ?? opciones.permisos ?? { location: "granted", coarseLocation: "granted" };
    },
  };
  return { geo: geo as unknown as PuenteGeolocalizacion["geo"], llamadas };
}

function nativo(plugin: ReturnType<typeof pluginFalso>, extra: Partial<DependenciasPermiso> = {}): DependenciasPermiso & { cargas: () => number } {
  let cargas = 0;
  return {
    esNativo: () => true,
    pluginDisponible: () => true,
    plataforma: () => "android",
    cargarPlugin: async () => { cargas++; return { geo: plugin.geo }; },
    permisosWeb: () => { throw new Error("en nativo no se consulta navigator.permissions"); },
    geolocWeb: () => undefined,
    tiempoMaximoMs: 30,
    cargas: () => cargas,
    ...extra,
  };
}

/** Doble de navigator.permissions con un PermissionStatus que puede cambiar. */
function permisosWebFalsos(inicial: string) {
  const oyentes = new Set<() => void>();
  const estado = {
    state: inicial,
    addEventListener: (_tipo: string, fn: () => void) => { oyentes.add(fn); },
    removeEventListener: (_tipo: string, fn: () => void) => { oyentes.delete(fn); },
  };
  let consultas = 0;
  return {
    api: { query: async () => { consultas++; return estado as unknown as PermissionStatus; } } as Pick<Permissions, "query">,
    cambiar: (nuevo: string) => { estado.state = nuevo; oyentes.forEach((fn) => fn()); },
    oyentes,
    consultas: () => consultas,
  };
}

function web(extra: Partial<DependenciasPermiso> = {}): DependenciasPermiso {
  return {
    esNativo: () => false,
    // Tras importar @capacitor/geolocation en web, isPluginAvailable da true: no debe importar.
    pluginDisponible: () => true,
    plataforma: () => "web",
    cargarPlugin: async () => { throw new Error("en web no se carga el plugin"); },
    permisosWeb: () => undefined,
    geolocWeb: () => ({ getCurrentPosition: () => {} }),
    tiempoMaximoMs: 30,
    ...extra,
  };
}

test("Android: location concedido es precisa; solo coarseLocation, aproximada", () => {
  assert.deepEqual(traducirPermisosNativos({ location: "granted", coarseLocation: "granted" }, "android"), { estado: "concedido", precision: "precisa" });
  assert.deepEqual(traducirPermisosNativos({ location: "prompt", coarseLocation: "granted" }, "android"), { estado: "concedido", precision: "aproximada" });
  assert.deepEqual(traducirPermisosNativos({ location: "denied", coarseLocation: "denied" }, "android"), { estado: "denegado" });
  assert.deepEqual(traducirPermisosNativos({ location: "prompt-with-rationale", coarseLocation: "prompt-with-rationale" }, "android"), { estado: "sin-preguntar", yaNegoUnaVez: true });
  assert.deepEqual(traducirPermisosNativos({ location: "prompt", coarseLocation: "prompt" }, "android"), { estado: "sin-preguntar", yaNegoUnaVez: false });
});

test("iOS no expone la precisión: concedido con precisión desconocida", () => {
  assert.deepEqual(traducirPermisosNativos({ location: "granted", coarseLocation: "granted" }, "ios"), { estado: "concedido", precision: "desconocida" });
  assert.deepEqual(traducirPermisosNativos({ location: "denied", coarseLocation: "denied" }, "ios"), { estado: "denegado" });
});

test("respuestas del puente que no son estados conocidos: desconocido", () => {
  for (const respuesta of [null, undefined, "granted", {}, { location: "granted" }, { location: "si", coarseLocation: "si" }]) {
    assert.deepEqual(traducirPermisosNativos(respuesta, "android"), ESTADO_PERMISO_INICIAL, JSON.stringify(respuesta));
  }
});

test("servicios de ubicación apagados por código (o mensaje de respaldo); lo demás es error", () => {
  assert.deepEqual(traducirErrorNativo({ code: CODIGO_SERVICIOS_APAGADOS, message: "x" }), { estado: "servicios-apagados" });
  assert.deepEqual(traducirErrorNativo(new Error("Location services are not enabled.")), { estado: "servicios-apagados" });
  assert.deepEqual(traducirErrorNativo({ code: "OS-PLUG-GLOC-0003" }), { estado: "error" });
  assert.deepEqual(traducirErrorNativo("texto"), { estado: "error" });
});

test("web: granted, denied y prompt; cualquier otra cosa, desconocido", () => {
  assert.deepEqual(traducirPermisoWeb("granted"), { estado: "concedido", precision: "desconocida" });
  assert.deepEqual(traducirPermisoWeb("denied"), { estado: "denegado" });
  assert.deepEqual(traducirPermisoWeb("prompt"), { estado: "sin-preguntar", yaNegoUnaVez: false });
  assert.deepEqual(traducirPermisoWeb(undefined), ESTADO_PERMISO_INICIAL);
});

test("nativo con plugin: lee con checkPermissions, sin pedir nada", async () => {
  const plugin = pluginFalso({ permisos: { location: "prompt", coarseLocation: "granted" } });
  assert.deepEqual(await leerPermisoUbicacion(nativo(plugin)), { estado: "concedido", precision: "aproximada" });
  assert.equal(plugin.llamadas.check, 1);
  assert.equal(plugin.llamadas.request.length, 0);
});

test("nativo SIN plugin: desconocido, sin cargar nada ni consultar navigator.permissions", async () => {
  const plugin = pluginFalso();
  const deps = nativo(plugin, { pluginDisponible: () => false });
  assert.deepEqual(await leerPermisoUbicacion(deps), ESTADO_PERMISO_INICIAL);
  assert.equal(deps.cargas(), 0);
});

test("un puente colgado no deja la lectura pendiente: desconocido al vencer el plazo", async () => {
  const inicio = Date.now();
  assert.deepEqual(await leerPermisoUbicacion(nativo(pluginFalso({ colgado: true }))), ESTADO_PERMISO_INICIAL);
  assert.ok(Date.now() - inicio < 1000);
});

test("el plugin llega envuelto: un plugin «thenable» (Proxy de Capacitor) no cuelga la carga", async () => {
  const plugin = pluginFalso({ permisos: { location: "granted", coarseLocation: "granted" } });
  // Como los Proxy de Capacitor: responde a `then` y nunca llama de vuelta.
  Object.assign(plugin.geo, { then: () => {} });
  assert.deepEqual(await leerPermisoUbicacion(nativo(plugin, { tiempoMaximoMs: 1000 })), { estado: "concedido", precision: "precisa" });
});

test("nativo con servicios apagados: checkPermissions lanza 0007", async () => {
  const error = Object.assign(new Error("Location services are not enabled."), { code: CODIGO_SERVICIOS_APAGADOS });
  assert.deepEqual(await leerPermisoUbicacion(nativo(pluginFalso({ error }))), { estado: "servicios-apagados" });
});

test("web: Permissions API; sin ella desconocido; sin geolocalización no disponible; nunca carga el plugin", async () => {
  const permisos = permisosWebFalsos("denied");
  assert.deepEqual(await leerPermisoUbicacion(web({ permisosWeb: () => permisos.api })), { estado: "denegado" });
  assert.deepEqual(await leerPermisoUbicacion(web()), ESTADO_PERMISO_INICIAL);
  assert.deepEqual(await leerPermisoUbicacion(web({ geolocWeb: () => undefined })), { estado: "no-disponible" });
  const rota = { query: async () => { throw new TypeError("geolocation no soportado"); } } as Pick<Permissions, "query">;
  assert.deepEqual(await leerPermisoUbicacion(web({ permisosWeb: () => rota })), ESTADO_PERMISO_INICIAL);
});

test("pedir en nativo usa el alias location aunque la última lectura dijera denegado", async () => {
  const plugin = pluginFalso({ permisos: { location: "denied", coarseLocation: "denied" }, alPedir: { location: "granted", coarseLocation: "granted" } });
  const deps = nativo(plugin);
  assert.deepEqual(await leerPermisoUbicacion(deps), { estado: "denegado" });
  assert.deepEqual(await pedirPermisoUbicacion(deps), { estado: "concedido", precision: "precisa" });
  assert.deepEqual(plugin.llamadas.request, [{ permissions: ["location"] }]);
});

test("pedir en nativo con la ubicación del teléfono apagada", async () => {
  const error = { code: CODIGO_SERVICIOS_APAGADOS, message: "Location services are not enabled." };
  assert.deepEqual(await pedirPermisoUbicacion(nativo(pluginFalso({ error }))), { estado: "servicios-apagados" });
});

test("pedir en web: una petición de posición saca el diálogo, se descartan las coordenadas y se relee", async () => {
  const permisos = permisosWebFalsos("prompt");
  const opcionesVistas: unknown[] = [];
  const deps = web({
    permisosWeb: () => permisos.api,
    geolocWeb: () => ({
      getCurrentPosition: (exito: PositionCallback, _error?: PositionErrorCallback | null, opciones?: PositionOptions) => {
        opcionesVistas.push(opciones);
        permisos.cambiar("granted");
        exito({ coords: { latitude: 19.041, longitude: -98.206, accuracy: 20 } } as unknown as GeolocationPosition);
      },
    }),
  });
  const resultado = await pedirPermisoUbicacion(deps);
  assert.deepEqual(resultado, { estado: "concedido", precision: "desconocida" });
  assert.equal(JSON.stringify(resultado).includes("19.041"), false);
  assert.equal(permisos.consultas(), 1);
  assert.equal((opcionesVistas[0] as PositionOptions).enableHighAccuracy, false);
});

test("pedir en web sin Permissions API: se deduce de la respuesta a la petición", async () => {
  const conRespuesta = (respuesta: (exito: PositionCallback, error: PositionErrorCallback) => void) => web({
    geolocWeb: () => ({ getCurrentPosition: (exito: PositionCallback, error?: PositionErrorCallback | null) => respuesta(exito, error!) }),
  });
  const posicion = { coords: { latitude: 0, longitude: 0, accuracy: 1 } } as unknown as GeolocationPosition;
  const fallo = (code: number) => ({ code } as GeolocationPositionError);
  assert.deepEqual(await pedirPermisoUbicacion(conRespuesta((exito) => exito(posicion))), { estado: "concedido", precision: "desconocida" });
  assert.deepEqual(await pedirPermisoUbicacion(conRespuesta((_e, error) => error(fallo(1)))), { estado: "denegado" });
  assert.deepEqual(await pedirPermisoUbicacion(conRespuesta((_e, error) => error(fallo(3)))), ESTADO_PERMISO_INICIAL);
  assert.deepEqual(await pedirPermisoUbicacion(web({ geolocWeb: () => undefined })), { estado: "no-disponible" });
});

/** Entorno de observación con documento, App y reloj controlados por la prueba. */
function entornoObservable(base: DependenciasPermiso, opciones: { conApp?: boolean } = {}) {
  const oyentesDoc = new Map<string, Set<() => void>>();
  let visibilidad: DocumentVisibilityState = "visible";
  const documento = {
    get visibilityState() { return visibilidad; },
    addEventListener: (tipo: string, fn: () => void) => { if (!oyentesDoc.has(tipo)) oyentesDoc.set(tipo, new Set()); oyentesDoc.get(tipo)!.add(fn); },
    removeEventListener: (tipo: string, fn: () => void) => { oyentesDoc.get(tipo)?.delete(fn); },
  } as unknown as EntornoPermiso["documento"];
  const oyentesApp = new Set<(estado: { isActive: boolean }) => void>();
  let handlesQuitados = 0;
  const app = {
    addListener: async (_evento: string, fn: (estado: { isActive: boolean }) => void) => {
      oyentesApp.add(fn);
      return { remove: async () => { handlesQuitados++; oyentesApp.delete(fn); } };
    },
  } as unknown as PuenteApp["app"];
  let cola: Array<() => void> = [];
  const entorno: EntornoPermiso = {
    ...base,
    documento,
    cargarApp: async () => {
      if (opciones.conApp === false) throw new Error("sin App");
      return { app };
    },
    programar: (fn) => {
      cola = [...cola, fn];
      return () => { cola = cola.filter((otra) => otra !== fn); };
    },
  };
  return {
    entorno,
    disparar: (tipo: string) => oyentesDoc.get(tipo)?.forEach((fn) => fn()),
    ocultar: () => { visibilidad = "hidden"; },
    mostrar: () => { visibilidad = "visible"; },
    volverApp: (isActive: boolean) => oyentesApp.forEach((fn) => fn({ isActive })),
    /** Ejecuta las lecturas programadas y deja correr las promesas. */
    correr: async () => { const ahora = cola; cola = []; ahora.forEach((fn) => fn()); await esperar(); await esperar(); },
    pendientes: () => cola.length,
    oyentesDoc,
    oyentesApp,
    handlesQuitados: () => handlesQuitados,
  };
}

test("observar: lee al montar y vuelve a leer al volver (visibilitychange visible, 'resume', appStateChange activo)", async () => {
  const plugin = pluginFalso({ permisos: { location: "granted", coarseLocation: "granted" } });
  const h = entornoObservable(nativo(plugin));
  const vistos: EstadoPermisoUbicacion[] = [];
  const { detener: limpiar } = observarPermisoUbicacion(h.entorno, (estado) => vistos.push(estado));
  await h.correr();
  assert.equal(plugin.llamadas.check, 1);
  assert.deepEqual(vistos, [{ estado: "concedido", precision: "precisa" }]);

  h.ocultar(); h.disparar("visibilitychange"); h.volverApp(false);
  assert.equal(h.pendientes(), 0, "ocultarse o pasar a inactiva no relee");

  // Al volver llegan juntos: una sola lectura.
  h.mostrar(); h.disparar("visibilitychange"); h.disparar("resume"); h.volverApp(true);
  assert.equal(h.pendientes(), 1);
  await h.correr();
  assert.equal(plugin.llamadas.check, 2);
  assert.equal(plugin.llamadas.request.length, 0, "observar nunca pide el permiso");
  limpiar();
});

test("observar: una lectura vieja que termina tarde no pisa a la nueva", async () => {
  let respuestas: Array<(permisos: Permisos) => void> = [];
  const geo = {
    checkPermissions: () => new Promise<Permisos>((resolver) => { respuestas = [...respuestas, resolver]; }),
    requestPermissions: async () => ({ location: "granted", coarseLocation: "granted" }),
  } as unknown as PuenteGeolocalizacion["geo"];
  const h = entornoObservable(nativo({ geo, llamadas: { check: 0, request: [] } }, { tiempoMaximoMs: 1000 }));
  const vistos: EstadoPermisoUbicacion[] = [];
  const { detener: limpiar } = observarPermisoUbicacion(h.entorno, (estado) => vistos.push(estado));
  await h.correr(); // primera lectura en curso
  h.disparar("resume");
  await h.correr(); // segunda lectura en curso
  assert.equal(respuestas.length, 2);
  respuestas[1]!({ location: "denied", coarseLocation: "denied" });
  await esperar();
  respuestas[0]!({ location: "granted", coarseLocation: "granted" });
  await esperar(); await esperar();
  assert.deepEqual(vistos, [{ estado: "denegado" }]);
  limpiar();
});

test("observar en web: avisa del change del PermissionStatus y lo deja de escuchar al limpiar", async () => {
  const permisos = permisosWebFalsos("prompt");
  const h = entornoObservable(web({ permisosWeb: () => permisos.api }));
  const vistos: EstadoPermisoUbicacion[] = [];
  const { detener: limpiar } = observarPermisoUbicacion(h.entorno, (estado) => vistos.push(estado));
  await h.correr();
  assert.deepEqual(vistos, [{ estado: "sin-preguntar", yaNegoUnaVez: false }]);
  permisos.cambiar("denied");
  assert.deepEqual(vistos.at(-1), { estado: "denegado" });
  limpiar();
  assert.equal(permisos.oyentes.size, 0);
  permisos.cambiar("granted");
  assert.equal(vistos.length, 2);
});

test("limpiar quita los oyentes, el de App y la lectura programada; después no avisa nada", async () => {
  const plugin = pluginFalso();
  const h = entornoObservable(nativo(plugin));
  const vistos: EstadoPermisoUbicacion[] = [];
  const { detener: limpiar } = observarPermisoUbicacion(h.entorno, (estado) => vistos.push(estado));
  await esperar(); await esperar(); // se instala el oyente de App
  assert.equal(h.oyentesApp.size, 1);
  limpiar();
  assert.equal(h.pendientes(), 0);
  assert.equal(h.handlesQuitados(), 1);
  assert.equal(h.oyentesDoc.get("visibilitychange")?.size, 0);
  assert.equal(h.oyentesDoc.get("resume")?.size, 0);
  h.disparar("resume");
  await h.correr();
  assert.deepEqual(vistos, []);
  assert.equal(plugin.llamadas.check, 0);
});

test("si se limpia antes de que App termine de instalarse, el oyente se quita al llegar", async () => {
  const h = entornoObservable(nativo(pluginFalso()));
  const { detener: limpiar } = observarPermisoUbicacion(h.entorno, () => {});
  limpiar();
  await esperar(); await esperar();
  assert.equal(h.oyentesApp.size, 0);
});

test("sin el plugin App siguen valiendo visibilitychange y 'resume'", async () => {
  const plugin = pluginFalso();
  const h = entornoObservable(nativo(plugin), { conApp: false });
  const { detener: limpiar } = observarPermisoUbicacion(h.entorno, () => {});
  await h.correr();
  h.disparar("resume");
  await h.correr();
  assert.equal(plugin.llamadas.check, 2);
  limpiar();
});

test("anotar (la respuesta de pedir) gana a una relectura que ya estaba en curso", async () => {
  let responder: ((permisos: Permisos) => void) | undefined;
  const geo = {
    checkPermissions: () => new Promise<Permisos>((resolver) => { responder = resolver; }),
    requestPermissions: async () => ({ location: "granted", coarseLocation: "granted" }),
  } as unknown as PuenteGeolocalizacion["geo"];
  const h = entornoObservable(nativo({ geo, llamadas: { check: 0, request: [] } }, { tiempoMaximoMs: 1000 }));
  const vistos: EstadoPermisoUbicacion[] = [];
  const observador = observarPermisoUbicacion(h.entorno, (estado) => vistos.push(estado));
  await h.correr(); // lectura en curso con el estado de antes del diálogo
  observador.anotar({ estado: "concedido", precision: "precisa" });
  responder!({ location: "prompt", coarseLocation: "prompt" });
  await esperar(); await esperar();
  assert.deepEqual(vistos, [{ estado: "concedido", precision: "precisa" }]);
  observador.detener();
  observador.anotar({ estado: "denegado" });
  assert.equal(vistos.length, 1, "detenido no avisa");
});
