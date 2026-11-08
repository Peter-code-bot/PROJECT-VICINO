/**
 * Bandera de la bandeja de WhatsApp (fase 2 de INT-CRM-20261104).
 *
 * Es NEXT_PUBLIC a proposito: la leen el menu del vendedor (componente de
 * cliente) y las paginas de /seller/bandeja (servidor) y tienen que ver el
 * MISMO valor, horneado en el build. No revela nada: solo si la pantalla
 * existe. Solo la cadena "1" la enciende; cualquier otra cosa la deja apagada
 * (falla cerrado, como VICINO_MAPA_RPC).
 *
 * El webhook /api/webhooks/whatsapp NO depende de esta bandera: Meta tiene
 * que poder verificar la URL antes de que la pantalla se muestre a nadie.
 */
export const BANDEJA_WHATSAPP_ACTIVA = process.env.NEXT_PUBLIC_VICINO_BANDEJA_WHATSAPP === "1";
