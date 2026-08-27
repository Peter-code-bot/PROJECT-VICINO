"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import * as Sentry from "@sentry/nextjs";
import { createClient } from "@/lib/supabase/server";
import {
  sendMessageSchema,
  getOrCreateChatSchema,
  markChatReadSchema,
  createSaleConfirmationSchema,
  confirmSaleSchema,
  cancelSaleSchema,
  formatPrice,
  type ChatAttachment,
} from "@vicino/shared";
import { enforce, writeRateLimit } from "@/lib/rate-limit";

export async function getOrCreateChat(sellerId: string, productId?: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const rate = await enforce(writeRateLimit, `write:${user.id}`);
  if (!rate.ok) return { error: rate.error };

  const parsed = getOrCreateChatSchema.safeParse({
    seller_id: sellerId,
    product_id: productId,
  });
  if (!parsed.success) {
    return { error: parsed.error.errors[0]?.message ?? "Datos inválidos" };
  }

  // Defense in depth: reject self-chat at the server boundary. The owner-
  // in-preview UX path is covered by the PreviewBanner + chat/page.tsx
  // redirect to /chat?selfChatError=1, but a direct POST that bypasses
  // the UI would still hit get_or_create_chat without this check.
  if (user.id === parsed.data.seller_id) {
    return { error: "No puedes iniciar un chat contigo mismo" };
  }

  const { data: chatId, error } = await supabase.rpc("get_or_create_chat", {
    p_comprador_id: user.id,
    p_vendedor_id: parsed.data.seller_id,
    p_producto_id: parsed.data.product_id ?? null,
  });

  if (error) return { error: error.message };
  return { chatId: chatId as string };
}

/**
 * A5.1: cursor-based load-older for chat history.
 *
 * Returns messages strictly OLDER than `cursor` (ISO timestamp of the
 * currently-oldest message in view), ordered ASC for prepend at the
 * top of the existing list. `nextCursor` is the created_at of the
 * OLDEST returned item if the page was full; null otherwise (signals
 * "no more pages" to use-infinite-cursor.hasMore).
 *
 * RLS enforced: the SSR initial 50 in app/(marketplace)/chat/[id]/page.tsx
 * uses the same Supabase client and the same chats/messages policies.
 * If a user is not a participant of `chatId`, the SELECT returns 0 rows.
 */
export async function getMessagesBefore(
  chatId: string,
  cursor: string,
  limit: number = 30,
): Promise<{
  items: Array<{
    id: string;
    chat_id: string;
    autor_id: string;
    texto: string;
    attachments: unknown;
    created_at: string;
    leido_por_comprador: boolean;
    leido_por_vendedor: boolean;
  }>;
  nextCursor: string | null;
  error?: string;
}> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { items: [], nextCursor: null, error: "No autenticado" };

  // CODEX M4 fix: validate the cursor BEFORE issuing the query. The
  // cursor is a client-supplied string; if it is not a valid ISO
  // timestamp, Supabase/Postgres rejects the cast with a verbose
  // message ("invalid input syntax for type timestamp with time zone")
  // that would leak DB internals to the client. Return a generic
  // error instead and never touch the DB on a malformed cursor.
  if (Number.isNaN(Date.parse(cursor))) {
    return { items: [], nextCursor: null, error: "Cursor invalido" };
  }

  // CODEX H2 fix: clamp the limit so a hostile direct caller cannot
  // request a huge page. 50 is generous for the chat load-older case
  // (the default is 30) without exposing the table to a 10k-row scan.
  const safeLimit = Math.min(Math.max(1, limit), 50);

  // Fetch DESC by created_at + .lt(cursor) to get the immediately-older
  // page. Reverse to ASC for the call-site to prepend without
  // additional sort. nextCursor = the oldest (now first) item's
  // created_at if the page filled; null otherwise.
  // Fetch the chat to check soft-delete timestamps for the current user
  const { data: chat } = await supabase
    .from("chats")
    .select("comprador_id, vendedor_id, deleted_at_comprador, deleted_at_vendedor")
    .eq("id", chatId)
    .single();

  if (!chat) return { items: [], nextCursor: null, error: "Chat no encontrado" };
  if (user.id !== chat.comprador_id && user.id !== chat.vendedor_id) {
    return { items: [], nextCursor: null, error: "No autorizado" };
  }

  const isBuyer = user.id === chat.comprador_id;
  const deletedAt = isBuyer ? chat.deleted_at_comprador : chat.deleted_at_vendedor;

  const messagesQuery = supabase
    .from("messages")
    .select(
      "id, chat_id, autor_id, texto, attachments, created_at, leido_por_comprador, leido_por_vendedor",
    )
    .eq("chat_id", chatId)
    .lt("created_at", cursor)
    .order("created_at", { ascending: false })
    .limit(safeLimit);

  if (deletedAt) {
    messagesQuery.gt("created_at", deletedAt);
  }

  const { data, error } = await messagesQuery;

  if (error) return { items: [], nextCursor: null, error: error.message };

  const items = (data ?? []).reverse();
  const nextCursor = items.length === safeLimit ? items[0]!.created_at : null;
  return { items, nextCursor };
}

/**
 * Manda un mensaje, con texto, con fotos, o con las dos cosas.
 *
 * LOS ADJUNTOS VIAJAN EN EL MISMO INSERT, A PROPOSITO. La tentacion es insertar
 * el mensaje y despues actualizarlo con las fotos, y seria un fallo mudo:
 * messages NO TIENE NINGUNA POLICY DE UPDATE, asi que ese segundo paso afecta a
 * cero filas y PostgREST lo devuelve sin error. El mensaje quedaria publicado
 * sin sus fotos y nadie se enteraria.
 *
 * Las rutas se comprueban aqui Y en la base. La de aqui existe para dar un
 * mensaje legible; la que obliga de verdad es el constraint
 * messages_attachments_validos, porque la policy de INSERT de messages permite
 * escribir directamente desde el navegador con la llave anon — esta accion es
 * el camino normal, no el unico.
 */
export async function sendMessage(
  chatId: string,
  texto: string,
  attachments: ChatAttachment[] = [],
) {
  if (typeof texto !== "string") return { error: "Mensaje inválido" };
  // Strip HTML tags without entity-encoding: chat renders as plain text so React handles XSS
  const safeTexto = texto.trim().replace(/<[^>]*>/g, "");
  if (safeTexto.length > 2000) return { error: "Mensaje inválido" };
  if (!safeTexto && attachments.length === 0) return { error: "Mensaje inválido" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "No autenticado" };

  const rate = await enforce(writeRateLimit, `write:${user.id}`);
  if (!rate.ok) return { error: rate.error };

  const parsed = sendMessageSchema.safeParse({
    chat_id: chatId,
    texto: safeTexto,
    attachments,
  });
  if (!parsed.success) {
    return { error: parsed.error.errors[0]?.message ?? "Mensaje inválido" };
  }

  // Cada foto tiene que vivir bajo <chat>/<autor>/. Se comprueba con el chatId
  // ya validado y el user.id de la sesion, nunca con nada que venga del cliente.
  const prefijo = `${parsed.data.chat_id}/${user.id}/`;
  if (parsed.data.attachments.some((a) => !a.path.startsWith(prefijo))) {
    return { error: "Adjunto inválido" };
  }

  const { data: inserted, error } = await supabase
    .from("messages")
    .insert({
      chat_id: parsed.data.chat_id,
      autor_id: user.id,
      texto: parsed.data.texto,
      attachments: parsed.data.attachments,
    })
    .select("id")
    .single();

  if (error) {
    // 23514 es uno de los dos constraints de arriba rechazando la fila. Es lo
    // unico que separa "te falta algo" de "la base esta rota", y sin traducirlo
    // el usuario veria el texto crudo de Postgres.
    if (error.code === "23514") return { error: "El mensaje o sus fotos no son válidos" };
    return { error: error.message };
  }
  if (!inserted) return { error: "No se pudo enviar el mensaje" };
  return { success: true as const, data: { id: inserted.id } };
}

/**
 * Deja constancia en el chat de que se agendo una cita (item 99).
 *
 * Se hace desde el servidor y NO desde el trigger de la base, aunque el
 * trigger parezca el sitio natural. Tres razones concretas, comprobadas:
 *
 *   - notify_appointment_created lleva `SET search_path TO ''`, y las
 *     funciones anidadas que no traen SET propio lo HEREDAN. El primer
 *     trigger que dispararia un INSERT en messages moriria por referencias
 *     sin cualificar. Fallaria siempre, no a veces.
 *   - Su cuerpo es un unico BEGIN ... EXCEPTION, que en PL/pgSQL es una
 *     subtransaccion. Si el codigo de chat anadido despues fallara, se
 *     revertiria tambien el INSERT en notifications que ya habia funcionado:
 *     por anadir una comodidad se perderia el aviso que si servia.
 *   - get_or_create_chat resuelve el comprador con auth.uid(), asi que desde
 *     un trigger con service_role no hay actor y desde una cita creada por el
 *     vendedor colocaria el chat al reves.
 *
 * Es ADITIVO a proposito: la cita ya esta guardada y los avisos ya se
 * mandaron cuando esto corre. Si falla, no se deshace nada y la persona no
 * pierde su cita — solo se queda sin el mensaje en el chat.
 *
 * El texto se compone AQUI y no llega del cliente: asi el mensaje de "cita
 * agendada" dice siempre lo mismo y no puede usarse para colar texto ajeno
 * con la apariencia de un aviso del sistema.
 */
export async function avisarCitaEnChat(params: {
  sellerId: string;
  productId: string;
  tituloProducto: string;
  fecha: string; // YYYY-MM-DD
  hora: string;  // HH:MM
}) {
  const chat = await getOrCreateChat(params.sellerId, params.productId);
  // getOrCreateChat devuelve { chatId } o { error }. Comprobado leyendo su
  // return, no deducido de como se llama en otros sitios.
  if ("error" in chat || !chat.chatId) {
    return { error: "error" in chat ? chat.error : "No se pudo abrir el chat" };
  }

  const [anio, mes, dia] = params.fecha.split("-");
  const cuando = dia && mes ? `${dia}/${mes}` : params.fecha;
  void anio;

  const texto =
    `Agende una cita para "${params.tituloProducto}" el ${cuando} a las ${params.hora}.`;

  return sendMessage(chat.chatId, texto);
}

export async function markAsRead(chatId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return;

  const rate = await enforce(writeRateLimit, `write:${user.id}`);
  if (!rate.ok) return;

  const parsed = markChatReadSchema.safeParse({ chat_id: chatId });
  if (!parsed.success) return;

  // mark_messages_as_read es SECURITY DEFINER y levanta 'unauthenticated',
  // 'chat not found' o 'forbidden: no eres participante de este chat' como
  // excepcion. El await pelado descartaba el { error } entero, asi que un
  // contador de no leidos pegado no dejaba rastro en ningun lado.
  const { error: markReadErr } = await supabase.rpc("mark_messages_as_read", {
    p_chat_id: parsed.data.chat_id,
    p_user_id: user.id,
  });

  // Solo se registra: marcar leido es un efecto secundario de abrir el chat y
  // no debe romper nada de cara al usuario. Sentry conserva el `details` de
  // Postgres, que es donde el motor nombra la columna o la policy.
  if (markReadErr) {
    Sentry.captureException(markReadErr, {
      tags: { action: "markAsRead" },
      extra: {
        chatId: parsed.data.chat_id,
        code: markReadErr.code,
        details: markReadErr.details,
        hint: markReadErr.hint,
      },
    });
  }
}

export async function createSaleConfirmation(data: {
  productId: string;
  chatId: string;
  precioAcordado: number;
  cantidad: number;
  metodoPago?: string;
  notas?: string;
  tipoEntrega: string;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "No autenticado" };

  const rate = await enforce(writeRateLimit, `write:${user.id}`);
  if (!rate.ok) return { error: rate.error };

  const parsed = createSaleConfirmationSchema.safeParse({
    product_id: data.productId,
    chat_id: data.chatId,
    precio_acordado: data.precioAcordado,
    cantidad: data.cantidad,
    metodo_pago: data.metodoPago,
    notas: data.notas,
    tipo_entrega: data.tipoEntrega === "envio" ? "envio" : "pickup",
  });
  if (!parsed.success) {
    return { error: parsed.error.errors[0]?.message ?? "Datos inválidos" };
  }

  // Derive buyer/seller server-side from chat record — never trust client-supplied IDs.
  const { data: chat, error: chatErr } = await supabase
    .from("chats")
    .select("comprador_id, vendedor_id")
    .eq("id", parsed.data.chat_id)
    .single();

  if (chatErr || !chat) {
    if (chatErr) console.error("[createSaleConfirmation] chat lookup:", chatErr);
    return { error: chatErr?.message ?? "Chat no encontrado" };
  }

  if (user.id !== chat.comprador_id && user.id !== chat.vendedor_id) {
    return { error: "No autorizado para este chat" };
  }

  const { data: confirmation, error } = await supabase
    .from("sale_confirmations")
    .insert({
      product_id: parsed.data.product_id,
      buyer_id: chat.comprador_id,
      seller_id: chat.vendedor_id,
      chat_id: parsed.data.chat_id,
      precio_acordado: parsed.data.precio_acordado,
      cantidad: parsed.data.cantidad,
      metodo_pago: parsed.data.metodo_pago ?? null,
      notas: parsed.data.notas ?? null,
      tipo_entrega: parsed.data.tipo_entrega,
      initiated_by: user.id,
    })
    .select()
    .single();

  if (error) {
    if (error.code === "23505") return { error: "Ya hay una confirmación en curso." };
    return { error: error.message };
  }

  // Send auto-message in chat
  const { data: profile } = await supabase
    .from("profiles")
    .select("nombre")
    .eq("id", user.id)
    .single();

  const { data: product } = await supabase
    .from("products_services")
    .select("titulo")
    .eq("id", parsed.data.product_id)
    .single();

  const { error: autoMsgErr } = await supabase.from("messages").insert({
    chat_id: parsed.data.chat_id,
    autor_id: user.id,
    texto: `🤝 ${profile?.nombre ?? "Alguien"} ha iniciado una confirmación de venta por "${product?.titulo ?? "el producto"}" — ${formatPrice(parsed.data.precio_acordado)} MXN. Confirma para completar la venta.`,
  });
  // La confirmacion YA esta escrita en la base: perder el mensaje del chat no
  // puede deshacerla, asi que esto solo se registra y el flujo sigue. Sentry
  // en vez de console.error para conservar el `details` de Postgres, que es
  // donde el motor nombra la columna o la policy que rechazo el INSERT.
  if (autoMsgErr) {
    Sentry.captureException(autoMsgErr, {
      tags: { action: "createSaleConfirmation", step: "auto_message" },
      extra: {
        chatId: parsed.data.chat_id,
        saleConfirmationId: confirmation?.id,
        code: autoMsgErr.code,
        details: autoMsgErr.details,
        hint: autoMsgErr.hint,
      },
    });
  }

  revalidatePath(`/chat/${parsed.data.chat_id}`);
  return { confirmation };
}

export async function confirmSale(saleConfirmationId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "No autenticado" };

  const rate = await enforce(writeRateLimit, `write:${user.id}`);
  if (!rate.ok) return { error: rate.error };

  const parsed = confirmSaleSchema.safeParse({ sale_confirmation_id: saleConfirmationId });
  if (!parsed.success) {
    return { error: parsed.error.errors[0]?.message ?? "Confirmación inválida" };
  }

  const { data: sc } = await supabase
    .from("sale_confirmations")
    .select("buyer_id, seller_id, chat_id, product_id, precio_acordado, buyer_confirmed, seller_confirmed, status")
    .eq("id", parsed.data.sale_confirmation_id)
    .single();

  if (!sc) return { error: "Confirmación no encontrada" };

  const isBuyer = user.id === sc.buyer_id;
  const myAlreadyConfirmed = isBuyer ? sc.buyer_confirmed : sc.seller_confirmed;

  // Idempotency guard — early return without side effects if already completed
  // or my-side already confirmed (rapid duplicate click case)
  if (sc.status !== "pending_confirmation" || myAlreadyConfirmed) {
    return { success: true, alreadyConfirmed: true };
  }

  const updates = isBuyer
    ? { buyer_confirmed: true, buyer_confirmed_at: new Date().toISOString() }
    : { seller_confirmed: true, seller_confirmed_at: new Date().toISOString() };

  // El WHERE acota a "la confirmacion sigue pendiente". El `.select()` es lo
  // que convierte el 204-sin-cuerpo de PostgREST en filas reales: sin el, un
  // UPDATE de 0 filas (la otra parte cancelo en paralelo, expiro, o RLS filtro
  // la fila) era indistinguible del exito y el usuario veia la venta
  // confirmada sin que se hubiera escrito nada.
  //
  // complete_sale_on_mutual_confirm es un trigger BEFORE UPDATE, asi que el
  // RETURNING ya trae el `status` posterior al trigger: nos dice si fue ESTA
  // confirmacion la que cerro la venta, sin el segundo SELECT que abria una
  // ventana para que dos llamadas concurrentes leyeran ambas 'completed'.
  const { data: updated, error: updateError } = await supabase
    .from("sale_confirmations")
    .update(updates)
    .eq("id", parsed.data.sale_confirmation_id)
    .eq("status", "pending_confirmation")
    .select("status")
    .maybeSingle();

  if (updateError) {
    // Sentry SIEMPRE antes del return: el `details` de Postgres es donde el
    // motor nombra la columna o la policy que rechazo, y es lo unico que
    // separa un GRANT faltante de un problema de RLS.
    Sentry.captureException(updateError, {
      tags: { action: "confirmSale", step: "update" },
      extra: {
        saleConfirmationId: parsed.data.sale_confirmation_id,
        side: isBuyer ? "buyer" : "seller",
        code: updateError.code,
        details: updateError.details,
        hint: updateError.hint,
      },
    });
    return { error: "No se pudo confirmar la venta. Vuelve a intentarlo en un momento." };
  }

  // 0 filas: la confirmacion dejo de estar pendiente entre nuestra lectura y
  // este UPDATE, o RLS la filtro. Nunca es un exito -- abortamos aqui, antes
  // de escribir el mensaje de venta confirmada.
  if (!updated) {
    return {
      error:
        "Esta venta ya no está pendiente: la otra parte la canceló o el plazo venció. Actualiza el chat para ver el estado.",
    };
  }

  // Only insert the "venta confirmada" message if THIS update flipped status to completed.
  if (updated.status === "completed" && sc.chat_id) {
    const { data: product } = await supabase
      .from("products_services")
      .select("titulo")
      .eq("id", sc.product_id)
      .single();

    const { error: completedMsgErr } = await supabase.from("messages").insert({
      chat_id: sc.chat_id,
      autor_id: user.id,
      texto: `✅ ¡Venta confirmada en VICINO! "${product?.titulo ?? "el producto"}" — ${formatPrice(sc.precio_acordado)} MXN. ¡Gracias a ambos! Deja tu reseña 👇`,
      sale_confirmation_id: saleConfirmationId,
      message_type: "sale_confirmed",
    });
    // La venta YA esta cerrada en la base (el trigger BEFORE fijo status y
    // completed_at y repartio trust_points): perder este mensaje no puede
    // deshacerla, asi que solo se registra y el flujo termina en exito.
    //
    // El 23505 es el indice unico messages_unique_sale_confirmed haciendo su
    // trabajo -- el mensaje ya existe, no es un fallo, y no se reporta.
    if (completedMsgErr && completedMsgErr.code !== "23505") {
      Sentry.captureException(completedMsgErr, {
        tags: { action: "confirmSale", step: "completed_message" },
        extra: {
          chatId: sc.chat_id,
          saleConfirmationId,
          code: completedMsgErr.code,
          details: completedMsgErr.details,
          hint: completedMsgErr.hint,
        },
      });
    }
  }

  if (sc.chat_id) revalidatePath(`/chat/${sc.chat_id}`);
  return { success: true };
}

export async function cancelSale(saleConfirmationId: string, reason?: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "No autenticado" };

  const rate = await enforce(writeRateLimit, `write:${user.id}`);
  if (!rate.ok) return { error: rate.error };

  const parsed = cancelSaleSchema.safeParse({
    sale_confirmation_id: saleConfirmationId,
    reason,
  });
  if (!parsed.success) {
    return { error: parsed.error.errors[0]?.message ?? "Datos inválidos" };
  }

  const { data: cancelled, error } = await supabase
    .from("sale_confirmations")
    .update({
      status: "cancelled",
      cancelled_at: new Date().toISOString(),
      cancelled_by: user.id,
      cancel_reason: parsed.data.reason ?? null,
    })
    .eq("id", parsed.data.sale_confirmation_id)
    .eq("status", "pending_confirmation")
    .select("chat_id")
    .maybeSingle();

  if (error) return { error: error.message };
  if (!cancelled) {
    // If we get here without an error, it means the update matched 0 rows.
    // This could be because the status is no longer pending, or RLS blocked it.
    return { error: "No se pudo cancelar: la confirmación ya fue modificada o no tienes permiso." };
  }
  
  if (cancelled.chat_id) revalidatePath(`/chat/${cancelled.chat_id}`);
  return { success: true };
}

export async function getTotalUnreadChats(): Promise<number> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return 0;

  const [{ data: buyerChats }, { data: sellerChats }] = await Promise.all([
    supabase.from("chats").select("no_leidos_comprador").eq("comprador_id", user.id),
    supabase.from("chats").select("no_leidos_vendedor").eq("vendedor_id", user.id),
  ]);

  return (
    (buyerChats?.reduce((sum, c) => sum + (c.no_leidos_comprador ?? 0), 0) ?? 0) +
    (sellerChats?.reduce((sum, c) => sum + (c.no_leidos_vendedor ?? 0), 0) ?? 0)
  );
}

export async function hideChat(chatId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "No autenticado" };

  const { data: chat } = await supabase
    .from("chats")
    .select("comprador_id, vendedor_id")
    .eq("id", chatId)
    .single();

  if (!chat) return { error: "Chat no encontrado" };
  if (chat.comprador_id !== user.id && chat.vendedor_id !== user.id)
    return { error: "Sin permiso" };

  const isBuyer = chat.comprador_id === user.id;
  const updates = isBuyer
    ? { oculto_para_comprador: true, deleted_at_comprador: new Date().toISOString() }
    : { oculto_para_vendedor: true, deleted_at_vendedor: new Date().toISOString() };

  const { error } = await supabase
    .from("chats")
    .update(updates)
    .eq("id", chatId);

  if (error) return { error: error.message };

  revalidatePath("/chat");
  return { success: true };
}
