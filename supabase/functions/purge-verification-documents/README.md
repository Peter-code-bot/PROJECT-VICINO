# purge-verification-documents — código recuperado, no original

**`index.ts` de esta carpeta se recuperó del bundle desplegado en producción, no de un commit.**

## Qué pasó

Esta función lleva desplegada y activa desde el 25 de agosto de 2026, borrando documentos de
identidad del bucket `verification-documents` cada hora — y **nunca existió en el repositorio**.
Se buscó en toda la historia de git (`git rev-list --all`) y no aparece en ningún commit de
ninguna rama. Las otras cinco Edge Functions sí coinciden byte a byte con lo desplegado; solo
esta faltaba.

Consecuencias mientras faltó:

- El repositorio no podía reconstruir producción. Un entorno nuevo quedaba con un cron horario
  apuntando a una función inexistente.
- Nadie revisó en un PR las ~440 líneas de código que borran documentos de identidad de forma
  irreversible.
- El compromiso del Aviso de Privacidad §15 que el propio código cita en su cabecera no era
  auditable: no había nada que auditar.

Su migración, `20260825000001_verification_document_purge.sql` —que la propia cabecera del
código menciona— tampoco está en `supabase/migrations/`, y su versión se limpió del ledger el
26 de agosto por ser una fila huérfana sin archivo. La tabla de log que crea,
`verification_document_purge_log`, sí existe en producción.

## Cómo se recuperó

`GET /v1/projects/<ref>/functions/purge-verification-documents/body` devuelve el bundle eszip
(~290 KB). Dentro, el módulo propio viaja **sin minificar y con sus comentarios**; lo que le
sigue es `supabase-js` ya minificado. El corte se hizo emparejando paréntesis desde
`Deno.serve(`, ignorando los que caen dentro de cadenas y comentarios.

El archivo se dejó **fiel a lo desplegado**, sin añadirle cabeceras ni reformatearlo, para que
un diff futuro contra el bundle siga siendo significativo. Por eso esta nota va aparte.

## Antes de volver a desplegarla

`index.ts` es código **transpilado**, no necesariamente idéntico al fuente que alguien escribió.
Puede diferir en tipos borrados, en azúcar sintáctico o en el formato. Un `supabase functions
deploy` con este archivo produciría una versión que **no** se ha comparado con la que corre hoy.

Antes de desplegar:

1. Buscar el original. Puede seguir vivo en la máquina de quien la escribió, o en el historial
   de la sesión donde se generó.
2. Si no aparece, leer estas 436 líneas completas. Borran archivos de identidad de forma
   irreversible y ponen a `NULL` las URLs de `seller_verification`.
3. Probarla en una rama de Supabase con datos, nunca contra producción. Tiene `dry_run: true`
   en el cuerpo justamente para eso.

## Estado verificado el 26 de agosto de 2026

- Desplegada y **funcionando**: HTTP 200 en la corrida real de las 06:07 UTC,
  `{"ok":true,"dry_run":false,"resolved_rows_purged":0}`.
- Estuvo caída hasta esa mañana: devolvía 500 porque leía `SB_SECRET_KEY`, una variable que
  nunca se creó. `createClient()` recibía `undefined` y lanzaba **fuera** del `try`, de ahí el
  `Internal Server Error` genérico en vez del JSON propio de la función.
- El bucket está vacío y `verification_document_purge_log` tiene 0 filas en toda su historia.
  Las tres verificaciones de junio ya tenían las URLs en `NULL` antes de que la función llegara
  a correr: alguien las limpió a mano.
