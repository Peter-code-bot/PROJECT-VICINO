# VICINO — Sistema de Diseño V2 (Green Quiet Luxury)

Este documento define la identidad visual, tokens y pautas de diseño para **VICINO**, el marketplace local de proximidad. Se utiliza como fuente de verdad para el desarrollo del frontend y para la sincronización con herramientas de diseño (como Stitch).

---

## 1. Principios de Diseño

1. **Quiet Luxury (Lujo Silencioso)**: Estilo minimalista, limpio, premium y elegante. Evita colores genéricos brillantes y gradientes saturados artificiales ("AI slop").
2. **Mobile First**: Diseñado optimizado para pantallas móviles (375px) con escalabilidad fluida hacia desktop.
3. **Confianza Local**: Uso de distintivos visuales claros y sutiles (badges de confianza) para vendedores e información de proximidad geolocalizada.
4. **Dark Mode por Defecto**: Fondo oscuro mate combinado con texturas de vidrio (glassmorphism) y acentos en verde esmeralda y crema.

---

## 2. Paleta de Colores (Green Theme)

### Colores de Marca (Brand)
- **Brand Base (Primary)**: `#1F5A4E` (Verde bosque profundo, transmite solidez y sofisticación)
- **Brand Light (Accent/Highlight)**: `#2E8773` (Verde esmeralda claro, usado para enlaces, acciones y acentos activos)
- **Brand Dark**: `#133731` (Verde muy oscuro, usado para contrastes sutiles)
- **Brand Charcoal**: `#1A1A2E` (Gris oscuro profundo para texto y elementos estructurales)
- **Brand Cream**: `#FFF8F0` (Crema claro, color de fondo principal en tema claro y texto secundario en tema oscuro)

### Badges de Confianza y Estados
- **Trust Emerald**: `#2D8F6F` (Usado para vendedores verificados, transacciones seguras)
- **Trust Gold**: `#D4A853` (Usado para insignias destacadas, reviews de 5 estrellas)
- **Trust Silver**: `#A8B0AD` (Insignia de plata / segundo nivel)
- **Trust Bronze**: `#C48A5A` (Insignia de bronce / tercer nivel)
- **Danger/Error**: `#FF3B30`
- **Warning**: `#B8862A`

### Superficies (Surfaces)
- **Modo Oscuro (Default)**:
  - Fondo Base: `#0A0F0E`
  - Nivel Elevado 1 (Cards, Headers): `#0E1413`
  - Nivel Elevado 2 (Modales, Selectores): `#141A19`
  - Bordes Sutiles: `#1F3530`
  - Bordes Fuertes: `#2A4640`
- **Modo Claro**:
  - Fondo Base: `#FFF8F0`
  - Nivel Elevado 1: `#FAF6EE`
  - Nivel Elevado 2: `#F4EFE4`
  - Bordes Sutiles: `#E8E2D5`
  - Bordes Fuertes: `#D5CDB8`

---

## 3. Tipografía

- **Fuentes**:
  - **Encabezados (`h1` a `h6`, Títulos)**: `Outfit` (Tipografía geométrica, elegante y moderna).
  - **Cuerpo de Texto / Interfaces**: `Inter` (Tipografía altamente legible en tamaños pequeños).
- **Pesos (Weights)**:
  - Regular (`400`) para descripción y párrafos.
  - Medium (`500`) para etiquetas, navegación y botones.
  - Semi-Bold (`600`) / Bold (`700`) para encabezados principales.

---

## 4. Formas y Bordes (Border Radius)

- **Extra Pequeño (`r-sm` - 6px)**: Botones pequeños, tags de categorías secundarias.
- **Mediano (`r-md` - 10px)**: Botones de llamada a la acción (CTA) estándar, tarjetas de producto pequeñas.
- **Grande (`r-lg` - 14px)**: Tarjetas de producto estándar, contenedores de sección.
- **Extra Grande (`r-xl` - 22px)**: Modales, drawers inferiores (bottom sheets), paneles deslizables.
- **Píldora (`r-pill` - 999px)**: Botones de tipo cápsula, badges de estado.

---

## 5. Efectos Visuales

### Glassmorphism (Efecto Cristal)
Se utiliza para la barra de navegación flotante inferior (`bottom-nav`), el encabezado fijo superior y menús contextuales.
- **Propiedades**: Fondo semi-transparente (75%-80% de opacidad) con desenfoque de fondo (`backdrop-filter: blur(16px)`).
- **Ejemplo**:
  - Tema Claro: `rgba(255, 255, 255, 0.75)` con borde `rgba(0, 0, 0, 0.06)`.
  - Tema Oscuro: `rgba(10, 15, 14, 0.8)` con borde `rgba(255, 255, 255, 0.06)`.

### Sombras y Brillo (Shadows)
- **Shadow MD**: `0 4px 12px rgba(0, 0, 0, 0.08)` (Para tarjetas elevadas).
- **Shadow Glow (Brillo Verde)**: `0 10px 24px rgba(31, 90, 78, 0.35)` (Para botones principales destacados o el botón de vender en la barra de navegación).
