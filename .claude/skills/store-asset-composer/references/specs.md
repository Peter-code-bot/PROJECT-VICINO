# Specs de tiendas — referencia detallada

Fuente Play: https://support.google.com/googleplay/android-developer/answer/9866151

## Google Play — Screenshots

| Ranura | Cantidad | Formato | Aspecto | Lado mínimo | Lado máximo |
|---|---|---|---|---|---|
| Teléfono | 2–8 | PNG o JPEG, ≤ 8 MB | 16:9 o 9:16 | 320 px | 3 840 px |
| Tablet 7" | hasta 8 | PNG o JPEG, ≤ 8 MB | 16:9 o 9:16 | 320 px | 3 840 px |
| Tablet 10" | hasta 8 | PNG o JPEG, ≤ 8 MB | 16:9 o 9:16 | **1 080 px** | 7 680 px |

### Tamaño recomendado para VICINO
- **`1080×1920` (9:16 exacto)** cumple las **3 ranuras** simultáneamente
  (lado mínimo = 1080, dentro de 1080–7680 del tablet 10"). → Subir el mismo PNG a las tres.
- Alta resolución opcional: **`1440×2560`** (9:16), también válido en las tres y más nítido en tablets.
- Mantener PNG por debajo de 8 MB (un gráfico plano con texto y un mockup pesa muy poco; sin riesgo).

### Otros assets de la ficha Play (no son screenshots — referencia futura)
- **App icon:** 512×512 PNG (32-bit, con alpha).
- **Feature graphic:** 1024×500 PNG/JPEG (sin alpha). Obligatorio para la ficha.
- **Promo / video:** enlace de YouTube (opcional).

## Apple App Store (reuso futuro)

| Dispositivo | Tamaño (px, vertical) |
|---|---|
| iPhone 6.9" (15 Pro Max / 16 Pro Max) | 1290×2796 |
| iPhone 6.5" | 1242×2688 |
| iPad Pro 12.9" (3ª gen) | 2048×2732 |

- Formato PNG/JPEG, sin transparencia, sin esquinas redondeadas.
- 1–10 capturas por tamaño. El set 6.9" suele aceptarse como escalable.

## Verificación de un PNG generado

```powershell
# dimensiones
Add-Type -AssemblyName System.Drawing
$img = [System.Drawing.Image]::FromFile("ruta\al\archivo.png")
"$($img.Width) x $($img.Height)"; $img.Dispose()

# peso
(Get-Item "ruta\al\archivo.png").Length / 1MB
```

Checklist por archivo:
- [ ] Aspecto 9:16 (o 16:9). VICINO usa 9:16.
- [ ] Lado mínimo ≥ 1080 si se quiere reusar en tablet 10".
- [ ] Lado máximo ≤ 3840 (teléfono/7") o ≤ 7680 (10").
- [ ] Peso < 8 MB.
- [ ] PNG o JPEG.
