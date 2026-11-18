import assert from "node:assert/strict";
import test from "node:test";
import {
  enlacesNegocioSchema,
  listarEnlacesNegocio,
  normalizarNumeroWhatsApp,
  normalizarUrlGoogleMaps,
  normalizarUrlResenasGoogle,
  normalizarUsuarioInstagram,
  tieneEnlacesNegocio,
  TEXTO_WHATSAPP_DESDE_VICINO,
  urlInstagram,
  urlWhatsApp,
} from "@vicino/shared";
import { desglosarWhatsApp, digitosWhatsApp, mostrarWhatsApp } from "./telefono-whatsapp";
import { urlPerfilVendedor } from "../navigation/url-perfil-vendedor";
import { loginPara } from "../auth/acceso-invitado";

test("El número de México se guarda con +52 separado y se muestra agrupado por región", () => {
  const nuevo = desglosarWhatsApp("");
  assert.deepEqual(nuevo, { pais: "MX", nacional: "" });
  assert.equal(digitosWhatsApp(nuevo), "");
  const puebla = { ...nuevo, nacional: "2221234567" };
  assert.equal(mostrarWhatsApp(puebla), "222 123 4567");
  assert.equal(digitosWhatsApp(puebla), "522221234567");
  assert.equal(mostrarWhatsApp(desglosarWhatsApp("525512345678")), "55 1234 5678");
});

test("Un número internacional guardado recupera su país y admite el prefijo local de Reino Unido", () => {
  assert.deepEqual(desglosarWhatsApp("34612345678"), { pais: "ES", nacional: "612345678" });
  assert.equal(digitosWhatsApp({ pais: "GB", nacional: "02079460000" }), "442079460000");
  assert.equal(digitosWhatsApp(desglosarWhatsApp("80012345678")), "80012345678");
});

test("El mensaje de WhatsApp lleva la ficha del vendedor, y el inicio de sesión conserva ese destino", () => {
  const id = "00000000-0000-4000-8000-000000000001";
  const perfil = urlPerfilVendedor(id);
  const [whatsapp] = listarEnlacesNegocio({ whatsapp_numero: "522221234567" }, {
    incluirResenas: false,
    urlPerfil: perfil,
  });
  assert.ok(whatsapp);
  const enlace = new URL(whatsapp.href);
  assert.equal(enlace.origin, "https://wa.me");
  assert.equal(enlace.searchParams.get("text"), `${TEXTO_WHATSAPP_DESDE_VICINO}\n\n${perfil}`);
  const ruta = new URL(perfil).pathname;
  assert.equal(ruta, `/vendedor/${id}`);
  assert.equal(new URL(loginPara(ruta), perfil).searchParams.get("next"), ruta);
});

// Las pruebas van en apps/web y no en packages/shared porque la suite que se
// corre antes de cada push es `node --import tsx --test $(git ls-files '*.test.ts')`
// desde apps/web: lo que viva fuera no se ejecuta.

test("Instagram: acepta @, URL completa y mayusculas; guarda solo el usuario en minusculas", () => {
  assert.equal(normalizarUsuarioInstagram("@Mi.Tienda"), "mi.tienda");
  assert.equal(normalizarUsuarioInstagram("https://www.instagram.com/Mi_Tienda/?igsh=abc"), "mi_tienda");
  assert.equal(normalizarUsuarioInstagram("instagram.com/mi.tienda.puebla"), "mi.tienda.puebla");
  assert.equal(normalizarUsuarioInstagram("  mitienda  "), "mitienda");
});

test("Instagram: rechaza vacio, punto final, puntos seguidos, espacios, mas de 30 y otros dominios", () => {
  assert.equal(normalizarUsuarioInstagram(""), null);
  assert.equal(normalizarUsuarioInstagram("@"), null);
  assert.equal(normalizarUsuarioInstagram("mi.tienda."), null);
  assert.equal(normalizarUsuarioInstagram("mi..tienda"), null);
  assert.equal(normalizarUsuarioInstagram("mi tienda"), null);
  assert.equal(normalizarUsuarioInstagram("a".repeat(31)), null);
  assert.equal(normalizarUsuarioInstagram("https://tiktok.com/@mitienda"), null);
  assert.equal(normalizarUsuarioInstagram("javascript:alert(1)"), null);
});

test("WhatsApp: limpia +, espacios, parentesis, guiones, 00 y la URL de wa.me", () => {
  assert.equal(normalizarNumeroWhatsApp("+52 (222) 123-4567"), "522221234567");
  assert.equal(normalizarNumeroWhatsApp("52 222 123 4567"), "522221234567");
  assert.equal(normalizarNumeroWhatsApp("00522221234567"), "522221234567");
  assert.equal(normalizarNumeroWhatsApp("https://wa.me/522221234567"), "522221234567");
  assert.equal(normalizarNumeroWhatsApp("wa.me/+52 222 123 4567"), "522221234567");
  assert.equal(normalizarNumeroWhatsApp("https://api.whatsapp.com/send?phone=522221234567"), "522221234567");
});

test("WhatsApp: rechaza letras, menos de 11 digitos, mas de 15 y cero inicial", () => {
  assert.equal(normalizarNumeroWhatsApp("222 123 45 67 ext 2"), null);
  assert.equal(normalizarNumeroWhatsApp("123456789"), null);
  assert.equal(normalizarNumeroWhatsApp("1234567890123456"), null);
  assert.equal(normalizarNumeroWhatsApp("0122212345678"), null);
  assert.equal(normalizarNumeroWhatsApp(""), null);
});

test("WhatsApp: un numero local de 10 digitos se RECHAZA, no se le inventa la lada", () => {
  // El error mas comun en Mexico: pegar el numero tal como se marca aqui.
  // Ni pasa (seria un chat inexistente o ajeno) ni se le antepone 52 (seria
  // inventar un dato): se rechaza y el formulario pide la lada.
  assert.equal(normalizarNumeroWhatsApp("2221234567"), null);
  assert.equal(normalizarNumeroWhatsApp("222 123 4567"), null);
  // Con lada si: Mexico (12), Estados Unidos (11), Espana (11).
  assert.equal(normalizarNumeroWhatsApp("52 222 123 4567"), "522221234567");
  assert.equal(normalizarNumeroWhatsApp("+1 212 555 1234"), "12125551234");
  assert.equal(normalizarNumeroWhatsApp("+34 612 345 678"), "34612345678");
});

test("Google Maps: acepta las formas que copia la app, pone https y rechaza otros dominios", () => {
  assert.equal(normalizarUrlGoogleMaps("https://maps.app.goo.gl/AbC123"), "https://maps.app.goo.gl/AbC123");
  assert.equal(normalizarUrlGoogleMaps("maps.app.goo.gl/AbC123"), "https://maps.app.goo.gl/AbC123");
  assert.equal(
    normalizarUrlGoogleMaps("http://www.google.com/maps/place/Caf%C3%A9/@19.04,-98.2,17z"),
    "https://www.google.com/maps/place/Caf%C3%A9/@19.04,-98.2,17z",
  );
  assert.equal(
    normalizarUrlGoogleMaps("https://www.google.com.mx/maps/search/?api=1&query=Cafe+Puebla"),
    "https://www.google.com.mx/maps/search/?api=1&query=Cafe+Puebla",
  );
  assert.equal(normalizarUrlGoogleMaps("https://goo.gl/maps/xyz"), "https://goo.gl/maps/xyz");
  assert.equal(normalizarUrlGoogleMaps("https://g.page/mi-tienda"), "https://g.page/mi-tienda");
  assert.equal(normalizarUrlGoogleMaps("https://maps.google.com/?q=19.04,-98.2"), "https://maps.google.com/?q=19.04,-98.2");

  assert.equal(normalizarUrlGoogleMaps("https://evil.com/maps.app.goo.gl/x"), null);
  assert.equal(normalizarUrlGoogleMaps("https://www.google.com/search?q=mapa"), null);
  assert.equal(normalizarUrlGoogleMaps("https://maps.app.goo.gl.evil.com/x"), null);
  assert.equal(normalizarUrlGoogleMaps("https://maps.app.goo.gl/con espacio"), null);
  assert.equal(normalizarUrlGoogleMaps("javascript:alert(1)"), null);
  assert.equal(normalizarUrlGoogleMaps(`https://maps.app.goo.gl/${"a".repeat(500)}`), null);
});

test("Google Maps: lista cerrada de hosts, host en minusculas y sin segmentos '..'", () => {
  // google.xyz no es Google aunque parezca: solo google.com y google.com.mx.
  assert.equal(normalizarUrlGoogleMaps("https://www.google.xyz/maps/place/x"), null);
  assert.equal(normalizarUrlGoogleMaps("https://www.google.es/maps/place/x"), null);
  assert.equal(normalizarUrlGoogleMaps("https://maps.google.com/?q=19.04,-98.2"), "https://maps.google.com/?q=19.04,-98.2");
  assert.equal(normalizarUrlGoogleMaps("https://maps.google.com.mx/?q=x"), "https://maps.google.com.mx/?q=x");
  // El esquema y el host no distinguen mayusculas; la ruta se respeta tal cual.
  assert.equal(normalizarUrlGoogleMaps("HTTPS://Maps.App.Goo.Gl/AbC123"), "https://maps.app.goo.gl/AbC123");
  assert.equal(
    normalizarUrlGoogleMaps("WWW.GOOGLE.COM/maps/place/CaFe"),
    "https://www.google.com/maps/place/CaFe",
  );
  // Un ".." despues de /maps/ sacaria al navegador de Maps (google.com/url?q=...).
  assert.equal(normalizarUrlGoogleMaps("https://www.google.com/maps/../url?q=https://evil.com"), null);
  assert.equal(normalizarUrlGoogleMaps("https://www.google.com/maps/%2e%2e/url?q=https://evil.com"), null);
  assert.equal(normalizarUrlGoogleMaps("https://www.google.com/maps/%2E%2E/url"), null);
  assert.equal(normalizarUrlGoogleMaps("https://www.google.com/maps/./url"), null);
  assert.equal(normalizarUrlGoogleMaps("https://www.google.com/maps\\..\\url"), null);
  assert.equal(normalizarUrlGoogleMaps("https://g.page/x/../y"), null);
  // Las resenas tambien rechazan rutas raras aunque el patron estricto ya las cortara.
  assert.equal(normalizarUrlResenasGoogle("https://g.page/r/../review"), null);
  assert.equal(normalizarUrlResenasGoogle("HTTPS://G.PAGE/r/CaBc/review"), "https://g.page/r/CaBc/review");
});

test("URLs: controles y espacios Unicode se rechazan con la misma lista que Postgres", () => {
  // `\s` de JavaScript no incluye U+0085 y el de Postgres depende del locale:
  // por eso la lista es explicita en los dos lados.
  assert.equal(normalizarUrlGoogleMaps("https://www.google.com/maps/place/x\u0085y"), null);
  assert.equal(normalizarUrlGoogleMaps("https://www.google.com/maps/place/x\u0000y"), null);
  assert.equal(normalizarUrlGoogleMaps("https://www.google.com/maps/place/x\u00A0y"), null);
  assert.equal(normalizarUrlGoogleMaps("https://www.google.com/maps/place/x\u200By"), null);
  assert.equal(normalizarUrlGoogleMaps("https://www.google.com/maps/place/x\u2028y"), null);
  assert.equal(normalizarUrlGoogleMaps("https://www.google.com/maps/place/x\uFEFFy"), null);
  assert.equal(normalizarUrlGoogleMaps("https://www.google.com/maps/place/x\ty"), null);
  assert.equal(normalizarUrlGoogleMaps("https://www.google.com/maps/place/x\u007fy"), null);
  // Lo que si es texto normal de una URL de Maps pasa: acentos y emoji en la ruta.
  assert.equal(
    normalizarUrlGoogleMaps("https://www.google.com/maps/place/Café+Ñ/@19.04,-98.2,17z"),
    "https://www.google.com/maps/place/Café+Ñ/@19.04,-98.2,17z",
  );
  assert.equal(normalizarUrlResenasGoogle("https://g.page/r/CaBc/review\u0085"), null);
});

test("Resenas de Google: solo las dos formas oficiales", () => {
  assert.equal(normalizarUrlResenasGoogle("https://g.page/r/CaBcDeF123/review"), "https://g.page/r/CaBcDeF123/review");
  assert.equal(normalizarUrlResenasGoogle("g.page/r/CaBcDeF123/review/"), "https://g.page/r/CaBcDeF123/review/");
  assert.equal(
    normalizarUrlResenasGoogle("https://search.google.com/local/writereview?placeid=ChIJN1t_tDeuEmsRUsoyG83frY4"),
    "https://search.google.com/local/writereview?placeid=ChIJN1t_tDeuEmsRUsoyG83frY4",
  );
  assert.equal(normalizarUrlResenasGoogle("https://g.page/r/CaBcDeF123"), null);
  assert.equal(normalizarUrlResenasGoogle("https://maps.app.goo.gl/AbC123"), null);
  assert.equal(normalizarUrlResenasGoogle("https://g.page/r/CaBc/review?utm=x"), null);
  assert.equal(normalizarUrlResenasGoogle("https://search.google.com/local/writereview?placeid=<script>"), null);
});

test("las URL que se abren siguen el formato de cada proveedor", () => {
  assert.equal(urlInstagram("mi.tienda"), "https://www.instagram.com/mi.tienda/");
  assert.equal(
    urlWhatsApp("522221234567"),
    `https://wa.me/522221234567?text=${encodeURIComponent(TEXTO_WHATSAPP_DESDE_VICINO)}`,
  );
  assert.equal(urlWhatsApp("522221234567", ""), "https://wa.me/522221234567");
  assert.ok(!urlWhatsApp("522221234567").includes("+"));
});

test("listarEnlacesNegocio: contacto primero, luego redes; la resena solo cuando se pide", () => {
  const enlaces = {
    instagram_usuario: "mi.tienda",
    whatsapp_numero: "522221234567",
    google_maps_url: "https://maps.app.goo.gl/AbC123",
    google_resenas_url: "https://g.page/r/CaBc/review",
  };
  assert.deepEqual(
    listarEnlacesNegocio(enlaces, { incluirResenas: false }).map((e) => e.canal),
    ["whatsapp", "google_maps", "instagram"],
  );
  assert.deepEqual(
    listarEnlacesNegocio(enlaces, { incluirResenas: true }).map((e) => e.canal),
    ["whatsapp", "google_maps", "google_resenas", "instagram"],
  );
  assert.deepEqual(listarEnlacesNegocio({ instagram_usuario: null, whatsapp_numero: null, google_maps_url: null, google_resenas_url: null }, { incluirResenas: true }), []);
  assert.deepEqual(listarEnlacesNegocio(null, { incluirResenas: true }), []);
  assert.equal(tieneEnlacesNegocio({ google_resenas_url: "https://g.page/r/CaBc/review" }), true);
  assert.equal(tieneEnlacesNegocio({}), false);
  assert.equal(tieneEnlacesNegocio(null), false);
});

test("enlacesNegocioSchema: normaliza, convierte vacios en null y nombra el campo que falla", () => {
  const ok = enlacesNegocioSchema.safeParse({
    instagram_usuario: "@Mi.Tienda",
    whatsapp_numero: "+52 222 123 4567",
    google_maps_url: "maps.app.goo.gl/AbC123",
    google_resenas_url: "",
  });
  assert.ok(ok.success);
  if (!ok.success) return;
  assert.deepEqual(ok.data, {
    instagram_usuario: "mi.tienda",
    whatsapp_numero: "522221234567",
    google_maps_url: "https://maps.app.goo.gl/AbC123",
    google_resenas_url: null,
  });

  const todoVacio = enlacesNegocioSchema.safeParse({});
  assert.ok(todoVacio.success);
  if (todoVacio.success) {
    assert.deepEqual(todoVacio.data, { instagram_usuario: null, whatsapp_numero: null, google_maps_url: null, google_resenas_url: null });
  }

  const mal = enlacesNegocioSchema.safeParse({ instagram_usuario: "mi tienda", whatsapp_numero: "522221234567" });
  assert.equal(mal.success, false);
  if (!mal.success) {
    assert.deepEqual(mal.error.issues[0]?.path, ["instagram_usuario"]);
    assert.match(mal.error.issues[0]?.message ?? "", /Instagram/);
  }

  const sinLada = enlacesNegocioSchema.safeParse({ whatsapp_numero: "2221234567" });
  assert.equal(sinLada.success, false);
  if (!sinLada.success) {
    assert.deepEqual(sinLada.error.issues[0]?.path, ["whatsapp_numero"]);
    assert.match(sinLada.error.issues[0]?.message ?? "", /lada/);
  }

  const mapsAjeno = enlacesNegocioSchema.safeParse({ google_maps_url: "https://evil.com/maps" });
  assert.equal(mapsAjeno.success, false);
  if (!mapsAjeno.success) assert.deepEqual(mapsAjeno.error.issues[0]?.path, ["google_maps_url"]);
});
