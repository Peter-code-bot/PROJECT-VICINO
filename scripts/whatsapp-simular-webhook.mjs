#!/usr/bin/env node
/**
 * Manda a la ruta del webhook un aviso de WhatsApp FIRMADO como lo firmaria
 * Meta (X-Hub-Signature-256 = sha256=HMAC-SHA256(cuerpo, App Secret)).
 *
 *   WHATSAPP_APP_SECRET=<app secret> node scripts/whatsapp-simular-webhook.mjs \
 *     --url https://vicinomarket.com/api/webhooks/whatsapp \
 *     [--phone-number-id 123456789012345] [--from 5215512345678] [--texto "Hola"] \
 *     [--estado wamid.XXX:delivered]
 *
 * Sirve para comprobar, sin tocar Meta, que la ruta, el RPC y el secreto del
 * Vault estan alineados:
 *   - Sin --phone-number-id manda uno ficticio: la respuesta esperada es
 *     200 {"ok":true,...,"sin_canal":1}. Nada se escribe en conversaciones.
 *   - Con el phone_number_id de un numero conectado, el mensaje APARECE en la
 *     bandeja de ese negocio (es un mensaje de prueba real para el).
 *   - --estado wamid:delivered|read|failed|sent manda un aviso de estado para
 *     un mensaje que enviamos nosotros.
 *
 * El secreto se lee SOLO del entorno (en PowerShell: $env:WHATSAPP_APP_SECRET =
 * "..." en la misma sesion, sin echo). Nunca se imprime ni viaja por argumentos.
 * Codigo de salida 0 solo si la ruta respondio 200.
 */
import { createHmac } from "node:crypto";

const args = process.argv.slice(2);
const leer = (nombre, porDefecto) => {
  const i = args.indexOf(nombre);
  return i >= 0 && args[i + 1] ? args[i + 1] : porDefecto;
};

const url = leer("--url", "http://localhost:3000/api/webhooks/whatsapp");
const phoneNumberId = leer("--phone-number-id", "000000000000000");
const from = leer("--from", "5215512345678");
const texto = leer("--texto", "Hola, es una prueba del webhook de VICINO.");
const estado = leer("--estado", null);
const secreto = process.env.WHATSAPP_APP_SECRET;

if (!secreto) {
  console.error("Falta WHATSAPP_APP_SECRET en el entorno (el App Secret de la app de Meta). No se manda nada.");
  process.exit(2);
}
if (!/^[0-9]{5,32}$/.test(phoneNumberId) || !/^[1-9][0-9]{6,15}$/.test(from)) {
  console.error("--phone-number-id y --from deben ser solo digitos (el from con lada y sin +).");
  process.exit(2);
}

const ahora = String(Math.floor(Date.now() / 1000));
const sufijo = Math.random().toString(36).slice(2, 10).toUpperCase();

const value = estado
  ? (() => {
      const [wamid, status] = estado.split(":");
      if (!wamid || !["sent", "delivered", "read", "failed"].includes(status ?? "")) {
        console.error("--estado debe ser <wamid>:sent|delivered|read|failed");
        process.exit(2);
      }
      return {
        messaging_product: "whatsapp",
        metadata: { display_phone_number: "15550253483", phone_number_id: phoneNumberId },
        statuses: [
          {
            id: wamid,
            status,
            timestamp: ahora,
            recipient_id: from,
            ...(status === "failed"
              ? { errors: [{ code: 131047, title: "Re-engagement message", message: "Re-engagement message", error_data: { details: "Simulado por scripts/whatsapp-simular-webhook.mjs" } }] }
              : {}),
          },
        ],
      };
    })()
  : {
      messaging_product: "whatsapp",
      metadata: { display_phone_number: "15550253483", phone_number_id: phoneNumberId },
      contacts: [{ profile: { name: "Prueba VICINO" }, wa_id: from }],
      messages: [{ from, id: `wamid.SIMULADO${sufijo}${ahora}`, timestamp: ahora, type: "text", text: { body: texto } }],
    };

const cuerpo = JSON.stringify({
  object: "whatsapp_business_account",
  entry: [{ id: "000000000000000", changes: [{ field: "messages", value }] }],
});
const firma = "sha256=" + createHmac("sha256", secreto).update(cuerpo, "utf8").digest("hex");

const respuesta = await fetch(url, {
  method: "POST",
  headers: { "content-type": "application/json", "x-hub-signature-256": firma },
  body: cuerpo,
});
const textoRespuesta = await respuesta.text();
console.log(`HTTP ${respuesta.status} ${textoRespuesta.slice(0, 500)}`);
process.exit(respuesta.status === 200 ? 0 : 1);
