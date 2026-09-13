// Guard de build: un aviso por DESPLIEGUE, no uno por isolate.
//
// El aviso en caliente de lib/rate-limit.ts se apoya en una variable de modulo,
// que en Vercel vive por isolate: acaba emitiendose una vez por arranque en
// frio, en los dos runtimes y en cada region. El build es el unico momento que
// ocurre exactamente una vez por despliegue, y ademas las variables de entorno
// de Vercel solo cambian con un redespliegue, asi que es el sitio correcto.
//
// NO falla el build a proposito: decidir si produccion puede salir sin freno es
// decision de Pedro, no de un script. Solo deja constancia.
const enProduccion = process.env.VERCEL_ENV === "production";
const faltan =
  !process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN;

if (enProduccion && faltan) {
  console.error(
    "[rate-limit][build] Este despliegue de PRODUCCION sale sin " +
      "UPSTASH_REDIS_REST_URL y/o UPSTASH_REDIS_REST_TOKEN. Todos los " +
      "limitadores de apps/web/lib/rate-limit.ts quedaran inactivos: login, " +
      "OTP, escrituras, busqueda, reportes y verificacion de documento " +
      "(que gasta OpenAI) aceptaran peticiones sin freno.",
  );
}

process.exit(0);
