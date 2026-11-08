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

test("WhatsApp: rechaza letras, menos de 10 digitos, mas de 15 y cero inicial", () => {
  assert.equal(normalizarNumeroWhatsApp("222 123 45 67 ext 2"), null);
  assert.equal(normalizarNumeroWhatsApp("123456789"), null);
  assert.equal(normalizarNumeroWhatsApp("1234567890123456"), null);
  assert.equal(normalizarNumeroWhatsApp("0122212345678"), null);
  assert.equal(normalizarNumeroWhatsApp(""), null);
});

test("WhatsApp: NO rellena la lada de un numero local de 10 digitos (no se inventan datos)", () => {
  // Pasa tal cual: la interfaz es la que pide la lada. Lo que no se hace es
  // anteponer 52 por cuenta propia.
  assert.equal(normalizarNumeroWhatsApp("2221234567"), "2221234567");
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

test("listarEnlacesNegocio: orden fijo y la resena solo cuando se pide", () => {
  const enlaces = {
    instagram_usuario: "mi.tienda",
    whatsapp_numero: "522221234567",
    google_maps_url: "https://maps.app.goo.gl/AbC123",
    google_resenas_url: "https://g.page/r/CaBc/review",
  };
  assert.deepEqual(
    listarEnlacesNegocio(enlaces, { incluirResenas: false }).map((e) => e.canal),
    ["instagram", "whatsapp", "google_maps"],
  );
  assert.deepEqual(
    listarEnlacesNegocio(enlaces, { incluirResenas: true }).map((e) => e.canal),
    ["instagram", "whatsapp", "google_maps", "google_resenas"],
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

  const mal = enlacesNegocioSchema.safeParse({ instagram_usuario: "mi tienda", whatsapp_numero: "2221234567" });
  assert.equal(mal.success, false);
  if (!mal.success) {
    assert.deepEqual(mal.error.issues[0]?.path, ["instagram_usuario"]);
    assert.match(mal.error.issues[0]?.message ?? "", /Instagram/);
  }

  const mapsAjeno = enlacesNegocioSchema.safeParse({ google_maps_url: "https://evil.com/maps" });
  assert.equal(mapsAjeno.success, false);
  if (!mapsAjeno.success) assert.deepEqual(mapsAjeno.error.issues[0]?.path, ["google_maps_url"]);
});
