#!/usr/bin/env python3
"""
Genera el icono ADAPTATIVO de Android a partir del logo de VICINO.

    python scripts/generar-icono-android.py

POR QUE EXISTE. Desde Android 8, el launcher no usa ic_launcher.png: arma el
icono con dos capas, un fondo y un primer plano (mipmap-*/ic_launcher_foreground
y el color ic_launcher_background), y las recorta con la forma que elija cada
fabricante. El 9-jul-2026 se regeneraron los iconos clasicos con la V, pero el
primer plano adaptativo se quedo con el logo de Capacitor (la "X" azul) desde
marzo. Resultado: la app instalada en cualquier Android moderno mostraba la X de
Capacitor, aunque la ficha de Play y los iconos clasicos ya tuvieran la V.

QUE HACE.
  1. Lee apps/web/assets/icon-only.png (1024, la V sobre crema #F4ECE0).
  2. Separa la V del fondo crema (alfa por distancia de color, con los bordes
     des-mezclados para que no quede halo crema).
  3. La centra y la escala para que TODA la V caiga dentro de la zona segura:
     el circulo central de 66dp en un lienzo de 108dp. Lo que quede fuera de esa
     zona lo puede recortar la mascara del fabricante (circulo, gota, squircle).
  4. Escribe las fuentes canonicas para @capacitor/assets
     (assets/icon-foreground.png y assets/icon-background.png), para que la
     proxima vez que alguien corra esa herramienta NO vuelva la X de Capacitor.
  5. Escribe el primer plano en las cinco densidades y pone el color de fondo.

No toca los iconos clasicos (ic_launcher.png, ic_launcher_round.png), que ya
tienen la V y solo los usan los Android anteriores a 8, ni la pantalla de inicio.
"""
import math
import sys
from pathlib import Path

from PIL import Image

RAIZ = Path(__file__).resolve().parent.parent
WEB = RAIZ / "apps" / "web"
FUENTE = WEB / "assets" / "icon-only.png"
RES = WEB / "android" / "app" / "src" / "main" / "res"

CREMA = (244, 236, 224)  # #F4ECE0, el fondo del logo
CREMA_HEX = "#F4ECE0"

# Lienzo adaptativo: 108dp. Zona segura garantizada por Android: circulo de
# 66dp de diametro (radio 33). Se deja 2dp de margen para que ni la mascara mas
# agresiva roce las puntas de la V.
LIENZO_DP = 108
RADIO_OBJETIVO_DP = 31

DENSIDADES = {"mdpi": 108, "hdpi": 162, "xhdpi": 216, "xxhdpi": 324, "xxxhdpi": 432}
MAESTRO = 1080  # se compone a 10x y se reduce: los bordes salen limpios


def separar_logo(img: Image.Image) -> Image.Image:
    """La V sobre transparente. Interior opaco, bordes suaves sin halo crema."""
    img = img.convert("RGB")
    ancho, alto = img.size
    salida = Image.new("RGBA", (ancho, alto), (0, 0, 0, 0))
    entrada = img.load()
    destino = salida.load()
    # Distancia de color a partir de la cual el pixel es V del todo. La V es
    # verde oscuro y negro, a mas de 250 de distancia del crema; los bordes
    # antialiasados quedan en medio.
    d0, d1 = 12.0, 90.0
    for y in range(alto):
        for x in range(ancho):
            r, g, b = entrada[x, y]
            d = math.sqrt((r - CREMA[0]) ** 2 + (g - CREMA[1]) ** 2 + (b - CREMA[2]) ** 2)
            if d <= d0:
                continue
            a = 1.0 if d >= d1 else (d - d0) / (d1 - d0)
            # Des-mezclar: el pixel es a*color + (1-a)*crema; se despeja color
            # para que el borde no arrastre crema al ponerse sobre el fondo.
            c = [
                max(0, min(255, round((canal - (1 - a) * fondo) / a)))
                for canal, fondo in zip((r, g, b), CREMA)
            ]
            destino[x, y] = (c[0], c[1], c[2], round(a * 255))
    return salida


def componer_primer_plano(logo: Image.Image) -> Image.Image:
    caja = logo.getchannel("A").point(lambda v: 255 if v > 127 else 0).getbbox()
    if caja is None:
        sys.exit("El logo salio vacio: revisa el color de fondo de icon-only.png")
    recorte = logo.crop(caja)
    w, h = recorte.size
    # El punto de la V mas lejano del centro de su caja. Para una V son las dos
    # esquinas de arriba, pero se calcula en vez de suponerlo.
    alfa = recorte.getchannel("A").load()
    cx, cy = w / 2, h / 2
    lejania = 0.0
    for y in range(h):
        for x in range(w):
            if alfa[x, y] > 127:
                lejania = max(lejania, math.hypot(x + 0.5 - cx, y + 0.5 - cy))
    px_por_dp = MAESTRO / LIENZO_DP
    escala = (RADIO_OBJETIVO_DP * px_por_dp) / lejania
    nuevo = recorte.resize((round(w * escala), round(h * escala)), Image.LANCZOS)
    lienzo = Image.new("RGBA", (MAESTRO, MAESTRO), (0, 0, 0, 0))
    lienzo.alpha_composite(nuevo, ((MAESTRO - nuevo.width) // 2, (MAESTRO - nuevo.height) // 2))
    print(
        f"V en el lienzo: {nuevo.width / px_por_dp:.1f} x {nuevo.height / px_por_dp:.1f} dp, "
        f"punta mas lejana a {RADIO_OBJETIVO_DP} dp del centro (zona segura: 33 dp)"
    )
    return lienzo


def main() -> None:
    if not FUENTE.exists():
        sys.exit(f"No existe {FUENTE}")
    primer_plano = componer_primer_plano(separar_logo(Image.open(FUENTE)))

    # Fuentes canonicas para @capacitor/assets (1024 cada una).
    #
    # OJO con la convencion de esa herramienta: NO trata icon-foreground.png como
    # el lienzo completo de 108dp sino como el area visible de 72dp, porque al
    # escribir ic_launcher.xml envuelve el primer plano en un <inset> del 16.7%
    # por lado (18dp de 108). Por eso aqui se guarda el recorte central de 72dp:
    # si alguien vuelve a correr `npx capacitor-assets generate`, la herramienta
    # le devuelve el margen y la V sale exactamente del mismo tamano que la que
    # genera este script. Guardar el lienzo completo la haria salir un tercio
    # mas chica.
    margen = round(MAESTRO * 18 / LIENZO_DP)
    area_visible = primer_plano.crop((margen, margen, MAESTRO - margen, MAESTRO - margen))
    area_visible.resize((1024, 1024), Image.LANCZOS).save(WEB / "assets" / "icon-foreground.png")
    Image.new("RGBA", (1024, 1024), CREMA + (255,)).save(WEB / "assets" / "icon-background.png")

    for densidad, lado in DENSIDADES.items():
        destino = RES / f"mipmap-{densidad}" / "ic_launcher_foreground.png"
        primer_plano.resize((lado, lado), Image.LANCZOS).save(destino, optimize=True)
        print(f"  {destino.relative_to(RAIZ)}  {lado}x{lado}")

    (RES / "values" / "ic_launcher_background.xml").write_text(
        '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n'
        f'    <color name="ic_launcher_background">{CREMA_HEX}</color>\n</resources>\n',
        encoding="utf-8",
    )
    print(f"  color de fondo -> {CREMA_HEX}")


if __name__ == "__main__":
    main()
