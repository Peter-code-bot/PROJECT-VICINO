# Por qué la app no aparece a los verificadores

**Fecha:** 29 de septiembre de 2026
**Revisado hoy en:** Play Console, el Grupo de Google, la ficha pública, el manifiesto de Android y la documentación oficial de Google

---

## La causa más probable, y hay que arreglarla antes de mandar un solo mensaje

**Los 12 verificadores están dados de alta en la PRUEBA INTERNA, no en la cerrada.** Y eso, por regla oficial de Google, los deja fuera de la cerrada.

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

### Cómo se arregla

1. **Pausa el segmento de la prueba interna** (Prueba y lanza → Pruebas → Prueba interna → Pausar segmento). Así nadie más se da de alta ahí por error.
2. **Vacía sus listas de verificadores**, o al menos saca a los 12 que quieres en la cerrada.
3. **Cada persona que aceptó la prueba interna tiene que salirse**, abriendo el enlace de la prueba interna y eligiendo dejar el programa. Mientras siga dentro, Play le sirve la versión de junio y no cuenta.
4. Comprueba después con una de ellas que ya ve la versión **8 (1.7)** y no la 4 (1.3). Ese es el único indicador fiable de que quedó liberada.

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

## Cuidado con subir otro AAB durante los 14 días

Esto no lo estabas preguntando y es lo que más caro puede salir, porque estás publicando código todos los días.

Las versiones de prueba cerrada **también pasan revisión**:

> «Processing can take a few hours or up to seven days (or longer in exceptional cases).»
>
> — [Publicar versiones y actualizaciones](https://support.google.com/googleplay/android-developer/answer/9859654)

Y las cuentas nuevas se revisan más despacio a propósito:

> «For certain developer accounts, we'll take more time to thoroughly review your app... This may result in review times of **up to seven days** or longer in exceptional cases.»
>
> — [Tiempos de revisión](https://support.google.com/googleplay/android-developer/answer/9859751)

La cuenta de VICINO es personal y reciente, o sea justo ese perfil. Hoy la versión 8 (1.7) **ya está aprobada y disponible**, eso lo comprobé. Pero si subes un AAB 9 mientras los verificadores están instalando, esa subida **reabre la revisión** y puede dejarlos otra vez sin nada que instalar, en medio de la ventana de 14 días.

Regla práctica: **congela la pista cerrada mientras corren los 14 días.** Si hay que arreglar algo en la app, que vaya en la web (que se despliega sola) y guarda los cambios nativos para un AAB posterior. Y cuando toque subir uno, hazlo sabiendo que pueden pasar días antes de que nadie lo pueda instalar.

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

## Mensaje nuevo para los verificadores

> ¡Hola! 👋 ¿Me ayudas a probar VICINO, nuestra app? Necesitas un celular Android y 3 minutos.
>
> ⚠️ Dos cosas antes de empezar, que evitan casi todos los problemas:
> • Usa **la misma cuenta de Google** en los tres pasos: la que tienes en la Play Store de tu celular.
> • **No busques «VICINO» en la Play Store.** No va a aparecer, porque todavía no es pública. Sólo se llega por estos enlaces.
>
> **1️⃣ Únete al grupo** (10 segundos)
> https://groups.google.com/g/vicino-verificadores
> → toca «Unirse al grupo»
>
> **2️⃣ Acepta ser verificador** (este es el paso que cuenta, no te lo saltes)
> https://play.google.com/apps/testing/com.vicino.mx
> → toca «Convertirse en verificador»
> → te tiene que quedar una pantalla confirmando que ya eres verificador
>
> **3️⃣ Instala la app**
> Abre este enlace **en Chrome**, no en la app de Play Store:
> https://play.google.com/store/apps/details?id=com.vicino.mx
> → toca «Instalar»
>
> Si en el paso 3 dice que no está disponible, no es tu culpa: a veces tarda unas horas en activarse. Escríbeme y te aviso en cuanto puedas instalarla.
>
> 🙏 Lo único importante: **no la desinstales ni salgas de la prueba durante 2 semanas.** Google nos pide 14 días seguidos para poder publicarla. Y si puedes, ábrela unos minutos varios días: Google nos pregunta si la gente la usó de verdad. ¡Gracias!

### Qué cambió, y por qué

- **El aviso de la cuenta y de no buscar va arriba.** Es lo que más falla y leerlo al final no sirve de nada.
- **El paso 3 dice «en Chrome»**, no «en Play Store». Es lo que ya descubriste que funciona, y ahora está en el guion en vez de ser el plan B.
- **El paso 2 dice qué tiene que ver al terminar.** Así puedes confirmar por WhatsApp si lo completó de verdad, que es el dato que hoy no tienes.
- **Fuera el «espera hasta 24 horas».** No es un plazo de Google.
- **El plazo se presenta como tu problema, con salida:** que te escriba. Así no abandona en silencio.
- **Se pide uso real**, porque Google lo pregunta al final.

---

## Opcional, si quieres que sea aún más fácil: lista de correos en vez de grupo

Play Console permite gestionar los verificadores de la cerrada con **listas de direcciones de correo** en lugar del Grupo de Google. Eso **le quita el paso 1 al verificador**: tú pegas su correo en la consola y la persona sólo se da de alta e instala.

- Menos pasos, menos abandono, y desaparece el fallo de orden.
- Coste: le pides el correo por WhatsApp antes de mandarle el enlace.
- Ojo: cambiar la configuración es un «cambio adicional», así que puede tardar varias horas en propagarse. Si lo haces, hazlo de una vez y no la víspera de mandar los mensajes.

Para 12 o 20 personas, vale la pena.

---

## Qué hacer ya, en orden

1. **Libera a los 12 de la prueba interna.** Pausa el segmento, vacía sus listas, y que quien la aceptó se salga. Sin esto, lo demás no arregla nada.
2. **Comprueba con una persona** que ya ve la versión 8 (1.7) y que el paso 2 le confirma que es verificador.
3. **Manda el mensaje nuevo**, con el aviso de «no busques» arriba.
4. **Añade la línea del autofoco** al manifiesto para el próximo AAB.
5. **Decide si pasas a lista de correos** para quitarle un paso a la gente.
6. **No subas otro AAB hasta que pasen los 14 días**, salvo que sea imprescindible.
