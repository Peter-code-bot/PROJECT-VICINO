import assert from "node:assert/strict";
import test from "node:test";
import { cargaDentroDelWebView } from "./abrir-enlace-externo";

test("Android: los hosts que casan con *.google.com de allowNavigation se abren con Browser.open", () => {
  assert.equal(cargaDentroDelWebView("https://www.google.com/maps/place/x", "android"), true);
  assert.equal(cargaDentroDelWebView("https://maps.google.com/?q=19.04,-98.2", "android"), true);
  assert.equal(cargaDentroDelWebView("https://search.google.com/local/writereview?placeid=abc", "android"), true);
  assert.equal(cargaDentroDelWebView("HTTPS://WWW.GOOGLE.COM/maps", "android"), true);
});

test("Android: lo que NO esta en allowNavigation va al sistema (app del canal o navegador)", () => {
  assert.equal(cargaDentroDelWebView("https://wa.me/522221234567?text=hola", "android"), false);
  assert.equal(cargaDentroDelWebView("https://www.instagram.com/mi.tienda/", "android"), false);
  assert.equal(cargaDentroDelWebView("https://maps.app.goo.gl/AbC123", "android"), false);
  assert.equal(cargaDentroDelWebView("https://goo.gl/maps/xyz", "android"), false);
  assert.equal(cargaDentroDelWebView("https://g.page/r/CaBc/review", "android"), false);
  // La mascara *.google.com no casa dos etiquetas ni .com.mx.
  assert.equal(cargaDentroDelWebView("https://google.com/maps/x", "android"), false);
  assert.equal(cargaDentroDelWebView("https://www.google.com.mx/maps/x", "android"), false);
  assert.equal(cargaDentroDelWebView("https://maps.google.com.mx/?q=x", "android"), false);
});

test("iOS y web nunca interceptan; una URL rota tampoco", () => {
  assert.equal(cargaDentroDelWebView("https://www.google.com/maps/place/x", "ios"), false);
  assert.equal(cargaDentroDelWebView("https://www.google.com/maps/place/x", "web"), false);
  assert.equal(cargaDentroDelWebView("no es una url", "android"), false);
});
