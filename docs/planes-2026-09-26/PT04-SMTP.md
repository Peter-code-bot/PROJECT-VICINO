# Plan PT04-SMTP

**Pendiente:** PT04: SMTP propio, límites de Auth, captcha y plantilla OTP en producción

**Fuentes en Notion:** A l.20 (PT04-auth-smtp-otp); C l.402 (PT04-smtp-limites-auth); D l.818,838,853 (S02-smtp-gotrue-config); E l.1190 (D01-S02A-06-auth-smtp, parte SMTP); H l.36 (H36-login-correo-enlace)

**Estado conciliado (26-sep ~23:30):** pendiente. PENDIENTES PT04: smtp_host null, 2 correos/h para todo el proyecto, sin captcha. scripts/aplicar-config-otp.mjs aplica el SMTP de Resend con RESEND_SMTP_PASS. bced307 pasó al código de 6 dígitos (verifyOtp), pero no consta que la plantilla con {{ .Token }} esté aplicada en prod. Sin UPSTASH_*, subir el techo abre mail bombing.

**Qué falta:** Plan: (1) Claude, solo lectura: GET /v1/projects/oxxdkwywprkfghhbnoto/config/auth sin imprimir el token; anotar smtp_host, rate_limit_email_sent, mailer_otp_exp/length, captcha y la plantilla Confirm signup (cierra H36). (2) Pedro: dominio vicinomarket.com verificado en Resend (SPF, DKIM, DMARC) y clave SMTP por variable segura, nunca en el chat. (3) Pedro corre aplicar-config-otp.mjs y activa el captcha ANTES de subir rate_limit_email_sent a un valor moderado, junto con Upstash (PT09-rate-limits). (4) Smoke con un buzón de prueba propio: registro, reenvío y recuperación. (5) D01-S02 y D02 de configuración con reversión. Fecha: 27-sep.

## Objetivo

Que el correo de Auth en producción salga por SMTP propio (Resend, no-reply@vicinomarket.com). El techo de correos debe quedar en un valor moderado y protegido por captcha y Upstash. El correo de confirmación debe llevar el código de 6 dígitos que ya espera la interfaz (LARGO_CODIGO=6, en prod desde bced307, que está dentro de 4b6be86). Se cierra PT04 (SMTP/límites) y H36, con evidencia en D01-S02. CORRIGE EL ORDEN DEL PLAN COMPUTADO: hoy no se puede activar el captcha antes de tocar código. Ningún archivo de apps/web envía captchaToken (grep de captcha, hcaptcha y turnstile: 0 resultados). GoTrue exige ese token en /signup, en /token con password, en /resend y en /recover. Encenderlo tal cual deja sin login, registro, reenvío ni recuperación por correo a todo el mundo, en la web y en la app, porque la app carga vicinomarket.com. Primero va el widget en el código y después el interruptor.

## Pasos

1. 1. [Claude, hoy, solo lectura] Leer la config de prod: GET /v1/projects/oxxdkwywprkfghhbnoto/config/auth, con el token del .env y sin imprimirlo. Se puede usar 'node scripts/aplicar-config-otp.mjs --ver' sin RESEND_SMTP_PASS, que solo compara los campos mailer_*, más una lectura aparte con lista blanca. Anotar smtp_host, smtp_admin_email, rate_limit_email_sent, rate_limit_otp, rate_limit_verify, smtp_max_frequency, mailer_otp_length, mailer_otp_exp, mailer_subjects_confirmation, security_captcha_enabled, security_captcha_provider y site_url. Anotar también si la plantilla Confirm signup es igual a PLANTILLA y termina en '@vicinomarket.com #{{ .Token }}'. Nunca imprimir smtp_pass, security_captcha_secret ni otro campo *_secret o *_key.
2. 2. [Claude] Decidir con lo leído. Si mailer_otp_length no es 6 o la plantilla no lleva {{ .Token }}, el registro en prod está roto hoy (P0): Pedro corre aplicar-config-otp.mjs SIN RESEND_SMTP_PASS, que solo toca largo, vigencia y plantilla, y el mismo día. Si ya son 6 y la plantilla está puesta, H36 queda pendiente solo del smoke del paso 11.
3. 3. [Pedro, decisión] Elegir proveedor: hCaptcha, que ya está preseleccionado en el panel, o Turnstile. Fijar el valor de rate_limit_email_sent: el script trae 60 fijo en la l.145 y la propuesta es 30. Confirmar el remitente no-reply@vicinomarket.com (SMTP_REMITENTE) y si staging tendrá su propio SMTP de Resend.
4. 4. [Claude, rama feat/pt04-captcha] En apps/web/app/(auth)/actions.ts, las acciones signInWithPassword, signUp, reenviarCodigo y requestPasswordReset aceptan captchaToken?: string, validado como cadena acotada. Lo pasan a GoTrue: options.captchaToken en signInWithPassword, signUp y resend, y {redirectTo, captchaToken} en resetPasswordForEmail. verificarCodigo no cambia, porque /verify no pide captcha.
5. 5. [Claude] Crear apps/web/lib/auth/captcha.ts. Lee NEXT_PUBLIC_CAPTCHA_SITEKEY; si falta, no hay widget y el token queda undefined, lo cual no hace daño mientras Supabase tenga el captcha apagado. Traduce el error 'captcha verification process failed' a un mensaje amable y lo manda a Sentry con su tag.
6. 6. [Claude] Crear apps/web/components/auth/captcha-invisible.tsx en modo invisible: se ejecuta al enviar y se reinicia después de cada intento, porque el token es de un solo uso y conTope reintenta. Conectarlo en login-form.tsx, register-form.tsx, verificar-codigo.tsx (solo el botón de reenviar) y forgot-password/page.tsx sin tocar el layout. Si el proveedor exige un aviso de texto visible, el texto y su ubicación se entregan a Javier: no se diseña aquí.
7. 7. [Claude] En apps/web/next.config.ts, CSP Report-Only: añadir los dominios del proveedor a script-src, connect-src y style-src, y crear frame-src, que hoy cae en default-src 'self'. Añadir la dependencia del widget en apps/web/package.json y NEXT_PUBLIC_CAPTCHA_SITEKEY en .env.example.
8. 8. [Claude] Staging. Con assertNoProd, un PATCH a la config/auth de staging para encender el captcha con el secreto de PRUEBA del proveedor. En scripts/staging/fixtures.mjs l.61, el login con grant_type=password pasa gotrue_meta_security.captcha_token con el token de prueba. Nuevo scripts/staging/e2e-auth-captcha.mjs: sin token, /signup, /token con password, /recover y /resend dan 400 de captcha. Con dev-contra-staging.mjs y la sitekey de prueba, el login por la UI entra, el registro llega a la pantalla de código y el código se verifica con el email_otp de /auth/v1/admin/generate_link, sin buzón real. El reenvío y la recuperación responden sin error de captcha.
9. 9. [Claude] Pasar el CODEX review loop, que es obligatorio en auth, y después type-check, lint, pnpm build (check-rutas) y las pruebas. En el mismo commit, corregir docs/PENDIENTES-PEDRO-2026-09-12.md (l.147): el captcha exige el código antes del interruptor.
10. 10. [Pedro, autorización de prod] Merge y deploy del código con NEXT_PUBLIC_CAPTCHA_SITEKEY real en Vercel (Production). Con el captcha todavía apagado en Supabase, comprobar en la web y en la app que el login funciona y que la petición lleva el token. Después, Upstash en Vercel más redeploy (PT09); 'node scripts/verificar-rate-limit.mjs' tiene que decir FRENO VIVO.
11. 11. [Pedro] Activar el captcha en Supabase prod (Authentication > Bot and Abuse Protection). El secreto se pega solo en el panel, nunca en el chat. Enseguida, login con correo en la web, en Android y en iPhone. Reversión: apagar el interruptor (1 min).
12. 12. [Pedro] En Resend: vicinomarket.com verificado con SPF (un solo registro SPF; si ya hay otro, se fusiona), DKIM (resend._domainkey) y DMARC en p=none al principio. Crear una API key solo de envío para ese dominio. Si eligió un valor distinto de 60, Claude cambia antes la l.145 del script. Después, 'node scripts/aplicar-config-otp.mjs --ver', y luego aplicar con Read-Host -AsSecureString y Remove-Item Env:\RESEND_SMTP_PASS, como en la cabecera del script. Guardar la salida 'antes' para poder revertir.
13. 13. [Pedro, buzón de prueba propio, no la cuenta de un usuario real] Smoke en prod, en la web y en la app. Registro nuevo: llega de no-reply@vicinomarket.com con SPF y DKIM en pass ('mostrar original') y 6 dígitos; en iOS aparece el autorrelleno. Luego código incorrecto, reenvío pasados 60 s, recuperación de contraseña y correo ya registrado (pantalla neutral). Por último, tres registros en la misma hora que reciben código los tres: eso prueba que el techo de 2/h desapareció. Borrar las cuentas de prueba requiere su firma.
14. 14. [Claude] Escribir D01-S02 (Auth/SMTP real) con los valores antes y después, los SHA, las reversiones y la evidencia del smoke, y D02 de configuración. Marcar PT04 SMTP/límites en docs/PENDIENTES-2026-09-26.md y cerrar H36 en Notion.

## Archivos

- C:/Users/pedro/Projects/startup-marketplace/apps/web/app/(auth)/actions.ts
- C:/Users/pedro/Projects/startup-marketplace/apps/web/app/(auth)/login/login-form.tsx
- C:/Users/pedro/Projects/startup-marketplace/apps/web/app/(auth)/register/register-form.tsx
- C:/Users/pedro/Projects/startup-marketplace/apps/web/app/(auth)/register/verificar-codigo.tsx
- C:/Users/pedro/Projects/startup-marketplace/apps/web/app/(auth)/forgot-password/page.tsx
- C:/Users/pedro/Projects/startup-marketplace/apps/web/lib/auth/captcha.ts (nuevo)
- C:/Users/pedro/Projects/startup-marketplace/apps/web/lib/auth/captcha.test.ts (nuevo)
- C:/Users/pedro/Projects/startup-marketplace/apps/web/components/auth/captcha-invisible.tsx (nuevo)
- C:/Users/pedro/Projects/startup-marketplace/apps/web/next.config.ts
- C:/Users/pedro/Projects/startup-marketplace/apps/web/package.json
- C:/Users/pedro/Projects/startup-marketplace/.env.example
- C:/Users/pedro/Projects/startup-marketplace/scripts/aplicar-config-otp.mjs
- C:/Users/pedro/Projects/startup-marketplace/scripts/staging/fixtures.mjs
- C:/Users/pedro/Projects/startup-marketplace/scripts/staging/e2e-auth-captcha.mjs (nuevo)
- C:/Users/pedro/Projects/startup-marketplace/docs/PENDIENTES-2026-09-26.md
- C:/Users/pedro/Projects/startup-marketplace/docs/PENDIENTES-PEDRO-2026-09-12.md

## Pruebas

- Unitaria con jiti, apps/web/lib/auth/captcha.test.ts: sin sitekey no hay token; el error de captcha de GoTrue se traduce a un mensaje amable; un token vacío o demasiado largo se rechaza.
- Regresión: './node_modules/.bin/tsx scripts/test-otp.ts' sigue en verde, y también scripts/test-destino-seguro.ts.
- pnpm type-check, pnpm lint y pnpm build (incluye check-rutas) antes del push.
- E2E contra staging, scripts/staging/e2e-auth-captcha.mjs: con el captcha encendido y sin token, 400 en /signup, /token?grant_type=password, /recover y /resend. Con el token de prueba, login por la UI, registro, verificación con email_otp de admin/generate_link, reenvío y recuperación. Se vuelve a correr e2e-campus-home.mjs para confirmar que las fixtures siguen entrando.
- Solo lectura en prod, antes y después: el GET de config/auth con lista blanca coincide con lo aplicado (smtp_host=smtp.resend.com, rate_limit_email_sent con el valor decidido, security_captcha_enabled=true, mailer_otp_length=6, plantilla con {{ .Token }}).
- Tras el paso 10, 'node scripts/verificar-rate-limit.mjs' dice FRENO VIVO.
- Smoke manual de Pedro con su buzón de prueba, en web, Android e iPhone: registro, código incorrecto, reenvío, recuperación, correo ya existente, tres altas en una hora y cabeceras SPF/DKIM en pass.

## Riesgos

- Encender el captcha en Supabase antes de desplegar el widget tumba el login, el registro, el reenvío y la recuperación por correo en la web y en la app. El OAuth sigue vivo porque usa pkce. El orden 10 → 11 no es negociable.
- Si mailer_otp_length en prod no es 6, el registro ya está roto hoy: la interfaz solo acepta 6 dígitos. El paso 1 lo detecta.
- mailer_otp_exp=600 es un campo único: también deja en 10 minutos el enlace de recuperación de contraseña.
- El captcha en el WebView de Android y de iOS puede fallar o quedar cortado a 360 px. Hay que probarlo en dispositivo antes del paso 11.
- El token es de un solo uso: si no se reinicia tras cada intento, el reintento de conTope o un segundo envío fallan con error de captcha.
- Si el proveedor exige un aviso de texto visible, eso cambia la apariencia: la ubicación la decide Javier.
- Las fixtures de staging (l.61, token con password) y apps/web/tests/seed.spec.ts dejan de entrar si el entorno activa el captcha sin el token de prueba.
- En DNS: un SPF duplicado invalida los dos, DMARC en p=reject antes de tiempo manda correo legítimo a rechazo, y un dominio recién verificado puede caer en spam.
- La clave SMTP nunca va en el chat ni en el historial de PSReadLine; el script ya obliga a usar Read-Host -AsSecureString.
- Una cuenta de prueba en prod deja una fila en auth.users. delete-account no está desplegada, así que borrarla requiere la firma de Pedro.

## Requiere antes

- Decisión de Pedro: proveedor de captcha (hCaptcha o Turnstile) y valor de rate_limit_email_sent (el script trae 60 fijo).
- Upstash en Vercel Production (PT09-rate-limits) antes de subir el techo de correos.
- Acceso de Pedro a Resend, al DNS de vicinomarket.com, al panel de Supabase prod y a Vercel.
- Autorización explícita de Pedro para el merge y deploy a prod y para cada cambio de config/auth en prod.
- Un Android y un iPhone con la app, para ver el captcha en el WebView y el autorrelleno del código.
- Un buzón de prueba propio de Pedro (alias), nunca la cuenta de un usuario real ni del seed.
- Staging vivo (.staging/staging.json) para el paso 8.

**Responsable:** Pedro (consolas de Resend, DNS, Supabase y Vercel; autorización de prod; smoke). Claude hace la lectura del paso 1, el código del captcha, staging y la documentación.

**Estimación:** Claude: 15 min para la lectura; 3 a 4 h para código y review; 2 h para staging E2E; 30 min para documentación. Pedro: 1 a 1.5 h de consolas y 45 min de smoke. Arranca el 27-sep; si el dominio aún no está verificado en Resend, la propagación DNS puede empujar el SMTP al 28-sep.

**Ejecutable por Claude ahora:** sí
