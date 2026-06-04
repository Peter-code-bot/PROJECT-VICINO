# Pack de prompts para Stitch (web UI) — Anuncios Play Store de Vicino

> **Por qué la web y no el MCP:** las capturas subidas a Stitch se guardan como imagen
> (`htmlCode` vacío). El MCP no puede (a) adjuntar una imagen a `generate_screen_from_text`,
> ni (b) hacer `variants`/`edit` sobre una imagen sin HTML. Por eso la generación que
> **embebe tu captura real** debe lanzarse desde **stitch.withgoogle.com**: adjuntas la SS,
> pegas el prompt y pides 5–7 variantes. Luego exportas el PNG elegido y lo pasas por
> `scripts/store-assets/resize-store-assets.mjs` para cumplir specs de Play.

## Cómo usarlo
1. Abre el proyecto **PROJECT VICINO** en la web de Stitch.
2. Para cada concepto: **adjunta la captura indicada** + pega el prompt base con su relleno.
3. Pide **5–7 variantes** (botón de variantes / "explore").
4. Elige 1, exporta a PNG, y normalízalo con el script (1080×1920).

## Prompt base (rellenar {TITULAR} y {DECORACIÓN})

```
Crea un GRÁFICO PROMOCIONAL vertical 9:16 para Google Play con el estilo de marca de Vicino,
usando la captura adjunta.

Reglas estrictas:
- Fondo plano TERRACOTA #C45B3F en todo el lienzo.
- Coloca la captura adjunta COMPLETA y SIN alterar su contenido dentro de un mockup de
  smartphone color crema/blanco, ligeramente inclinado, en la mitad inferior, centrado, con
  sombra suave realista.
- Titular arriba a la izquierda, en negrita, 2 líneas, color charcoal #1A1A2E, tipografía Outfit:
  «{TITULAR}».
- Añade UNA sola decoración temática sutil cerca del teléfono: {DECORACIÓN}.
- Estética quiet-luxury, limpia, con mucho aire.

PROHIBIDO: gradientes púrpura, texto adicional o de relleno, marcas de agua, deformar la captura.
Genera 5–7 variantes cambiando la composición, el ángulo/posición del teléfono y el tratamiento
de la decoración, manteniendo SIEMPRE el fondo terracota y el titular.
```

## Rellenos por concepto

| Captura a adjuntar | {TITULAR} | {DECORACIÓN} |
|---|---|---|
| **SS10 – Home** | Descubre tu Barrio | un pin de ubicación dorado/charcoal |
| **SS5 – Búsqueda** | Encuentra lo que Necesitas | una lupa con destellos sutiles |
| **SS4 – Universidad** | Vende en tu Universidad | un birrete de graduación |
| **SS9 – Perfil vendedor** | Apoya lo Local | una insignia "Verificado" + estrellas doradas |
| **SS7 – Mi Tienda** | Haz Crecer tu Negocio | una flecha/gráfica ascendente |
| **SS8 – Reseñas** | Compra con Confianza | cinco estrellas doradas + comillas |
| **SS6 – Cerca de ti** (backup) | Todo a la Vuelta | pines de mapa + círculo de radio |

## Set objetivo (8 = máximo de Play, máxima variedad)
1. Rankings ✅ — "Los Mejores de tu Zona" — corona
2. Mensajes ✅ — "Chatea Directo" — burbujas
3. Home — "Descubre tu Barrio" — pin
4. Búsqueda — "Encuentra lo que Necesitas" — lupa
5. Universidad — "Vende en tu Universidad" — birrete
6. Perfil vendedor — "Apoya lo Local" — badge + estrellas
7. Mi Tienda — "Haz Crecer tu Negocio" — gráfica ↑
8. Reseñas — "Compra con Confianza" — estrellas
```
```
