// Temporary release hold: this transfer contains S04, but production was
// checked on 2026-09-26 and chats.producto_revision is still absent (42703).
// Remove this file AND ignoreCommand from vercel.json only after applying and
// verifying 20260925010000_chat_producto_y_venta_atomica.sql and real flows.
// Vercel ignoreCommand: exit 0 cancels deployment, exit 1 builds normally.
const target = process.env.VERCEL_ENV;
const branch = process.env.VERCEL_GIT_COMMIT_REF;
const preview = target === 'preview' && branch && branch !== 'master';
if (preview) {
  console.log('Preview permitida. El entorno debe tener la migración S04 para probar chat/ventas.');
  process.exitCode = 1;
} else {
  console.log('DEPLOY RETENIDO: transferencia Mac con migración S04 pendiente. Se conserva producción actual. Ver plan en Notion antes de retirar ignoreCommand.');
  process.exitCode = 0;
}
