"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { formatRelativeTime } from "@vicino/shared";
import { Send, Handshake, ArrowLeft } from "lucide-react";
import { UserAvatar } from "@/components/ui/user-avatar";
import { cn } from "@/lib/utils";
import { sendMessage } from "../actions";
import { SaleConfirmationCard } from "./sale-confirmation-card";
import { SaleConfirmationForm } from "./sale-confirmation-form";
import { ReportMenuButton } from "@/components/moderation/report-menu-button";
import Link from "next/link";

interface Message {
  id: string;
  chat_id: string;
  autor_id: string;
  texto: string;
  attachments: unknown;
  created_at: string;
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
  buyerId: string;
  sellerId: string;
  otherUser: { id: string; nombre: string; foto: string | null; trust_level: string } | null;
  product: { id: string; titulo: string; precio: number; imagen_principal: string | null } | null;
  initialMessages: Message[];
  saleConfirmations: SaleConfirmation[];
}

export function ChatWindow({
  chatId,
  currentUserId,
  isBuyer,
  buyerId,
  sellerId,
  otherUser,
  product,
  initialMessages,
  saleConfirmations,
}: ChatWindowProps) {
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [showSaleForm, setShowSaleForm] = useState(false);
  const [showSaleDetails, setShowSaleDetails] = useState(false);
  const [showOlderConfirmations, setShowOlderConfirmations] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const supabase = createClient();

  // Subscribe to new messages
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

    // Optimistic update
    const optimisticMsg: Message = {
      id: `temp-${Date.now()}`,
      chat_id: chatId,
      autor_id: currentUserId,
      texto: text,
      attachments: [],
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimisticMsg]);

    const result = await sendMessage(chatId, text);
    if (result.error) {
      // Remove optimistic message on error
      setMessages((prev) => prev.filter((m) => m.id !== optimisticMsg.id));
    }
    setSending(false);
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b shrink-0">
        <Link href="/chat" className="md:hidden">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <Link
          href={`/vendedor/${otherUser?.id ?? ""}`}
          className="flex items-center gap-3 flex-1 min-w-0 -mx-2 px-2 py-1 rounded-md hover:bg-muted/50 transition-colors"
          aria-label={otherUser?.nombre ? `Ver perfil de ${otherUser.nombre}` : "Perfil de usuario"}
        >
          <UserAvatar src={otherUser?.foto} name={otherUser?.nombre ?? "?"} size="sm" />
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
        </Link>
        {saleConfirmations.filter((s) => s.status === "pending_confirmation").length === 0 && (
          <button
            onClick={() => setShowSaleForm(!showSaleForm)}
            className="flex items-center gap-1.5 rounded-md bg-green-600 hover:bg-green-700 text-white px-3 py-1.5 text-xs font-medium transition-colors"
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
          buyerId={buyerId}
          sellerId={sellerId}
          currentUserId={currentUserId}
          product={product}
          onClose={() => setShowSaleForm(false)}
        />
      )}

      {/* Product context — compact bar */}
      {product && (
        <Link
          href={`/buscar?q=${encodeURIComponent(product.titulo)}`}
          className="flex items-center gap-2.5 px-4 py-2 border-b border-border/30 hover:bg-muted/40 transition-colors"
        >
          <div className="w-8 h-8 rounded-md bg-muted overflow-hidden shrink-0 flex items-center justify-center">
            {product.imagen_principal ? (
              <img src={product.imagen_principal} alt="" className="w-full h-full object-cover" />
            ) : (
              <span className="text-xs text-muted-foreground">{product.titulo[0]}</span>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-foreground truncate">{product.titulo}</p>
            <p className="text-[10px] text-muted-foreground">${product.precio.toLocaleString("es-MX")} MXN</p>
          </div>
        </Link>
      )}

      {/* Sale confirmation — compact collapsible banner */}
      {saleConfirmations.length > 0 && (
        <div className="mx-3 my-1">
          <button
            onClick={() => setShowSaleDetails(!showSaleDetails)}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl border border-primary/20 bg-primary/5 hover:bg-primary/10 transition-colors text-left"
          >
            <Handshake className="w-4 h-4 text-primary shrink-0" />
            <span className="text-xs font-semibold text-foreground flex-1">Confirmación de venta</span>
            <span className="text-[10px] text-muted-foreground">{showSaleDetails ? "Ocultar" : "Ver detalles"}</span>
          </button>
          {showSaleDetails && (
            <div className="mt-1 space-y-1">
              {saleConfirmations.map((sc) => (
                <SaleConfirmationCard key={sc.id} confirmation={sc} currentUserId={currentUserId} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto min-h-0 px-4 py-3 space-y-2">
        {messages.map((msg) => {
          const isOwn = msg.autor_id === currentUserId;
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
                    ? "bg-primary text-primary-foreground rounded-br-md"
                    : "bg-muted rounded-bl-md"
                )}
              >
                <p className="whitespace-pre-wrap break-words">{msg.texto}</p>
                <p
                  className={cn(
                    "text-[10px] mt-1",
                    isOwn ? "text-primary-foreground/70" : "text-muted-foreground"
                  )}
                >
                  {formatRelativeTime(msg.created_at)}
                </p>
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
