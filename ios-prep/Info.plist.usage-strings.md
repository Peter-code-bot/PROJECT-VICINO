# Usage strings para ios/App/App/Info.plist

Pegar estos bloques dentro del `<dict>` raíz del Info.plist que genere Capacitor
en la Mac (`ios/App/App/Info.plist`), antes de `</dict>`.

```xml
<key>NSLocationWhenInUseUsageDescription</key>
<string>VICINO usa tu ubicación para mostrarte vendedores y productos cercanos a ti. Tu ubicación nunca se comparte con otros usuarios.</string>

<key>NSLocationAlwaysAndWhenInUseUsageDescription</key>
<string>VICINO usa tu ubicación para mostrarte vendedores y productos cercanos a ti. Tu ubicación nunca se comparte con otros usuarios.</string>

<key>NSCameraUsageDescription</key>
<string>VICINO necesita tu cámara para que tomes fotos de los productos que vendes.</string>

<key>NSPhotoLibraryUsageDescription</key>
<string>VICINO necesita tu galería para que selecciones fotos de tus productos y las publiques.</string>

<key>NSPhotoLibraryAddUsageDescription</key>
<string>VICINO guarda en tu galería las fotos que tomas dentro de la app para tus listados.</string>

<key>ITSAppUsesNonExemptEncryption</key>
<false/>
```

## Notas críticas
- `NSLocationAlwaysAndWhenInUseUsageDescription` es OBLIGATORIO aunque NO se use
  background: el linker de `ion-ios-geolocation` (dependencia de `@capacitor/geolocation`)
  lo exige. Sin él, falla la subida con ITMS-90683. Mismo texto que WhenInUse está bien.
- NO añadir `NSUserTrackingUsageDescription` ni el framework AppTrackingTransparency.
  VICINO no hace tracking cross-app (IDFA). Añadirlo dispara la prompt ATT obligatoria
  y un rechazo por Guideline 5.1.2.
- `ITSAppUsesNonExemptEncryption=false` evita el prompt "Missing Compliance" en cada upload.
- Plugins que motivan cada string: geolocation → Location; camera → Camera +
  PhotoLibrary; (PhotoLibraryAdd solo si se invoca guardar a galería, incluido por
  precaución).
