# Plan PT09-rate-limits

**Pendiente:** PT09: los limitadores de la app son no-op sin Upstash (login, OTP, feed, reportes, preview)

**Fuentes en Notion:** A l.22 (PT09-rate-limits); B l.302-309 (PT09-completo-backend, Upstash); C l.439-440 (PT09-limites-login-otp-redis), l.413 (PT05-preview-privacidad, nota)

**Estado conciliado (26-sep ~23:30):** pendiente. apps/web/lib/rate-limit.ts:27-31: sin UPSTASH_REDIS_REST_URL/TOKEN todos son no-op (48/48 respuestas 200 el 27-ago). Existe scripts/verificar-rate-limit.mjs.

**Qué falta:** Plan: Claude arma ya, en solo lectura, la tabla límite → código → configuración viva → efecto real. Pedro crea la base de Upstash, carga las 2 variables en Vercel (production) y redespliega. Después correr verificar-rate-limit.mjs contra prod: 429 en /auth/callback-server tras 20/min. Alternativa: cuotas en la base (migración con permiso). Los límites de Auth van con PT04-SMTP.

## Objetivo

Que los 16 limitadores de apps/web/lib/rate-limit.ts frenen de verdad en producción (login, OTP, escrituras, feed, home y /buscar, reportes, minimapa, MapKit), sin añadir latencia cuando Upstash falle. La prueba es de comportamiento: node scripts/verificar-rate-limit.mjs debe decir FRENO VIVO y cortar en la petición 21. Revisar el panel no basta como prueba.

## Pasos

1. 1. Claude, en solo lectura y ya armada: tabla límite → código → configuración viva → efecto real. Son 16 limitadores con ventana deslizante. authRateLimit (5/15m, auth:{accion}:{ip}, (auth)/actions.ts:56) devuelve un error en la acción. oauthCallbackRateLimit (20/1m, {ip}, proxy.ts:60) responde 303 a /login?error=too_many_requests. writeRateLimit (30/1m, write:{uid}, unas 50 acciones más api/account/delete). chatReadRateLimit (60/1m). readHeavyRateLimit (60/1m) tiene cuatro cubos: pagina:{ip} en proxy.ts:95 para / y /buscar (429 con Retry-After 60), feed:{ip}, sesion:{ip} en /api/session y read:{ip} en comunidades y geo. adminSecurity (10/15m). productMap (20/1m). report (10/1h por cuenta) y reportIp (30/1h). verificacion (5/1h). Cuatro de OTP: verificar 10/15m por correo y 30/15m por IP; reenviar 5/1h por correo y 15/1h por IP. mapkitToken (60/5m) y mapkitTokenAnon (15/5m). Configuración viva: ninguna, según el 12-sep; hoy se reconfirma en el paso 2. Efecto real hoy: cero. Solo actúan los suelos por isolate (minimapa 20/min con freno-en-memoria y MapKit 30/min) y la cuota de IA en Postgres (consumir_cuota_verificacion_ia, que falla cerrado).
2. 2. Línea base de hoy. Claude corre node scripts/verificar-rate-limit.mjs contra vicinomarket.com: son 48 GET sin code a /auth/callback-server, inofensivos, y se espera SIN FRENO con salida 1. Pedro corre vercel env ls production y confirma que no existen UPSTASH_REDIS_REST_* ni KV_REST_API_*.
3. 3. Claude, en la rama fix/rate-limit-encendido, archivo apps/web/lib/rate-limit.ts: en makeLimiter pasar timeout: 1000. El default de @upstash/ratelimit 2.0.8 es 5000 ms, y proxy.ts espera a check() en cada / y /buscar. Además Redis.fromEnv({ retry: { retries: 1 } }), porque el default son 5 reintentos con espera e^n·50 ms. Se mantiene el fail-open y no cambia ningún tope ni ningún call site.
4. 4. Mismo archivo: que hasUpstash acepte también KV_REST_API_URL/KV_REST_API_TOKEN, que Redis.fromEnv() ya lee como alternativa. Hoy, si Pedro usa la integración de Vercel Marketplace, esos nombres dejan los limitadores en no-op. Replicarlo en apps/web/scripts/check-rate-limit-env.mjs y añadir los dos nombres a tasks.build.env de turbo.json.
5. 5. scripts/staging/dev-contra-staging.mjs: hoy vacía UPSTASH_* a propósito. Pasa a opt-in: solo usa un Upstash de pruebas si .staging/staging.json trae upstashUrl y upstashToken. Por defecto sigue vacío.
6. 6. Opcional, en scripts/verificar-rate-limit.mjs: añadir el flag --pagina, que hace 61 GET a / y espera 429 con Retry-After: 60 en la #61. Sin el flag sigue haciendo solo el callback, como ahora.
7. 7. Claude escribe apps/web/lib/rate-limit.test.ts (node:test, con el mismo runner que lib/freno-en-memoria.test.ts) y corre las compuertas: type-check, eslint de los archivos tocados y build local con VERCEL_ENV=production sin variables, donde el guard avisa y sale con 0.
8. 8. Claude hace la prueba en local contra staging con una base Upstash de pruebas, solo si Pedro la crea: node scripts/staging/dev-contra-staging.mjs y luego node scripts/verificar-rate-limit.mjs http://localhost:3100. Se espera FRENO VIVO con la primera frenada en la #21. Después, a mano, 4 intentos de login fallidos pasan y el 6.º muestra el mensaje de enforce().
9. 9. Pedro autoriza el push. Desde 6ee06be, master se despliega solo a producción. Después, Claude corre node scripts/smoke-produccion.mjs en verde.
10. 10. Pedro, en console.upstash.com: crear una base Redis regional en us-west-2 (Oregon), junto a pdx1, que es la región de Vercel según apps/web/vercel.json. Esto corrige el us-west-1 de docs/PENDIENTES-PEDRO-2026-09-12.md. Plan Free, o PAYG con tope de presupuesto. Usar el token de lectura-escritura, no el read-only.
11. 11. Pedro, en Vercel → Settings → Environment Variables: dar de alta UPSTASH_REDIS_REST_URL y UPSTASH_REDIS_REST_TOKEN con alcance Production. Se escriben en el panel, nunca en el chat ni en la terminal. Después, Redeploy del último despliegue de producción y comprobar que queda en Ready.
12. 12. Verificación en producción. Claude corre node scripts/verificar-rate-limit.mjs y debe salir FRENO VIVO con la primera frenada en la #21. Pedro comprueba tres cosas: que el log del build ya no trae [rate-limit][build], que el Data Browser de Upstash muestra claves rl:oauth-cb:* y que en Sentry deja de entrar el warning 'NO HAY LIMITE DE PETICIONES'.
13. 13. Registro: marcar como hecho PT09 en docs/PENDIENTES-2026-09-26.md:242 y en Notion, con la salida del script, y corregir la región en PENDIENTES-PEDRO-2026-09-12.md. Anotar lo que Upstash no cubre: los Rate Limits de Supabase Auth (van con PT04-SMTP) y el RPC search_nearby_products_v4 llamado directo por PostgREST con la anon key (ítem de catálogo REST/RPC de PT09).
14. 14. Seguimiento a 7 días en Upstash Analytics (analytics: true ya está puesto): revisar bloqueos de IPs legítimas por CGNAT y los comandos consumidos contra los 500k/mes del plan Free. Si aparecen falsos positivos, se sube el tope del cubo; no se apaga el limitador.

## Archivos

- C:/Users/pedro/Projects/startup-marketplace/apps/web/lib/rate-limit.ts
- C:/Users/pedro/Projects/startup-marketplace/apps/web/lib/rate-limit.test.ts (nuevo)
- C:/Users/pedro/Projects/startup-marketplace/apps/web/scripts/check-rate-limit-env.mjs
- C:/Users/pedro/Projects/startup-marketplace/turbo.json
- C:/Users/pedro/Projects/startup-marketplace/scripts/staging/dev-contra-staging.mjs
- C:/Users/pedro/Projects/startup-marketplace/scripts/verificar-rate-limit.mjs (opcional, flag --pagina)
- C:/Users/pedro/Projects/startup-marketplace/docs/PENDIENTES-2026-09-26.md
- C:/Users/pedro/Projects/startup-marketplace/docs/PENDIENTES-PEDRO-2026-09-12.md
- Solo lectura, no se tocan: apps/web/proxy.ts, app/(auth)/actions.ts y el resto de call sites de enforce() y check()

## Pruebas

- Unitarias, archivo nuevo apps/web/lib/rate-limit.test.ts, sin red:
- enforce(null) devuelve ok:true y check(null) devuelve success:true.
- Un limitador falso que responde {success:false} hace que enforce devuelva ok:false con el mensaje 'Demasiadas solicitudes...'.
- Un limitador falso que lanza hace que enforce y check fallen abiertos.
- Con UPSTASH_* ficticias puestas antes del import dinámico, los 16 limitadores no son null y tienen timeout === 1000; solo con KV_REST_API_* también están activos, y sin ninguna de las dos son null.
- Compuertas: pnpm --filter web type-check, eslint de los archivos tocados, y build local con VERCEL_ENV=production sin variables, donde check-rate-limit-env.mjs imprime el aviso y sale con 0; también con solo KV_REST_API_* no imprime aviso.
- Local contra staging con un Upstash de pruebas: node scripts/verificar-rate-limit.mjs http://localhost:3100 da FRENO VIVO con la primera frenada en la #21, y el login frena al 6.º intento fallido de la misma IP.
- Producción antes (línea base): node scripts/verificar-rate-limit.mjs da SIN FRENO con salida 1.
- Producción después del push, sin variables todavía: node scripts/smoke-produccion.mjs en verde, sin regresión.
- Producción después del redeploy con variables: node scripts/verificar-rate-limit.mjs da FRENO VIVO con 303 a /login?error=too_many_requests desde la #21. Aparecen claves rl:* en Upstash, el log del build no trae el aviso y Sentry deja de recibir el warning.
- Opcional, solo con OK de Pedro porque renderiza el home 61 veces en prod: node scripts/verificar-rate-limit.mjs --pagina da 429 con Retry-After: 60 en la #61.

## Riesgos

- Si Upstash va lento o está caído, @upstash/ratelimit 2.0.8 espera hasta 5000 ms antes de fallar abierto. Eso retrasaría cada carga de / y /buscar (proxy.ts) y cada Server Action. Se mitiga con timeout: 1000 en makeLimiter.
- Nombres de variables: la integración de Vercel Marketplace inyecta KV_REST_API_URL y KV_REST_API_TOKEN. Redis.fromEnv() los lee, pero hasUpstash solo mira UPSTASH_*, así que todo seguiría en no-op. Se mitiga con el paso 4, o creando las dos variables a mano con los nombres exactos.
- Con el token read-only de Upstash cada limit() falla y el código falla abierto sin avisar (solo un console.warn), así que no habría freno. Solo lo detecta verificar-rate-limit.mjs.
- Región: docs/PENDIENTES-PEDRO-2026-09-12.md dice us-west-1, pero Vercel corre en pdx1, que es us-west-2. Una base en otra región suma latencia a cada petición que pasa por el limitador.
- Falsos positivos por CGNAT (Telcel e Izzi): el login permite 5 intentos cada 15 min por IP y acción, y el cubo pagina 60/min por IP cuenta también los prefetch RSC. Hay que vigilar Upstash Analytics y subir topes; no apagar.
- La cuota del plan Free es de 500k comandos al mes y el freno de / y /buscar cuenta cada visita y cada prefetch. Si se agota, los errores hacen fallar abierto en silencio. Revisar el consumo a los 7 días y pasar a PAYG con tope si se acerca.
- /login no muestra ?error=too_many_requests (nada lo lee fuera de proxy.ts): quien cae en el freno del callback ve el login sin explicación. Mostrarlo es superficie visual, así que se anota para Javier; no bloquea.
- Upstash no cubre las llamadas directas a Supabase con la anon key (Auth y el RPC search_nearby_products_v4 por PostgREST). Eso se resuelve en PT04-SMTP (Rate Limits de Auth) y en el ítem de catálogo REST/RPC de PT09.
- Secretos: el token no se pega en el chat ni se pasa inline en PowerShell, donde queda en el historial de PSReadLine; se carga solo en el panel de Vercel.
- El script de verificación contra producción gasta la cuota del callback de la IP de quien lo corre durante 1 minuto; no afecta a otros usuarios.

## Requiere antes

- Pedro: cuenta de Upstash para crear la base Redis regional en us-west-2 (Oregon).
- Pedro: acceso a Vercel (Settings → Environment Variables, Production) y a Redeploy.
- Autorización explícita de Pedro para el push a master: desde 6ee06be (ignoreCommand retirado), master se despliega solo a producción.
- Decisión de Pedro: encender Upstash después del commit de endurecimiento (recomendado, con timeout de 1 s) o ya, sobre el código actual (timeout de 5 s por defecto).
- Opcional: una segunda base Upstash para las pruebas contra staging, si el plan la permite.

**Responsable:** Pedro: base de Upstash, variables en Vercel, redeploy y autorización del push a master. Claude: tabla, endurecimiento de rate-limit.ts, pruebas y verificación por comportamiento.

**Estimación:** Claude, de 1,5 a 2 h: código de los pasos 3 a 6, pruebas y verificación. Pedro, de 20 a 30 min: Upstash, Vercel y redeploy. En total unas 2,5 h de trabajo, que se pueden cerrar en el día si Pedro está disponible. El seguimiento de 7 días es aparte.

**Ejecutable por Claude ahora:** sí
