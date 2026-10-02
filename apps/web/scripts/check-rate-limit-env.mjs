// Guard de build: un aviso por DESPLIEGUE, no uno por isolate.
//
// El aviso en caliente de lib/rate-limit.ts se apoya en una variable de modulo,
// que en Vercel vive por isolate: acaba emitiendose una vez por arranque en
// frio, en los dos runtimes y en cada region. El build es el unico momento que
// ocurre exactamente una vez por despliegue, y ademas las variables de entorno
// de Vercel solo cambian con un redespliegue, asi que es el sitio correcto.
//
// Registration now requires the limiter before its explicit email lookup.
// A production build without it would disable signup for everyone.
const enProduccion = process.env.VERCEL_ENV === "production";
const faltan =
  !process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN;

if (enProduccion && faltan) {
  console.error(
    "[rate-limit][build] Registro requiere UPSTASH_REDIS_REST_URL y UPSTASH_REDIS_REST_TOKEN. Configure ambas antes de publicar a PRODUCCION.",
  );
  process.exit(1);
}

process.exit(0);
