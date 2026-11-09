import assert from "node:assert/strict";
import test from "node:test";
import {
  agruparEnlacesNegocio,
  listarEnlacesNegocio,
  normalizarFacebook,
  normalizarLinkedIn,
  normalizarPinterest,
  normalizarTelegram,
  normalizarThreads,
  normalizarTikTok,
  normalizarX,
  normalizarYouTube,
  redesNegocioSchema,
  tieneEnlacesNegocio,
  urlFacebook,
  urlLinkedIn,
  urlMessenger,
  urlYouTube,
  type ResultadoRed,
} from "@vicino/shared";
import { cargaDentroDelWebView } from "./abrir-enlace-externo";

// Redes sociales del negocio (20261108230000). Cada red: usuario suelto, con @,
// URL completa con parametros de rastreo, host viejo, enlace corto, otro sitio.

const vale = (valor: string): ResultadoRed => ({ ok: true, valor });
const no = (motivo: "formato" | "otro_sitio" | "enlace_corto" | "no_es_perfil"): ResultadoRed => ({ ok: false, motivo });

test("Facebook: usuario en minusculas, ID numerico como profile.php y share/ rechazado", () => {
  assert.deepEqual(normalizarFacebook("MiTienda.Puebla"), vale("mitienda.puebla"));
  assert.deepEqual(normalizarFacebook("@mitienda"), vale("mitienda"));
  assert.deepEqual(normalizarFacebook("https://www.facebook.com/MiTienda/?mibextid=ZbWKwL&rdid=abc"), vale("mitienda"));
  assert.deepEqual(normalizarFacebook("m.facebook.com/mitienda"), vale("mitienda"));
  assert.deepEqual(normalizarFacebook("es-la.facebook.com/mitienda"), vale("mitienda"));
  assert.deepEqual(normalizarFacebook("fb.com/mitienda"), vale("mitienda"));
  assert.deepEqual(normalizarFacebook("https://www.facebook.com/profile.php?id=61550000000000"), vale("profile.php?id=61550000000000"));
  assert.deepEqual(normalizarFacebook("https://www.facebook.com/people/Mi-Tienda/61550000000000/"), vale("profile.php?id=61550000000000"));
  assert.deepEqual(normalizarFacebook("61550000000000"), vale("profile.php?id=61550000000000"));
  assert.deepEqual(normalizarFacebook("https://www.facebook.com/share/1AbCdEfGh/"), no("no_es_perfil"));
  assert.deepEqual(normalizarFacebook("facebook.com/groups/vecinos"), no("no_es_perfil"));
  assert.deepEqual(normalizarFacebook("fb.me/mitienda"), no("enlace_corto"));
  assert.deepEqual(normalizarFacebook("https://evil.com/mitienda"), no("otro_sitio"));
  assert.deepEqual(normalizarFacebook("facebook.com.evil.com/mitienda"), no("otro_sitio"));
  assert.deepEqual(normalizarFacebook("abc"), no("formato")); // menos de 5
  assert.deepEqual(normalizarFacebook("mi tienda"), no("formato"));
  assert.deepEqual(normalizarFacebook("javascript:alert(1)"), no("formato"));
  assert.deepEqual(normalizarFacebook("https://usuario:clave@facebook.com/mitienda"), no("formato"));
  assert.equal(urlFacebook("mitienda"), "https://www.facebook.com/mitienda");
  assert.equal(urlFacebook("profile.php?id=61550000000000"), "https://www.facebook.com/profile.php?id=61550000000000");
  assert.equal(urlMessenger("mitienda", "Hola"), "https://m.me/mitienda?text=Hola");
});

test("TikTok: usuario tal cual, sin punto final; enlaces cortos y videos rechazados", () => {
  assert.deepEqual(normalizarTikTok("@Mi.Tienda"), vale("Mi.Tienda"));
  assert.deepEqual(normalizarTikTok("https://www.tiktok.com/@mi.tienda?_t=8abc&_r=1"), vale("mi.tienda"));
  assert.deepEqual(normalizarTikTok("m.tiktok.com/@mi_tienda"), vale("mi_tienda"));
  assert.deepEqual(normalizarTikTok("https://vm.tiktok.com/ZMabc123/"), no("enlace_corto"));
  assert.deepEqual(normalizarTikTok("https://vt.tiktok.com/ZSabc/"), no("enlace_corto"));
  assert.deepEqual(normalizarTikTok("https://www.tiktok.com/t/ZTabc/"), no("enlace_corto"));
  assert.deepEqual(normalizarTikTok("https://www.tiktok.com/video/123"), no("no_es_perfil"));
  assert.deepEqual(normalizarTikTok("instagram.com/@mitienda"), no("otro_sitio"));
  assert.deepEqual(normalizarTikTok("mitienda."), no("formato"));
  assert.deepEqual(normalizarTikTok("a"), no("formato"));
  assert.deepEqual(normalizarTikTok("x".repeat(25)), no("formato"));
});

test("YouTube: @handle en minusculas (tambien con acentos), channel/UC y videos rechazados", () => {
  assert.deepEqual(normalizarYouTube("@MiCanal"), vale("@micanal"));
  assert.deepEqual(normalizarYouTube("micanal"), vale("@micanal"));
  assert.deepEqual(normalizarYouTube("https://www.youtube.com/@MiCanal?si=abc123"), vale("@micanal"));
  assert.deepEqual(normalizarYouTube("m.youtube.com/@micanal/videos"), vale("@micanal"));
  assert.deepEqual(normalizarYouTube("https://www.youtube.com/@Panader%C3%ADaLaEsquina"), vale("@panaderíalaesquina"));
  assert.deepEqual(normalizarYouTube("@Panadería.Puebla"), vale("@panadería.puebla"));
  const canal = "UC" + "a".repeat(22);
  assert.deepEqual(normalizarYouTube(`https://www.youtube.com/channel/${canal}`), vale(`channel/${canal}`));
  assert.deepEqual(normalizarYouTube(canal), vale(`channel/${canal}`));
  assert.deepEqual(normalizarYouTube("https://youtu.be/dQw4w9WgXcQ"), no("no_es_perfil"));
  assert.deepEqual(normalizarYouTube("https://www.youtube.com/watch?v=dQw4w9WgXcQ"), no("no_es_perfil"));
  assert.deepEqual(normalizarYouTube("https://www.youtube.com/c/MiCanal"), no("no_es_perfil"));
  assert.deepEqual(normalizarYouTube("vimeo.com/@micanal"), no("otro_sitio"));
  assert.deepEqual(normalizarYouTube("@ab"), no("formato"));
  assert.deepEqual(normalizarYouTube("@_micanal"), no("formato"));
  assert.deepEqual(normalizarYouTube("@mi canal"), no("formato"));
  assert.deepEqual(normalizarYouTube("@" + "a".repeat(31)), no("formato"));
  assert.equal(urlYouTube("@panaderíalaesquina"), "https://www.youtube.com/@panader%C3%ADalaesquina");
  assert.equal(urlYouTube(`channel/${canal}`), `https://www.youtube.com/channel/${canal}`);
});

test("X: x.com y twitter.com, hasta 15, sin rutas que no son perfil", () => {
  assert.deepEqual(normalizarX("@MiTienda"), vale("MiTienda"));
  assert.deepEqual(normalizarX("https://twitter.com/MiTienda?s=21&t=abc"), vale("MiTienda"));
  assert.deepEqual(normalizarX("mobile.twitter.com/mitienda"), vale("mitienda"));
  assert.deepEqual(normalizarX("x.com/mitienda/status/123"), vale("mitienda"));
  assert.deepEqual(normalizarX("x.com/home"), no("no_es_perfil"));
  assert.deepEqual(normalizarX("x.com/i/flow/login"), no("no_es_perfil"));
  assert.deepEqual(normalizarX("threads.com/@mitienda"), no("otro_sitio"));
  assert.deepEqual(normalizarX("mi.tienda"), no("formato"));
  assert.deepEqual(normalizarX("a".repeat(16)), no("formato"));
});

test("LinkedIn: perfil y pagina de empresa, con el tipo; lnkd.in y nombres sueltos rechazados", () => {
  assert.deepEqual(normalizarLinkedIn("https://www.linkedin.com/company/Mi-Tienda/?utm_source=share"), vale("company/mi-tienda"));
  assert.deepEqual(normalizarLinkedIn("mx.linkedin.com/in/ana-perez-123"), vale("in/ana-perez-123"));
  assert.deepEqual(normalizarLinkedIn("linkedin.com/company/hp"), vale("company/hp"));
  assert.deepEqual(normalizarLinkedIn("in/ana-perez"), vale("in/ana-perez"));
  assert.deepEqual(normalizarLinkedIn("company/mi-tienda"), vale("company/mi-tienda"));
  assert.deepEqual(normalizarLinkedIn("https://lnkd.in/abc"), no("enlace_corto"));
  assert.deepEqual(normalizarLinkedIn("linkedin.com/school/anahuac"), no("no_es_perfil"));
  assert.deepEqual(normalizarLinkedIn("mi-tienda"), no("formato"));
  assert.deepEqual(normalizarLinkedIn("linkedin.com/in/ab"), no("formato"));
  assert.deepEqual(normalizarLinkedIn("evil.com/in/ana"), no("otro_sitio"));
  assert.equal(urlLinkedIn("company/mi-tienda"), "https://www.linkedin.com/company/mi-tienda/");
  assert.equal(urlLinkedIn("in/ana-perez"), "https://www.linkedin.com/in/ana-perez/");
});

test("Threads: threads.com y threads.net, reglas de Instagram, minusculas", () => {
  assert.deepEqual(normalizarThreads("@Mi.Tienda"), vale("mi.tienda"));
  assert.deepEqual(normalizarThreads("https://www.threads.net/@mi.tienda"), vale("mi.tienda"));
  assert.deepEqual(normalizarThreads("threads.com/@mi_tienda?xmt=abc"), vale("mi_tienda"));
  assert.deepEqual(normalizarThreads("threads.com/mi_tienda"), no("no_es_perfil"));
  assert.deepEqual(normalizarThreads("mi..tienda"), no("formato"));
  assert.deepEqual(normalizarThreads("mitienda."), no("formato"));
});

test("Pinterest y Telegram", () => {
  assert.deepEqual(normalizarPinterest("MiTienda"), vale("MiTienda"));
  assert.deepEqual(normalizarPinterest("https://mx.pinterest.com/mitienda/"), vale("mitienda"));
  assert.deepEqual(normalizarPinterest("pinterest.com.mx/mitienda"), vale("mitienda"));
  assert.deepEqual(normalizarPinterest("https://pin.it/abc"), no("enlace_corto"));
  assert.deepEqual(normalizarPinterest("pinterest.com/pin/123"), no("no_es_perfil"));
  assert.deepEqual(normalizarPinterest("12345"), no("formato"));
  assert.deepEqual(normalizarTelegram("@MiTienda_Pue"), vale("mitienda_pue"));
  assert.deepEqual(normalizarTelegram("https://t.me/mitienda"), vale("mitienda"));
  assert.deepEqual(normalizarTelegram("telegram.me/mitienda"), vale("mitienda"));
  assert.deepEqual(normalizarTelegram("https://t.me/+AbCdEf123"), no("no_es_perfil"));
  assert.deepEqual(normalizarTelegram("t.me/joinchat/abc"), no("no_es_perfil"));
  assert.deepEqual(normalizarTelegram("abcd"), no("formato"));
});

test("listarEnlacesNegocio: Messenger solo con usuario de Facebook, contacto antes que redes", () => {
  const base = {
    whatsapp_numero: "522221234567",
    facebook_ruta: "mitienda",
    facebook_messenger: true,
    tiktok_usuario: "mi.tienda",
    linkedin_ruta: "company/mi-tienda",
  };
  assert.deepEqual(
    listarEnlacesNegocio(base, { incluirResenas: false }).map((e) => `${e.grupo}:${e.canal}`),
    ["contacto:whatsapp", "contacto:messenger", "redes:facebook", "redes:tiktok", "redes:linkedin"],
  );
  const conId = listarEnlacesNegocio({ ...base, facebook_ruta: "profile.php?id=61550000000000" }, { incluirResenas: false });
  assert.ok(!conId.some((e) => e.canal === "messenger"));
  assert.equal(conId.find((e) => e.canal === "facebook")?.href, "https://www.facebook.com/profile.php?id=61550000000000");
  const messenger = listarEnlacesNegocio(base, { incluirResenas: false, urlPerfil: "https://vicinomarket.com/vendedor/x" })
    .find((e) => e.canal === "messenger");
  assert.match(messenger?.href ?? "", /^https:\/\/m\.me\/mitienda\?text=Hola%2C%20vi%20tu%20negocio/);
  assert.equal(tieneEnlacesNegocio({ telegram_usuario: "mitienda" }), true);
  assert.equal(tieneEnlacesNegocio({ facebook_messenger: true }), false);
});

test("agruparEnlacesNegocio: con 4 chips o mas, las redes van en un solo desplegable", () => {
  const lista = (canales: string[]) =>
    listarEnlacesNegocio(
      Object.fromEntries(canales.map((c) => [c, c === "whatsapp_numero" ? "522221234567" : c === "linkedin_ruta" ? "company/mi-tienda" : "mitienda"])),
      { incluirResenas: false },
    );
  // 3 chips: todo a la vista.
  const tres = agruparEnlacesNegocio(lista(["whatsapp_numero", "instagram_usuario", "tiktok_usuario"]));
  assert.equal(tres.redesPlegadas, null);
  assert.equal(tres.visibles.length, 3);
  // 4 chips con 3 redes: WhatsApp a la vista y las tres redes plegadas.
  const cuatro = agruparEnlacesNegocio(lista(["whatsapp_numero", "instagram_usuario", "tiktok_usuario", "x_usuario"]));
  assert.deepEqual(cuatro.visibles.map((e) => e.canal), ["whatsapp"]);
  assert.deepEqual(cuatro.redesPlegadas?.map((e) => e.canal), ["instagram", "tiktok", "x"]);
  // Solo redes, 4 o mas: todas plegadas, ningun chip suelto.
  const soloRedes = agruparEnlacesNegocio(lista(["instagram_usuario", "tiktok_usuario", "x_usuario", "linkedin_ruta"]));
  assert.equal(soloRedes.visibles.length, 0);
  assert.equal(soloRedes.redesPlegadas?.length, 4);
  // Una sola red con mucho contacto: no se pliega (un desplegable de uno no ayuda).
  const unaRed = agruparEnlacesNegocio([
    ...lista(["whatsapp_numero", "instagram_usuario"]),
    { canal: "google_maps", href: "https://maps.app.goo.gl/x", etiqueta: "Google Maps", grupo: "contacto" },
    { canal: "google_resenas", href: "https://g.page/r/x/review", etiqueta: "Reseña en Google", grupo: "contacto" },
  ]);
  assert.equal(unaRed.redesPlegadas, null);
});

test("redesNegocioSchema: claves que no vienen no aparecen; Messenger exige usuario de Facebook", () => {
  const ok = redesNegocioSchema.safeParse({ tiktok_usuario: "@mi.tienda", facebook_ruta: "MiTienda", facebook_messenger: true });
  assert.equal(ok.success, true);
  if (ok.success) {
    assert.equal(ok.data.tiktok_usuario, "mi.tienda");
    assert.equal(ok.data.facebook_ruta, "mitienda");
    assert.equal(ok.data.facebook_messenger, true);
  }
  const sinFacebook = redesNegocioSchema.safeParse({ facebook_ruta: "", facebook_messenger: true });
  assert.equal(sinFacebook.success, false);
  if (!sinFacebook.success) assert.deepEqual(sinFacebook.error.issues[0]?.path, ["facebook_messenger"]);
  const corto = redesNegocioSchema.safeParse({ tiktok_usuario: "https://vm.tiktok.com/ZMabc/" });
  assert.equal(corto.success, false);
  if (!corto.success) assert.match(corto.error.issues[0]?.message ?? "", /enlace corto/);
});

test("ninguna red nueva se queda dentro del WebView de Android", () => {
  for (const href of [
    urlFacebook("mitienda"),
    urlMessenger("mitienda"),
    "https://www.tiktok.com/@mitienda",
    urlYouTube("@micanal"),
    "https://x.com/mitienda",
    urlLinkedIn("company/mi-tienda"),
    "https://www.threads.com/@mitienda",
    "https://www.pinterest.com/mitienda/",
    "https://t.me/mitienda",
  ]) {
    assert.equal(cargaDentroDelWebView(href, "android"), false, href);
  }
});

test("lo guardado vuelve del formulario tal cual y pasa (ida y vuelta de las nueve redes)", () => {
  const canal = "UC" + "a".repeat(22);
  const casos: Array<[(v: string) => ResultadoRed, string]> = [
    [normalizarFacebook, "mitienda.puebla"],
    [normalizarFacebook, "profile.php?id=61550000000000"],
    [normalizarTikTok, "Mi.Tienda"],
    [normalizarYouTube, "@panaderíalaesquina"],
    [normalizarYouTube, `channel/${canal}`],
    [normalizarX, "MiTienda"],
    [normalizarLinkedIn, "company/mi-tienda"],
    [normalizarLinkedIn, "in/ana-perez-123"],
    [normalizarThreads, "mi.tienda"],
    [normalizarPinterest, "MiTienda"],
    [normalizarTelegram, "mitienda_pue"],
  ];
  for (const [normalizar, guardado] of casos) {
    assert.deepEqual(normalizar(guardado), vale(guardado), guardado);
  }
  const conId = redesNegocioSchema.safeParse({ facebook_ruta: "profile.php?id=61550000000000", youtube_ruta: `channel/${canal}` });
  assert.equal(conId.success, true);
});

test("Facebook: forma vieja nombre-ID, punto final del host y paginas .php", () => {
  assert.deepEqual(normalizarFacebook("https://www.facebook.com/Mi-Tienda-61550000000000/"), vale("profile.php?id=61550000000000"));
  assert.deepEqual(normalizarFacebook("https://facebook.com./mitienda"), vale("mitienda"));
  assert.deepEqual(normalizarFacebook("profile.php"), no("no_es_perfil"));
  assert.deepEqual(normalizarFacebook("login.php"), no("no_es_perfil"));
  assert.deepEqual(normalizarFacebook("marketplace"), no("no_es_perfil"));
  assert.deepEqual(normalizarPinterest("https://www.pinterest.es/mitienda/"), vale("mitienda"));
  assert.deepEqual(normalizarLinkedIn("linkedin.com/in/---"), no("formato"));
});

test("redesNegocioSchema: Messenger con ID numerico o sin Facebook no pasa; sin la casilla no se exige nada", () => {
  for (const facebook_ruta of ["profile.php?id=61550000000000", "", null]) {
    const r = redesNegocioSchema.safeParse({ facebook_ruta, facebook_messenger: true });
    assert.equal(r.success, false, String(facebook_ruta));
  }
  assert.equal(redesNegocioSchema.safeParse({ facebook_ruta: "profile.php?id=61550000000000", facebook_messenger: false }).success, true);
  assert.equal(redesNegocioSchema.safeParse({ facebook_ruta: "profile.php?id=61550000000000" }).success, true);
});
