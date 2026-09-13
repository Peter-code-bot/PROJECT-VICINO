#!/usr/bin/env node
/**
 * Comprueba POR COMPORTAMIENTO que el limite de peticiones de produccion esta
 * vivo. Mirar el panel de Vercel no cuenta: lib/rate-limit.ts falla abierto por
 * diseno (sin credenciales, o con credenciales muertas, deja pasar todo y
 * solo avisa a Sentry una vez).
 *
 *   node scripts/verificar-rate-limit.mjs                 # contra vicinomarket.com
 *   node scripts/verificar-rate-limit.mjs https://otro    # contra un preview
 *
 * Dispara 48 peticiones seguidas a /auth/callback-server, cuyo limite declarado
 * es 20 por minuto y por IP (apps/web/proxy.ts). A partir de la 21.a, el
 * middleware responde 303 a /login?error=too_many_requests (no un 429 crudo:
 * ver el comentario de tooManyRequests en proxy.ts). Si las 48 pasan con el
 * mismo codigo que las primeras, NO hay freno.
 *
 * Es inofensivo: la ruta sin `code` no intercambia nada y responde con un
 * redirect de error. Medido el 27-ago-2026 y el 12-sep-2026: 48 de 48 sin
 * freno, porque Vercel no tiene UPSTASH_REDIS_REST_URL/TOKEN.
 */

const base = (process.argv[2] || "https://vicinomarket.com").replace(/\/$/, "");
const TOTAL = 48;
const LIMITE = 20;
const url = `${base}/auth/callback-server`;

const respuestas = [];
for (let i = 0; i < TOTAL; i++) {
  const r = await fetch(url, { redirect: "manual", headers: { "user-agent": "vicino-verificar-rate-limit" } });
  respuestas.push({ n: i + 1, status: r.status, location: r.headers.get("location") ?? "" });
}

const frenadas = respuestas.filter((r) => r.status === 303 && /too_many_requests/.test(r.location));
const primera = frenadas[0]?.n ?? null;
const resumen = respuestas.reduce((m, r) => ((m[r.status] = (m[r.status] || 0) + 1), m), {});

console.log(`Objetivo: ${url}`);
console.log(`Respuestas por codigo: ${JSON.stringify(resumen)}`);
console.log(`Frenadas (303 -> /login?error=too_many_requests): ${frenadas.length} de ${TOTAL}${primera ? `, la primera fue la #${primera}` : ""}`);

if (frenadas.length === 0) {
  console.log("\nSIN FRENO: las 48 pasaron. Faltan o no sirven las credenciales de Upstash en Vercel (Production), o no se ha hecho redeploy desde que se pusieron.");
  process.exit(1);
}
if (primera && primera <= LIMITE) {
  console.log(`\nOJO: freno antes de la peticion ${LIMITE + 1} (en la #${primera}). Otra IP compartida pudo gastar cuota, o el limite configurado no es 20/min.`);
}
console.log("\nFRENO VIVO: el limite de peticiones responde en produccion.");
