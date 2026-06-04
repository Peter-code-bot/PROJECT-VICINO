---
name: store-asset-composer
description: Genera gráficos promocionales / screenshots para la ficha de Google Play (y App Store) de VICINO con el estilo de casa (fondo terracota, titular Outfit, mockup de teléfono, decoración temática). Usar cuando el usuario pida "screenshots de la tienda", "anuncios de Play Store", "store assets", "imágenes de la ficha de la app", "feature graphic", o quiera un nuevo lote/variantes de capturas promocionales. Cubre specs exactas de Play, catálogo de titulares y el workflow con Stitch.
---

# Store Asset Composer — Gráficos promocionales de VICINO

Produce los gráficos verticales 9:16 que VICINO sube a la ficha de Google Play, manteniendo
el estilo de marca de los anuncios ya existentes y cumpliendo las specs de la tienda.

## Cuándo usar esta skill

- "Necesito screenshots / anuncios para la Play Store"
- "Genera más imágenes promocionales de la app"
- "Haz variantes del anuncio de [pantalla]"
- "Prepara los assets de la ficha (teléfono / tablet)"
- Lanzamiento de feature nueva → un anuncio nuevo que la muestre.

## Estilo de casa (NO improvisar)

Replicar exactamente el look de `VICINO archivos/MKT/RANKINGS.png` y `MENSAJES.png`:

| Elemento | Valor |
|---|---|
| Aspecto | **9:16 vertical** |
| Fondo | Terracota `#C45B3F` (plano, sin gradiente) |
| Titular | Negrita, charcoal `#1A1A2E`, fuente **Outfit**, 1–2 palabras por línea, arriba-izquierda |
| Mockup | Smartphone crema/blanco, ligeramente inclinado, centrado-abajo, con la captura real adentro |
| Decoración | 1 elemento temático por concepto (corona, burbujas, pin, badge, etc.) |
| Tono | Quiet luxury, limpio. **NUNCA** gradientes púrpura ("AI slop") |

## Specs de Google Play (cumplir SIEMPRE)

Ver detalle y App Store en [references/specs.md](references/specs.md). Resumen operativo:

- **Renderizar cada gráfico a `1080×1920 px` (9:16 exacto), PNG, < 8 MB.**
- Ese único tamaño sirve para las **3 ranuras** de Play (teléfono, tablet 7", tablet 10"):
  el lado mínimo 1080 satisface el rango 1080–7680 del tablet de 10". Subir el mismo archivo a las tres.
- Opcional alta resolución para tablets nítidas: `1440×2560` (también 9:16 válido en las 3).

## Catálogo de conceptos / titulares

| Pantalla | Titular | Decoración |
|---|---|---|
| Rankings | Los Mejores de tu Zona | corona dorada |
| Chat / Mensajes | Chatea Directo | burbujas de chat |
| Home / feed cercano | Descubre tu Barrio · A la Vuelta de la Esquina | pin de ubicación |
| Perfil de vendedor | Apoya lo Local · Conoce a tus Vecinos | badge verificado + estrellas |
| Publicar (vender) | Vende en tu Comunidad · Publica Gratis · Sin Comisiones | cámara / botón "+" |
| Home/Buscar (campus) | Vende en tu Universidad | birrete + mochila |
| Buscar / Mapa | Todo Cerca de Ti · Encuentra lo que Necesitas | pins + círculo de radio |
| Confianza / KYC | Vecinos Verificados · Compra Seguro | escudo / check |

## Workflow con Stitch

> **LIMITACIÓN DEL MCP (verificada):** las capturas subidas a Stitch se guardan como **imagen**
> (`htmlCode` vacío). El MCP `mcp__stitch__*` **NO** puede: (a) adjuntar una imagen a
> `generate_screen_from_text` (es texto-only), ni (b) `generate_variants`/`edit_screens` sobre
> una imagen sin HTML (devuelve sin variantes). Por eso, la generación que **embebe la captura
> real** debe lanzarse desde la **web de Stitch** (stitch.withgoogle.com), no por MCP.

**Flujo correcto (manual en web + asistencia aquí):**
1. El usuario abre el proyecto en la web de Stitch y, por concepto, **adjunta la captura** + pega
   el prompt (ver [references/prompts-stitch.md](references/prompts-stitch.md)) y pide **5–7 variantes**.
2. El usuario revisa en Stitch y elige 1 ganadora por concepto; la exporta a PNG.
3. **Cumplir specs**: pasar la ganadora por `scripts/store-assets/resize-store-assets.mjs` (sharp)
   → `1080×1920` exacto, < 8 MB.
4. **Guardar** en `VICINO archivos/MKT/` con nombre `NN-PANTALLA-titular-kebab.png`.

**Vía MCP solo sirve para:** inspeccionar el proyecto (`get_project`/`get_screen`), identificar
capturas por su `title`, y generar pantallas **desde texto** (sin captura real — recreación, NO
recomendado para estos anuncios).

El pack de prompts listo para pegar está en [references/prompts-stitch.md](references/prompts-stitch.md).

## Modo fidelidad (alternativa — pixel-perfect)

Si se necesita el screenshot real **exacto** dentro del marco (no recreado por IA), usar un
template HTML/CSS con el screenshot como `<img>` y renderizar con Playwright/headless a `1080×1920`.
Esquema: contenedor terracota → `<h1>` Outfit charcoal → `<div>` marco de teléfono con `transform: rotate`
→ `<img>` captura → `<svg>`/PNG de la decoración. Capturar con `page.screenshot({ clip })` al tamaño exacto.

## Verificación

- [ ] Cada PNG es 9:16, `1080×1920` (o `1440×2560`), < 8 MB.
- [ ] Estilo consistente con los 2 originales (revisión visual lado a lado).
- [ ] Mínimo 2, idealmente 4–8 gráficos por ranura.
- [ ] Subidos a un **borrador** de Play Console sin advertencias.
