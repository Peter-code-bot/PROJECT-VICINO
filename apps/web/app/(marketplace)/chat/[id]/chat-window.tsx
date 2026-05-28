"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { formatRelativeTime } from "@vicino/shared";
import { Send, Handshake, ArrowLeft, Check, CheckCheck, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { sendMessage } from "../actions";
import { useOptimisticMutation } from "@/hooks/use-optimistic-mutation";
import { SaleConfirmationCard, StatusPill, ConfirmationStatus, SaleConfirmation } from "./sale-confirmation-card";
import { SaleConfirmationForm } from "./sale-confirmation-form";
import { ReportMenuButton } from "@/components/moderation/report-menu-button";
import { UserAvatar } from "@/components/ui/user-avatar";
import Link from "next/link";
import { useRouter } from "next/navigation";

// Window for the realtime fallback to reclaim an in-flight optimistic
// message. 3s is firmed as the safe upper bound: shorter risks legitimate
// network latency on slow connections, longer would start swallowing
// genuinely separate sends of the same text. Keep tight on purpose.
const TEMP_RECLAIM_WINDOW_MS = 3000;

interface Message {
  id: string;
  chat_id: string;
  autor_id: string;
  texto: string;
  attachments: unknown;
  created_at: string;
  leido_por_comprador: boolean;
  leido_por_vendedor: boolean;
}


interface ChatWindowProps {
  chatId: string;
  currentUserId: string;
  isBuyer: boolean;
  otherUser: { id: string; nombre: string; foto: string | null; trust_level: string } | null;
  product: { id: string; titulo: string; precio: number; imagen_principal: string | null } | null;
  initialMessages: Message[];
  initialSaleConfirmations: SaleConfirmation[];
}

export function ChatWindow({
  chatId,
  currentUserId,
  isBuyer,
  otherUser,
  product,
  initialMessages,
  initialSaleConfirmations,
}: ChatWindowProps) {
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [saleConfirmations, setSaleConfirmations] = useState<SaleConfirmation[]>(
    initialSaleConfirmations,
  );
  const [input, setInput] = useState("");
  const [sendError, setSendError] = useState("");
  const [showSaleForm, setShowSaleForm] = useState(false);
  const [showSaleDetails, setShowSaleDetails] = useState(false);
  const [showOlderConfirmations, setShowOlderConfirmations] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const supabase = createClient();

  // FIFO map of optimistic temp ids per texto for the current user.
  // Key is the message texto; value is an array of in-flight tempIds in
  // submit order. Used by the realtime INSERT handler to reclaim the
  // correct tempId when two identical sends are in flight at the same
  // time (test #6 of MP#07 item #1 Fase 5 used to collapse both into
  // one because the proximity fallback matched the first temp it found).
  // Maintained from onMutate (push), onSuccess (shift on real-id swap)
  // and onError (shift on rollback) so a failed send does not leave a
  // zombie entry that a future send of the same texto could reclaim.
  const tempSendsByTextRef = useRef<Map<string, string[]>>(new Map());

  function trackTempId(text: string, tempId: string) {
    const current = tempSendsByTextRef.current.get(text) ?? [];
    tempSendsByTextRef.current.set(text, [...current, tempId]);
  }

  function releaseTempId(text: string, tempId: string) {
    const current = tempSendsByTextRef.current.get(text);
    if (!current) return;
    const next = current.filter((id) => id !== tempId);
    if (next.length === 0) tempSendsByTextRef.current.delete(text);
    else tempSendsByTextRef.current.set(text, next);
  }
  const router = useRouter();

  const sendMutation = useOptimisticMutation(
    ({ text }: { tempId: string; text: string }) => sendMessage(chatId, text),
    {
      onMutate: ({ tempId, text }) => {
        trackTempId(text, tempId);
        const optimisticMsg: Message = {
          id: tempId,
          chat_id: chatId,
          autor_id: currentUserId,
          texto: text,
          attachments: [],
          created_at: new Date().toISOString(),
          leido_por_comprador: isBuyer,
          leido_por_vendedor: !isBuyer,
        };
        setMessages((prev) => [...prev, optimisticMsg]);
        return () => {
          releaseTempId(text, tempId);
          setMessages((prev) => prev.filter((m) => m.id !== tempId));
        };
      },
      onSuccess: (result, { tempId, text }) => {
        // Replace the temp id with the server-generated UUID. When the
        // realtime INSERT echo arrives next, the existing prev.some
        // check matches by id and avoids the duplicate.
        const realId =
          result &&
          typeof result === "object" &&
          "data" in result &&
          result.data &&
          typeof result.data === "object" &&
          "id" in result.data &&
          typeof result.data.id === "string"
            ? result.data.id
            : null;
        // Release the tempId from the FIFO tracker regardless of whether
        // realId is available. The temp is no longer in flight.
        releaseTempId(text, tempId);
        if (!realId) return;
        setMessages((prev) =>
          prev.map((m) => (m.id === tempId ? { ...m, id: realId } : m)),
        );
      },
      onError: (err) => {
        // Caveat-1 of item #14 firma: the rollback returned by onMutate
        // already calls releaseTempId, so the FIFO tracker stays in sync
        // with the visible messages list even on offline send failures.
        // A subsequent retry of the same texto will not reclaim a zombie
        // entry because the failed tempId was removed from the map.
        const message =
          err instanceof Error && err.message
            ? err.message
            : "No se pudo enviar el mensaje";
        setSendError(message);
      },
      // Chat must allow consecutive sends without blocking the second one
      // while the first is still in flight; idempotent-toggle pattern of
      // the default mode would swallow the second message.
      allowConcurrent: true,
    },
  );


  // Subscribe to new messages and read receipt updates
  useEffect(() => {
    const channel = supabase
      .channel(`chat:${chatId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `chat_id=eq.${chatId}`,
        },
        (payload) => {
          const newMsg = payload.new as Message;
          setMessages((prev) => {
            // Already in list by real id (after onSuccess replaced temp->real).
            if (prev.some((m) => m.id === newMsg.id)) return prev;

            if (newMsg.autor_id === currentUserId) {
              // Primary reclaim path: FIFO map keyed by texto. Two rapid
              // identical sends (test #6 from MP#07 item #1 Fase 5) each
              // push their own tempId into the same key. The oldest temp
              // wins each realtime echo, so the second send is preserved
              // as its own message instead of collapsing into the first
              // (which is what the proximity-only fallback used to do).
              const queue = tempSendsByTextRef.current.get(newMsg.texto);
              if (queue && queue.length > 0) {
                const reclaimTempId = queue[0];
                if (queue.length === 1) {
                  tempSendsByTextRef.current.delete(newMsg.texto);
                } else {
                  tempSendsByTextRef.current.set(newMsg.texto, queue.slice(1));
                }
                return prev.map((m) =>
                  m.id === reclaimTempId ? newMsg : m,
                );
              }

              // Ultimate fallback: if the Map desyncs (unmount/remount,
              // race condition with clearTimeout, hook reset during HMR,
              // etc) the proximity 3s window still covers the edge
              // ordering scenario from test #4 (realtime echo before the
              // server action response). NOT redundant with the Map: this
              // is the safety net for cases where the Map is empty but
              // a matching temp is still visible in the messages array.
              // Do NOT remove this check.
              const realTime = new Date(newMsg.created_at).getTime();
              const tempMatch = prev.find((m) => {
                if (!m.id.startsWith("temp-")) return false;
                if (m.autor_id !== newMsg.autor_id) return false;
                if (m.texto !== newMsg.texto) return false;
                const tempTime = new Date(m.created_at).getTime();
                return Math.abs(realTime - tempTime) < TEMP_RECLAIM_WINDOW_MS;
              });
              if (tempMatch) {
                return prev.map((m) => (m.id === tempMatch.id ? newMsg : m));
              }
            }
            return [...prev, newMsg];
          });
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "messages",
          filter: `chat_id=eq.${chatId}`,
        },
        (payload) => {
          const updated = payload.new as Message;
          setMessages((prev) =>
            prev.map((m) => (m.id === updated.id ? { ...m, ...updated } : m))
          );
        }
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "sale_confirmations",
          filter: `chat_id=eq.${chatId}`,
        },
        async (payload) => {
          const newSc = payload.new as Omit<SaleConfirmation, "products_services">;
          // Realtime payload does not include the join; fetch product title.
          const { data: prod } = await supabase
            .from("products_services")
            .select("titulo")
            .eq("id", newSc.product_id)
            .single();
          setSaleConfirmations((prev) => {
            if (prev.some((s) => s.id === newSc.id)) return prev;
            return [{ ...newSc, products_services: prod ?? null }, ...prev];
          });
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "sale_confirmations",
          filter: `chat_id=eq.${chatId}`,
        },
        (payload) => {
          const updated = payload.new as Omit<SaleConfirmation, "products_services">;
          // Mirror the SSR query: only pending_confirmation and completed are
          // displayed. Drop the row on cancel/expire so the card disappears
          // live instead of lingering until refresh.
          const visibleStatuses = ["pending_confirmation", "completed"];
          setSaleConfirmations((prev) => {
            if (!visibleStatuses.includes(updated.status)) {
              return prev.filter((s) => s.id !== updated.id);
            }
            return prev.map((s) =>
              s.id === updated.id ? { ...s, ...updated } : s
            );
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [chatId, supabase]);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim()) return;

    const text = input.trim();
    setInput("");
    setSendError("");

    // Unique temp id per send so rapid consecutive optimistic messages
    // do not collide. Math.random suffix guards against same-millisecond
    // multiple sends from a fast user.
    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    void sendMutation.mutate({ tempId, text });
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header */}
      <div className="flex shrink-0 items-center gap-3 px-4 py-3 shadow-[inset_0_-1px_0_0_var(--border)]">
        <Link href="/chat" className="md:hidden text-[color:var(--fg-muted)] hover:text-[color:var(--fg)] transition-colors">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <Link
          href={`/vendedor/${otherUser?.id ?? ""}`}
          className="-mx-2 flex min-w-0 flex-1 items-center gap-3 rounded-md px-2 py-1 transition-colors hover:bg-[color:var(--bg-elev-2)]/60"
          aria-label={otherUser?.nombre ? `Ver perfil de ${otherUser.nombre}` : "Perfil de usuario"}
        >
          <UserAvatar src={otherUser?.foto} name={otherUser?.nombre ?? "?"} size="sm" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-[color:var(--fg)]">
              {otherUser?.nombre ?? "Usuario"}
            </p>
            {product && (
              <p className="truncate text-xs text-[color:var(--fg-muted)]">
                {product.titulo}
              </p>
            )}
          </div>
        </Link>
        {saleConfirmations.filter((s) => s.status === "pending_confirmation").length === 0 && (
          <button
            onClick={() => setShowSaleForm(!showSaleForm)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[color:var(--brand)] px-3 py-1.5 text-xs font-semibold text-white shadow-[var(--shadow-glow)] transition-colors hover:bg-[color:var(--brand-dark)]"
          >
            <Handshake className="h-3.5 w-3.5" />
            Confirmar Venta
          </button>
        )}
      </div>

      {/* Sale confirmation form */}
      {showSaleForm && (
        <SaleConfirmationForm
          chatId={chatId}
          currentUserId={currentUserId}
          product={product}
          onClose={() => setShowSaleForm(false)}
        />
      )}

      {/* Product context — compact bar */}
      {product && (
        <Link
          href={`/buscar?q=${encodeURIComponent(product.titulo)}`}
          className="flex items-center gap-2.5 px-4 py-2 shadow-[inset_0_-1px_0_0_var(--border)] transition-colors hover:bg-[color:var(--bg-elev-2)]/60"
        >
          <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-md bg-[color:var(--bg-elev-2)] shadow-[inset_0_0_0_1px_var(--border)]">
            {product.imagen_principal ? (
              <img src={product.imagen_principal} alt="" className="h-full w-full object-cover" />
            ) : (
              <span className="text-xs text-[color:var(--fg-muted)]">{product.titulo[0]}</span>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-semibold text-[color:var(--fg)]">{product.titulo}</p>
            <p className="text-[10px] text-[color:var(--brand-hi)]">${product.precio.toLocaleString("es-MX")} MXN</p>
          </div>
        </Link>
      )}

      {/* Sale confirmation — compact collapsible banner */}
      {saleConfirmations.length > 0 && (() => {
        const primarySc = saleConfirmations[0];
        if (!primarySc) return null;
        
        const scIsBuyer = currentUserId === primarySc.buyer_id;
        const myConf = scIsBuyer ? primarySc.buyer_confirmed : primarySc.seller_confirmed;
        const otherConf = scIsBuyer ? primarySc.seller_confirmed : primarySc.buyer_confirmed;
        
        let scStatus: ConfirmationStatus = "pendiente";
        let scLabel = "";
        if (primarySc.status === "rejected" || primarySc.rejected_by) {
          scStatus = "rechazado";
          scLabel = "Venta rechazada";
        } else if (primarySc.status === "completed") {
          scStatus = "completado";
          scLabel = "Venta confirmada";
        } else if (myConf && !otherConf) {
          scStatus = "esperando";
          scLabel = "Esperando respuesta del " + (scIsBuyer ? "vendedor" : "comprador");
        } else {
          scStatus = "pendiente";
          scLabel = "Pendiente de respuesta del " + (!scIsBuyer ? "vendedor" : "comprador");
        }

        return (
          <div className="mx-3 my-1">
            <button
              onClick={() => setShowSaleDetails(!showSaleDetails)}
              className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left rounded-xl bg-[color:var(--brand-tint)] shadow-[inset_0_0_0_1px_var(--brand-tint-strong)] transition-colors hover:bg-[color:var(--brand-tint-strong)]"
            >
              <div className="w-7 h-7 rounded-[9px] bg-[color:var(--brand)] text-white flex items-center justify-center shrink-0 shadow-[0_4px_12px_rgba(31,90,78,0.4)]">
                <Handshake className="h-3.5 w-3.5" strokeWidth={2.2} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-xs font-semibold text-[color:var(--fg)]">Confirmación de venta</div>
                <StatusPill status={scStatus} label={scLabel} />
              </div>
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-[color:var(--fg-muted)]">
                {showSaleDetails ? "Ocultar" : "Ver detalles"}
                <ChevronDown className={cn("h-3 w-3 transition-transform", showSaleDetails && "rotate-180")} strokeWidth={2.4} />
              </span>
            </button>
            {showSaleDetails && (
              <div className="mt-1 space-y-1 max-h-[60vh] overflow-y-auto pb-[calc(env(safe-area-inset-bottom)_+_4rem)]">
                {saleConfirmations.map((sc) => (
                  <SaleConfirmationCard 
                    key={sc.id} 
                    confirmation={sc} 
                    currentUserId={currentUserId}
                    counterpart={{ 
                      name: otherUser?.nombre ?? "Usuario", 
                      avatarUrl: otherUser?.foto, 
                      role: isBuyer ? "vendedor" : "comprador" 
                    }}
                    currentUser={{ 
                      initial: "Y", // Using generic 'Y' for 'You' since we don't have current user's name easily accessible
                      role: isBuyer ? "comprador" : "vendedor" 
                    }}
                    onRate={() => {
                      const reviewType = isBuyer ? "buyer_to_seller" : "seller_to_buyer";
                      router.push(`/historial/review?sale=${sc.id}&type=${reviewType}&product=${sc.product_id}`);
                    }}
                    onPropose={() => {
                      setShowSaleDetails(false);
                      // Depending on business logic, you might also clear the form or open it:
                      // setShowSaleForm(true);
                    }}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })()}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto min-h-0 px-4 py-3 space-y-2">
        {messages.map((msg) => {
          const isOwn = msg.autor_id === currentUserId;
          // Read receipt: check if the OTHER party has read the message
          const isRead = isOwn
            ? (isBuyer ? msg.leido_por_vendedor : msg.leido_por_comprador)
            : false;

          return (
            <div
              key={msg.id}
              className={cn(
                "flex items-end gap-1 group",
                isOwn ? "justify-end" : "justify-start"
              )}
            >
              <div
                className={cn(
                  "max-w-[80%] rounded-2xl px-3.5 py-2 text-sm",
                  isOwn
                    ? "rounded-br-md bg-[color:var(--brand)] text-white shadow-[var(--shadow-glow)]"
                    : "rounded-bl-md bg-[color:var(--card-2)] text-[color:var(--fg)] shadow-[inset_0_0_0_1px_var(--border)]"
                )}
              >
                <p className="whitespace-pre-wrap break-words">{msg.texto}</p>
                <div
                  className={cn(
                    "mt-1 flex items-center justify-end gap-1",
                    isOwn ? "text-white/70" : "text-[color:var(--fg-muted)]"
                  )}
                >
                  <span className="text-[10px]">
                    {formatRelativeTime(msg.created_at)}
                  </span>
                  {isOwn && (
                    isRead
                      ? <CheckCheck className="w-3 h-3 text-[color:var(--trust-emerald)]" />
                      : <Check className="w-3 h-3 opacity-60" />
                  )}
                </div>
              </div>
              {!isOwn && (
                // Botón de reportar mensaje. Visible siempre con baja opacidad,
                // se intensifica al hover. Patrón cross-platform (evita
                // colisión con long-press nativo de Capacitor en Android).
                // TODO(capacitor): si en device real este UX no encaja, migrar
                // a long-press con bloqueo de selección nativa.
                <ReportMenuButton
                  targetType="message"
                  targetId={msg.id}
                  targetLabel={msg.texto.slice(0, 60)}
                  iconSize={14}
                  ariaLabel="Reportar mensaje"
                  className="opacity-40 group-hover:opacity-100 transition-opacity"
                />
              )}
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      {/* Send error */}
      {sendError && (
        <p className="px-4 pt-2 text-xs text-[color:var(--danger)]">
          {sendError}
        </p>
      )}

      {/* Input */}
      <form
        onSubmit={handleSend}
        className="flex shrink-0 items-center gap-2 px-4 py-3 shadow-[inset_0_1px_0_0_var(--border)]"
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Escribe un mensaje..."
          className="flex-1 rounded-full bg-[color:var(--card-2)] px-4 py-2.5 text-sm text-[color:var(--fg)] outline-none shadow-[inset_0_0_0_1px_var(--border)] placeholder:text-[color:var(--fg-dim)] focus:shadow-[inset_0_0_0_1px_var(--brand-tint-strong)]"
        />
        <button
          type="submit"
          disabled={!input.trim()}
          className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-[color:var(--brand)] text-white shadow-[var(--shadow-glow)] transition-all hover:bg-[color:var(--brand-dark)] disabled:opacity-50 disabled:shadow-none"
        >
          <Send className="h-4 w-4" />
        </button>
      </form>
    </div>
  );
}
