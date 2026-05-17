"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { formatRelativeTime } from "@vicino/shared";
import { Send, Handshake, ArrowLeft, Check, CheckCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { sendMessage } from "../actions";
import { SaleConfirmationCard } from "./sale-confirmation-card";
import { SaleConfirmationForm } from "./sale-confirmation-form";
import Link from "next/link";

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

interface SaleConfirmation {
  id: string;
  product_id: string;
  buyer_id: string;
  seller_id: string;
  precio_acordado: number;
  cantidad: number;
  metodo_pago: string | null;
  tipo_entrega: string;
  status: string;
  initiated_by: string;
  buyer_confirmed: boolean;
  seller_confirmed: boolean;
  created_at: string;
  products_services: { titulo: string } | { titulo: string }[] | null;
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
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState("");
  const [showSaleForm, setShowSaleForm] = useState(false);
  const [showOlderConfirmations, setShowOlderConfirmations] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const supabase = createClient();

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
            if (prev.some((m) => m.id === newMsg.id)) return prev;
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

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || sending) return;

    const text = input.trim();
    setInput("");
    setSending(true);
    setSendError("");

    // Optimistic update
    const optimisticMsg: Message = {
      id: `temp-${Date.now()}`,
      chat_id: chatId,
      autor_id: currentUserId,
      texto: text,
      attachments: [],
      created_at: new Date().toISOString(),
      leido_por_comprador: isBuyer,
      leido_por_vendedor: !isBuyer,
    };
    setMessages((prev) => [...prev, optimisticMsg]);

    const result = await sendMessage(chatId, text);
    if (result.error) {
      // Remove optimistic message on error and surface the reason
      setMessages((prev) => prev.filter((m) => m.id !== optimisticMsg.id));
      setSendError(result.error);
    }
    setSending(false);
  }

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem-4rem)] md:h-[calc(100vh-3.5rem)]">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b shrink-0">
        <Link href="/chat" className="md:hidden">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center">
          <span className="text-sm font-medium">
            {otherUser?.nombre?.charAt(0)?.toUpperCase() ?? "?"}
          </span>
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-medium text-sm truncate">
            {otherUser?.nombre ?? "Usuario"}
          </p>
          {product && (
            <p className="text-xs text-muted-foreground truncate">
              {product.titulo}
            </p>
          )}
        </div>
        <button
          onClick={() => setShowSaleForm(!showSaleForm)}
          className="flex items-center gap-1.5 rounded-md bg-green-600 hover:bg-green-700 text-white px-3 py-1.5 text-xs font-medium transition-colors"
        >
          <Handshake className="h-3.5 w-3.5" />
          Confirmar Venta
        </button>
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

      {/* Product context banner */}
      {product && (
        <Link
          href={`/buscar?q=${encodeURIComponent(product.titulo)}`}
          className="flex items-center gap-3 mx-4 mt-2 p-3 rounded-xl bg-white/5 dark:bg-white/5 border border-border/30 hover:bg-white/10 transition-colors"
        >
          {product.imagen_principal ? (
            <img
              src={product.imagen_principal}
              alt=""
              className="w-12 h-12 rounded-lg object-cover shrink-0"
            />
          ) : (
            <div className="w-12 h-12 rounded-lg bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center shrink-0 text-lg">
              📷
            </div>
          )}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{product.titulo}</p>
            <p className="text-xs text-muted-foreground">
              ${product.precio.toLocaleString("es-MX")} MXN · Ver publicación →
            </p>
          </div>
        </Link>
      )}

      {/* Sale confirmation cards — collapsible if multiple */}
      {saleConfirmations.length > 0 && (
        <div className="px-4 py-2 space-y-2 border-b bg-muted/30">
          <SaleConfirmationCard
            confirmation={saleConfirmations[0]!}
            currentUserId={currentUserId}
          />
          {saleConfirmations.length > 1 && (
            <>
              <button
                onClick={() => setShowOlderConfirmations(!showOlderConfirmations)}
                className="w-full text-center text-xs text-muted-foreground hover:text-foreground py-1 transition-colors"
              >
                {showOlderConfirmations
                  ? "Ocultar confirmaciones anteriores"
                  : `Ver ${saleConfirmations.length - 1} confirmación${saleConfirmations.length - 1 > 1 ? "es" : ""} anterior${saleConfirmations.length - 1 > 1 ? "es" : ""}`}
              </button>
              {showOlderConfirmations &&
                saleConfirmations.slice(1).map((sc) => (
                  <SaleConfirmationCard
                    key={sc.id}
                    confirmation={sc}
                    currentUserId={currentUserId}
                  />
                ))}
            </>
          )}
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
        {messages.map((msg) => {
          const isOwn = msg.autor_id === currentUserId;
          // Read receipt: check if the OTHER party has read the message
          const isRead = isOwn
            ? (isBuyer ? msg.leido_por_vendedor : msg.leido_por_comprador)
            : false;

          return (
            <div
              key={msg.id}
              className={cn("flex", isOwn ? "justify-end" : "justify-start")}
            >
              <div
                className={cn(
                  "max-w-[80%] rounded-2xl px-3.5 py-2 text-sm",
                  isOwn
                    ? "bg-primary text-primary-foreground rounded-br-md"
                    : "bg-muted rounded-bl-md"
                )}
              >
                <p className="whitespace-pre-wrap break-words">{msg.texto}</p>
                <div
                  className={cn(
                    "flex items-center justify-end gap-1 mt-1",
                    isOwn ? "text-primary-foreground/70" : "text-muted-foreground"
                  )}
                >
                  <span className="text-[10px]">
                    {formatRelativeTime(msg.created_at)}
                  </span>
                  {isOwn && (
                    isRead
                      ? <CheckCheck className="w-3 h-3 text-emerald-400" />
                      : <Check className="w-3 h-3 opacity-60" />
                  )}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      {/* Send error */}
      {sendError && (
        <p className="px-4 pt-2 text-xs text-red-600 dark:text-red-400">
          {sendError}
        </p>
      )}

      {/* Input */}
      <form
        onSubmit={handleSend}
        className="flex items-center gap-2 px-4 py-3 border-t shrink-0"
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Escribe un mensaje..."
          className="flex-1 rounded-full border bg-background px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary"
        />
        <button
          type="submit"
          disabled={!input.trim() || sending}
          className="flex items-center justify-center w-10 h-10 rounded-full bg-primary text-primary-foreground disabled:opacity-50"
        >
          <Send className="h-4 w-4" />
        </button>
      </form>
    </div>
  );
}
