/**
 * Resuelve el tema ANTES del primer pintado, y deja el color de la barra del
 * navegador de acuerdo con el.
 *
 * Se carga con strategy="beforeInteractive" desde app/layout.tsx.
 *
 * Por que tambien toca <meta name="theme-color">: ese meta lo declara
 * app/layout.tsx con dos entradas por `prefers-color-scheme`, o sea que sigue
 * al SISTEMA. Pero el tema de VICINO no sigue al sistema, sigue a
 * localStorage['vicino-theme'] y arranca en claro. Con el SO en oscuro y la app
 * en claro, el navegador pintaba su barra oscura sobre una pagina clara: eso es
 * la banda oscura de arriba que se venia reportando, y es de la web, no de la
 * app nativa.
 *
 * Se inyecta un meta SIN atributo `media`. La especificacion dice que el
 * navegador usa el PRIMER theme-color cuyo media aplique; sin media aplica
 * siempre, y al insertarlo al principio del <head> gana a los dos de Next.
 */
(function () {
  try {
    var t = localStorage.getItem('vicino-theme') || 'light';
    if (t === 'system') {
      t = window.matchMedia('(prefers-color-scheme:dark)').matches ? 'dark' : 'light';
    }
    document.documentElement.classList.toggle('dark', t === 'dark');

    // Los mismos valores que --bg en globals.css. Si cambian alli, cambian aqui:
    // el desfase anterior (#0A0F0E contra el #050907 real) dejaba una costura
    // visible entre la barra del navegador y la pagina.
    var meta = document.createElement('meta');
    meta.setAttribute('name', 'theme-color');
    meta.setAttribute('content', t === 'dark' ? '#050907' : '#FFF8F0');
    document.head.insertBefore(meta, document.head.firstChild);
  } catch {}
})();
