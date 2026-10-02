# Verificadores de la prueba cerrada: diagnóstico y arreglo

**Fecha:** 29 de septiembre de 2026
**Estado: ARREGLADO Y VERIFICADO.** Lo que faltaba era sacar a los 12 de la prueba interna. Ya está hecho, y el alta se probó de punta a punta con una cuenta real.

---

## Lo que cambié hoy en Play Console

1. **Quité a los 12 de la prueba interna.** Las 12 listas seguían existiendo pero ninguna está ya seleccionada en esa pista. El segmento interno pasó solo a **«Inactivo»** al quedarse sin verificadores, así que no hizo falta pausarlo.
2. **No toqué nada más.** La prueba cerrada sigue **Activa** con la versión **8 (1.7)** y sus 178 países. El Grupo de Google sigue siendo la lista de verificadores.

Las 12 listas de correo siguen guardadas en la consola. Si algún día quieres volver a usar la prueba interna para el equipo, se vuelven a marcar en un clic. **Pero quien esté en la interna no cuenta para los 14 días**, así que no metas ahí a nadie que quieras como verificador.

## Lo que verifiqué después del cambio

- **El grupo acepta a cualquiera sin aprobación:** «Quiénes pueden unirse al grupo» está en *Cualquiera en la Web puede unirse*, y el grupo es visible para todo el mundo. Eso es lo que sostiene tu flujo de mandar el enlace sin tener el correo de nadie.
- **El alta funciona:** hice el paso 2 con una cuenta real y la página quedó con el sello verde **«Ya eres verificador»** («You are a tester»), y con un enlace de descarga en esa misma pantalla.
- **La ficha ofrece instalar:** dice «Esta app está disponible para tu dispositivo» con el botón **Instalar**.

---

## Diagnóstico: por qué no aparecía

**Los 12 verificadores estaban dados de alta en la PRUEBA INTERNA, no en la cerrada.** Y eso, por regla oficial de Google, los dejaba fuera de la cerrada.

Lo que hay hoy en Play Console:

- **Prueba interna:** activa, con **12 listas de correo de una persona cada una** (Alejandro Estrada, Diego Soriano, Javier Alejandro, Javier Rodriguez, Jorge Flores, Juan Escutia, Juan Soriano, Mario Soriano, Pedro Soriano, Pepe Revive, Raul Ochoa, Ruben Gonzales). Versión publicada: **4 (1.3), del 4 de junio.**
- **Prueba cerrada:** activa, con el Grupo de Google (14 miembros). Versión publicada: **8 (1.7), del 26 de septiembre.**

Y la regla, textual de Google:

> «Users who opt into internal testing **aren't eligible for open and closed testing**, even if included as testers on those tracks. These users receive **only the version code published on the Internal testing track**.»
>
> — [Set up an open, closed, or internal test](https://support.google.com/googleplay/android-developer/answer/9845334)

Traducido a lo que os está pasando: quien aceptó la prueba interna **no puede recibir la cerrada, aunque esté en el grupo**, y Play sólo le ofrece la versión de la prueba interna, que es de junio. Esa persona:

- No ve la versión nueva.
- **No cuenta para los 12 verificadores × 14 días**, porque sólo cuenta la prueba cerrada.

Los nombres se solapan: Pedro, Alejandro y Javier están en las dos listas. Play Console no muestra quién aceptó de verdad la prueba interna, así que no puedo decirte cuáles de los 12 están bloqueados. Pero el riesgo es concreto y arreglarlo es barato.

### Cómo se arregló

Ya está hecho: los 12 salieron de la prueba interna y el segmento quedó inactivo. Si alguno sigue atascado, es porque su cuenta guarda el alta de la interna; se suelta abriendo https://play.google.com/apps/internaltest/4701655295868435015 y tocando «Leave the program».

---

## Lo que sí está bien, para que no lo toques

Lo revisé todo hoy. Nada de esto es el problema:

| Qué | Estado real |
| --- | --- |
| Pista de prueba cerrada | **Activa** |
| Versión 8 (1.7) | **Disponible para verificadores específicos**: publicada, ni borrador ni en revisión |
| Fecha de lanzamiento | 26 sept, 3:13 p.m. |
| Lista de verificadores de la cerrada | Grupo `vicino-verificadores@googlegroups.com`, bien conectado |
| Miembros del grupo | 14 |
| Países | 178, **México incluido** |
| Compatibilidad mínima | Android 7 en adelante |
| Registro de verificación de desarrolladores | Al día |

Y la prueba directa: con una cuenta que está en el grupo y que **no** aceptó la prueba interna, la ficha en la web muestra **«Instalar»** y **«Esta app está disponible para tu dispositivo»**. O sea que la tubería funciona cuando el conflicto de pistas no estorba.

**El hueco a explicar era ése: 14 personas en el grupo y una sola instalación.**

---

## La segunda causa: nadie la va a encontrar buscando

> «Si haces una prueba interna o cerrada antes de que tu aplicación esté disponible mediante pruebas abiertas o se lance a producción, **los testers no podrán encontrarla buscando en Google Play. Debes compartir la URL de Play Store** de la aplicación con los testers para que puedan descargarla.»
>
> — [Configurar una prueba abierta, cerrada o interna](https://support.google.com/googleplay/android-developer/answer/9845334?hl=es)

No es un retraso: es definitivo mientras la app no esté en producción. Y es justo lo que hace cualquiera al llegar al paso 3: abrir la Play Store y buscar «VICINO». No encuentra nada y concluye que algo falló.

El mensaje tiene que decir explícitamente **que no busque**.

---

## Las reglas de plazo, con lo que Google dice de verdad

> «Cuando publiques una prueba abierta, cerrada o interna **por primera vez**, el enlace de prueba puede tardar varias horas en estar disponible para los testers. Los cambios adicionales también pueden tardar varias horas en estar disponibles.»

Dos consecuencias:

- **Google no documenta ningún plazo de 24 horas.** Ese número del mensaje actual no sale de Google. Conviene quitarlo, porque le da permiso a la persona para dejarlo para mañana, y mañana es nunca.
- La demora de la primera publicación **ya se consumió el 26 de septiembre**. Lo que puede seguir tardando «varias horas» es cada cambio de configuración.

Y el orden de los pasos es obligatorio, no una recomendación:

> «En el caso de las pruebas cerradas que usen un grupo de Google, los usuarios deberán unirse al grupo **antes** de participar en la prueba.»
>
> «**Todos los testers deben usar el enlace** para unirse a la prueba.»

Quien se dio de alta antes de entrar al grupo tiene que repetir el alta.

---

## Un dato que baja la urgencia

El requisito dice:

> «Al menos 12 testers deberán haber **participado** en la prueba cerrada de forma continua durante los 14 días anteriores.»

Lo que cuenta para el reloj es **estar dado de alta en la cerrada**, no tener la app instalada y funcionando. Así que el problema de instalación es malo para conseguir comentarios, pero no frena el contador de quien completó el paso 2 y no está atrapado en la prueba interna.

Matiz honesto: al pedir acceso a producción, Google hace preguntas sobre cómo se hizo la prueba, y pide expresamente que la gente use la app. Que instalen importa para que aprueben, aunque no sea lo que cuenta los días.

Y lo que sí rompe el conteo es **salirse** de la prueba, no desinstalar la app.

---

## Subir otro AAB durante los 14 días: qué pasa de verdad

> **Corrección del 1-oct-2026.** La primera versión de este apartado decía que subir un AAB nuevo podía dejar a los verificadores «sin nada que instalar». Eso estaba exagerado. Play separa el estado de la app del estado de la actualización: la versión publicada **sigue disponible** mientras la nueva está «en revisión», y a quien ya la tiene le llega la actualización cuando se aprueba. Subir un AAB nuevo **no saca a nadie de la prueba** ni reinicia el contador de 14 días, porque lo que cuenta es seguir dado de alta.

Las versiones de prueba cerrada **también pasan revisión**:

> «Processing can take a few hours or up to seven days (or longer in exceptional cases).»
>
> — [Publicar versiones y actualizaciones](https://support.google.com/googleplay/android-developer/answer/9859654)

Y las cuentas nuevas se revisan más despacio a propósito:

> «For certain developer accounts, we'll take more time to thoroughly review your app... This may result in review times of **up to seven days** or longer in exceptional cases.»
>
> — [Tiempos de revisión](https://support.google.com/googleplay/android-developer/answer/9859751)

La cuenta de VICINO es personal y reciente, o sea justo ese perfil. Lo que cuesta subir un AAB nuevo es **tiempo hasta que llega**, no disponibilidad: mientras Google revisa la versión nueva, los verificadores siguen instalando y usando la anterior.

Regla práctica: **sube un AAB sólo cuando valga la pena esperar por él.** Lo que se pueda arreglar en la web, que vaya en la web, porque se despliega sola y llega al instante a la app. Lo nativo (íconos, permisos, plugins) sí necesita AAB; agrúpalo para no encadenar revisiones.

---

## Dos precisiones para no perseguir fantasmas

**El país que filtra es el de la cuenta, no dónde está la persona.**

> «Country targeting is based on the user's Play country (that is, where their account is registered), not their current location.»

México está entre los 178 países de la pista, así que esto no te está afectando. Pero si alguna vez un verificador tiene su cuenta de Play registrada en otro país, no le va a aparecer aunque esté en Puebla, y ninguna instrucción de caché lo arregla.

**Que el grupo «tarda en propagarse» no está documentado por Google.** Lo dicen foros, no la documentación. Lo único oficial es que sólo los miembros del grupo pueden unirse a la prueba. Lo mismo con el truco de borrar la caché de Play Store: funciona según la experiencia de mucha gente, pero no es un procedimiento que Google respalde. Conviene saber qué es regla y qué es remedio de foro, para no explicarle a un verificador una causa inventada.

---

## Un filtro silencioso que conviene cerrar: el autofoco

El manifiesto pide el permiso de cámara y declara la cámara como opcional, pero **no declara el autofoco**. La documentación de Android dice que hacen falta las dos líneas:

> «para inhabilitar el filtrado implícito por el permiso CAMERA, declara las siguientes funciones:
> `<uses-feature android:name="android.hardware.camera" android:required="false" />`
> `<uses-feature android:name="android.hardware.camera.autofocus" android:required="false" />`»
>
> — [`<uses-feature>`](https://developer.android.com/guide/topics/manifest/uses-feature-element)

Hoy en `apps/web/android/app/src/main/AndroidManifest.xml` sólo está la primera. O sea que Play sigue filtrando los teléfonos sin cámara con autofoco.

Afecta a pocos teléfonos, pero el modo de fallo es el peor de todos: **no da ningún error**, la ficha simplemente no ofrece instalar, y ninguna instrucción de caché ni de cuenta lo arregla. Es el candidato a «ese verificador al que nunca le funcionó y nadie supo por qué». Es una línea y entra en el próximo AAB.

---

## Lo que NO hay que hacer, y cuesta dos semanas

**No mováis a los verificadores a la prueba interna para que instalen rápido.** Es tentador, porque la interna es casi inmediata:

> «Normalmente, los testers tienen acceso a las versiones **unos segundos** después de que se añadan a Play Console.»

Pero por la regla de arriba, quien acepta la interna **queda fuera de la cerrada**, que es la única que cuenta. Eso es exactamente lo que ya pasó, y es lo que hay que deshacer. Que quede por escrito para quien administre Play Console.

La prueba abierta tampoco es opción todavía: se habilita después de conseguir acceso a producción.

---

## Mensaje para los verificadores

> ¡Hola! 👋 ¿Me ayudas a probar VICINO, nuestra app? Necesitas un celular Android y 3 minutos.
>
> ⚠️ Dos cosas antes de empezar, que evitan casi todos los problemas:
> • Usa **la misma cuenta de Google** en todos los pasos: la que tienes en la Play Store de tu celular.
> • **No busques «VICINO» en la Play Store.** No aparece, porque todavía no es pública. Sólo se llega por estos enlaces.
>
> **1️⃣ Únete al grupo** (10 segundos, no te pide nada)
> https://groups.google.com/g/vicino-verificadores
> → toca «Unirse al grupo»
>
> **2️⃣ Acepta ser verificador** — este es el paso que cuenta
> https://play.google.com/apps/testing/com.vicino.mx
> → toca «Convertirse en verificador»
> → tiene que quedarte un sello verde que dice **«Ya eres verificador»** (o «You are a tester»). Si no lo ves, no quedó.
>
> **3️⃣ Instala la app**
> En esa misma pantalla verde, toca **«descárgala en Google Play»**.
> Si no lo ves, abre este enlace **en Chrome**: https://play.google.com/store/apps/details?id=com.vicino.mx
>
> 🙏 Lo único importante: **no la desinstales ni salgas de la prueba durante 2 semanas.** Google nos pide 14 días seguidos para poder publicarla. Y si puedes, ábrela unos minutos varios días: Google nos pregunta si la gente la usó de verdad. ¡Gracias!

### Por qué está escrito así

- **El aviso de la cuenta y de no buscar va arriba.** Es lo que más falla, y leerlo al final no sirve de nada.
- **El paso 2 dice qué tiene que ver al terminar**, con el texto exacto. Así puedes confirmar por WhatsApp si quedó, que es el dato que antes no tenías. Comprobado hoy con una cuenta real.
- **El paso 3 sale de la misma pantalla del paso 2.** Es un toque en lugar de abrir otro enlace, y evita que la persona acabe en la app de Play Store buscando.
- **El enlace de respaldo dice «en Chrome»**, que es lo que ya habías descubierto que funciona.
- **Fuera el «espera hasta 24 horas».** No es un plazo de Google, y le daba permiso a la gente para dejarlo para mañana.
- **Se pide uso real**, porque Google lo pregunta al final.

## Por qué nos quedamos con el Grupo de Google

Play Console también permite gestionar los verificadores con listas de direcciones de correo, y eso le quitaría el paso 1 a la persona. **No lo hacemos, y con razón:** exigiría tener el correo de cada uno antes de invitarla, y tú muchas veces no lo tienes. El grupo te deja mandar el mismo mensaje a quien sea, por WhatsApp o por donde sea, y que la persona entre sola.

Está configurado para eso y lo comprobé hoy: *cualquiera en la web puede unirse*, sin aprobación tuya, y el grupo es visible para todo el mundo. Puedes mandar el enlace a cien personas y no tienes que hacer nada por ninguna.

El paso 1 cuesta diez segundos y no pide datos. Es un precio pequeño por poder invitar a cualquiera.

## Lo que queda de tu lado

1. **Manda el mensaje nuevo** (abajo). Ya puedes.
2. **Si alguno de los 12 sigue sin poder instalar**, que abra este enlace y toque «Leave the program» / «Abandonar el programa»: https://play.google.com/apps/internaltest/4701655295868435015 — es el de la prueba interna, y sirve para soltar a quien se quedara enganchado ahí. Después que repita el paso 2.
3. **Agrupa los cambios nativos** en un mismo AAB para no encadenar revisiones. Subir uno no saca a nadie de la prueba.
4. **Añade la línea del autofoco al próximo AAB.** Ya está en el repo, entra sola en el siguiente build.
