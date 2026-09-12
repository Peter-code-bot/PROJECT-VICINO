"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, useTransition } from "react";
import { createClient } from "@/lib/supabase/client";
import { canalesGestionados, refrescoCoalescido } from "@/lib/realtime/canales-gestionados";
import { reconciliarChat, fusionarMensajes, ultimoConfirmado, type Cursor, type Intervalo } from "@/lib/realtime/reconciliar-chat";
import { formatPrice, formatRelativeTime } from "@vicino/shared";
import { priceFallbackLabel } from "@/lib/price-mode";
import { Send, Handshake, ArrowLeft, Check, CheckCheck, ChevronDown, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { sendMessage, getMessagesBefore } from "../actions";
import { hapticMedium } from "@/lib/haptics";
import { useOptimisticMutation } from "@/hooks/use-optimistic-mutation";
import { useInfiniteCursor } from "@/hooks/use-infinite-cursor";
import { useDeferredSales, type SalesSeed } from "@/hooks/use-deferred-sales";
import { useVisibleChatRead } from "@/hooks/use-visible-chat-read";
import { SaleConfirmationCard, StatusPill, ConfirmationStatus, SaleConfirmation } from "./sale-confirmation-card";
import { SaleConfirmationForm } from "./sale-confirmation-form";
import { ReportMenuButton } from "@/components/moderation/report-menu-button";
import { UserAvatar } from "@/components/ui/user-avatar";
import { posterUrl } from "@/lib/video-thumbnail";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CHAT_BUCKET, leerAdjuntos, subirAdjuntos } from "@/lib/chat/attachments";
import { useFirmasAdjuntos } from "@/hooks/use-firmas-adjuntos";
import { MessagePhotos } from "./message-photos";
import { PhotoPickerButton, PhotoTray, admitirFotos } from "./photo-tray";
import { MAX_ADJUNTOS_POR_MENSAJE, type ChatAttachment } from "@vicino/shared";

// A5.1: initial SSR fetch page size. Must match page.tsx's .limit(50).
// If the initial fetch returns exactly INITIAL_PAGE_SIZE items, the chat
// MAY have older messages and the cursor is seeded with the oldest one.
// If fewer items were returned, the chat is shorter than a page and
// initialCursor is null (no load-older affordance).
const INITIAL_PAGE_SIZE = 50;
const LOAD_OLDER_PAGE_SIZE = 30;

interface Message {
  id: string;
  chat_id: string;
  autor_id: string;
  texto: string;
  attachments: unknown;
  // Nulable en la base (tiene DEFAULT now(), asi que en la practica nunca lo
  // es, pero el tipo no puede afirmar lo que la base no garantiza).
  created_at: string | null;
  leido_por_comprador: boolean | null;
  leido_por_vendedor: boolean | null;
}


interface ChatWindowProps {
  chatId: string;
  currentUserId: string;
  isBuyer: boolean;
  otherUser: { id: string; nombre: string; foto: string | null; trust_level: string } | null;
  product: {
    id: string;
    titulo: string;
    precio: number | null;
    modo_precio: string | null;
    imagen_principal: string | null;
  } | null;
  initialMessages: Message[];
  initialSaleConfirmations: SaleConfirmation[];
  salesSeed?: Promise<SalesSeed>;
  readinessToken?: string;
  buyIntentFailed?: boolean;
  deletedAt: string | null;
}

export function ChatWindow({
  chatId,
  currentUserId,
  isBuyer,
  otherUser,
  product,
  initialMessages,
  initialSaleConfirmations,
  salesSeed,
  readinessToken,
  buyIntentFailed = false,
  deletedAt,
}: ChatWindowProps) {
  // A5.1: cursor-based load-older via the shared hook. The hook owns
  // the messages buffer; setItems is exposed for the FIFO temp-id
  // reclaim (Realtime INSERT echo) and the mark-as-read UPDATE handler
  // which need general setState semantics. appendLive/removeItem cover
  // the simple optimistic-send paths.
  const {
    items: messages,
    isLoading: isLoadingOlder,
    hasMore: hasOlder,
    error: loadOlderError,
    loadMore: loadOlder,
    appendLive: appendMessage,
    removeItem: removeMessage,
    setItems: setMessages,
  } = useInfiniteCursor<Message, string>({
    action: async ({ cursor, limit }) => {
      // The hook only invokes the action when cursor !== null (gated by
      // hasMore). The non-null assertion is safe.
      const result = await getMessagesBefore(chatId, cursor as string, limit);
      return { items: result.items as Message[], nextCursor: result.nextCursor, error: result.error };
    },
    initialItems: initialMessages,
    initialCursor:
      initialMessages.length === INITIAL_PAGE_SIZE && initialMessages[0]
        ? initialMessages[0].created_at
        : null,
    limit: LOAD_OLDER_PAGE_SIZE,
    prepend: true,
  });

  const { sales: saleConfirmations, status: salesStatus, updateLive: setSaleConfirmations,
    applySnapshot: applySalesSnapshot, failed: salesFailed } = useDeferredSales(initialSaleConfirmations, salesSeed);
  const [retryingSales, startSalesRetry] = useTransition();
  const lastIncomingId = messages.findLast((message) => message.autor_id !== currentUserId)?.id ?? "";
  useVisibleChatRead(chatId, currentUserId, lastIncomingId);
  const [input, setInput] = useState("");
  const [sendError, setSendError] = useState("");
  /** Fotos elegidas y aun sin mandar. Se vacia al enviar o al fallar. */
  const [fotos, setFotos] = useState<File[]>([]);
  /** Subiendo al bucket. Estado aparte de "enviando" porque es la parte lenta
   *  y la unica que conviene bloquear. */
  const [subiendo, setSubiendo] = useState(false);
  /**
   * Fotos de cada envio en vuelo, por tempId.
   *
   * Hace falta porque el fallo del INSERT no llega como excepcion: mutate
   * NUNCA rechaza (su unica salida es resolve() en el finally), asi que el
   * try/catch de handleSend no lo ve y el error aterriza en onError. Y para
   * ese momento la bandeja ya se vacio y los File originales se perdieron.
   */
  const fotosPorTempRef = useRef<Map<string, File[]>>(new Map());
  const [showSaleForm, setShowSaleForm] = useState(false);
  const [showSaleDetails, setShowSaleDetails] = useState(false);
  const [showOlderConfirmations, setShowOlderConfirmations] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  // A5.1: refs for the load-older flow.
  // scrollContainerRef -- the overflow-y-auto wrapper around the message
  //   list, owns the scroll position we must preserve across prepend.
  // topSentinelRef -- a 1px div at the very top of the message list;
  //   when the IntersectionObserver reports it visible, we snapshot the
  //   scroll position and fire loadMore.
  // pendingScrollSnapshotRef -- holds the {scrollHeight, scrollTop}
  //   captured BEFORE awaiting loadMore; consumed by useLayoutEffect on
  //   messages.length to restore the visual position after prepend.
  // lastMessageIdRef -- the id of the LAST message currently rendered.
  //   Used to discriminate "new message at bottom" (auto-scroll) from
  //   "older messages prepended at top" (do NOT auto-scroll).
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const topSentinelRef = useRef<HTMLDivElement>(null);
  const pendingScrollSnapshotRef = useRef<{ height: number; top: number } | null>(null);
  const lastMessageIdRef = useRef<string | null>(null);
  // CODEX H1 fix: isPrependingRef discriminates the source of a
  // messages.length increment for the useLayoutEffect below.
  //   true  -> the change came from cursor load-older (prepend path);
  //            apply the scroll-position adjustment from the snapshot.
  //   false -> the change came from a Realtime INSERT / optimistic send
  //            (append path); skip the adjustment, let auto-scroll-to-
  //            bottom take over.
  // Without this, a Realtime INSERT arriving WHILE a loadOlder is
  // in-flight would change messages.length first, the useLayoutEffect
  // would consume the snapshot meant for the (still-pending) prepend,
  // and once the prepend resolves a second useLayoutEffect run would
  // find no snapshot and skip the adjustment -- the user would see a
  // jump. The flag is set synchronously around loadOlder() so it is
  // open exactly across the window where the prepend commits.
  const isPrependingRef = useRef(false);
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
  const messagesRef = useRef(messages);
  const deletedAtRef = useRef(deletedAt);
  const recoveredCursorRef = useRef<Cursor | null>(ultimoConfirmado(initialMessages));
  const incompleteRef = useRef<Intervalo | null>(null);
  const inFlightSendsRef = useRef(new Set<string>());
  const retryRecoveryRef = useRef<() => void>(() => {});
  const preserveRecoveryScrollRef = useRef(false);
  const recoveryAnchorRef = useRef<{ id: string; top: number } | null>(null);
  const [recovery, setRecovery] = useState<"recovering" | "pending" | "more" | "synced">("recovering");
  useLayoutEffect(() => { messagesRef.current = messages; }, [messages]);

  const sendMutation = useOptimisticMutation(
    ({ text, attachments }: { tempId: string; text: string; attachments: ChatAttachment[] }) =>
      sendMessage(chatId, text, attachments),
    {
      onMutate: ({ tempId, text, attachments }) => {
        inFlightSendsRef.current.add(tempId);
        trackTempId(text, tempId);
        const optimisticMsg: Message = {
          id: tempId,
          chat_id: chatId,
          autor_id: currentUserId,
          texto: text,
          // El optimista lleva ya los adjuntos: si aqui fuera [], la foto
          // desapareceria un instante y reapareceria al llegar el eco de
          // realtime, que es justo el parpadeo que el optimista existe para
          // evitar.
          attachments,
          created_at: new Date().toISOString(),
          leido_por_comprador: isBuyer,
          leido_por_vendedor: !isBuyer,
        };
        // A5.1: appendLive does NOT consume the cursor (correct: this is
        // a NEW message arriving at the bottom, not an older-page item).
        appendMessage(optimisticMsg);
        return () => {
          releaseTempId(text, tempId);
          removeMessage((m) => m.id === tempId);
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
        fotosPorTempRef.current.delete(tempId);
        inFlightSendsRef.current.delete(tempId);
        retryRecoveryRef.current();
        if (!realId) return;
        setMessages((prev) =>
          prev.some((m) => m.id === realId)
            ? prev.filter((m) => m.id !== tempId)
            : prev.map((m) => (m.id === tempId ? { ...m, id: realId } : m)),
        );
      },
      onError: (err, { tempId, text, attachments }) => {
        inFlightSendsRef.current.delete(tempId);
        retryRecoveryRef.current();
        // Las fotos YA estan en el bucket y el mensaje no existe: sin esto se
        // quedan ahi para siempre, que es como se juntaron los 31 huerfanos de
        // esta manana en otros buckets. Best-effort: si la limpieza falla no
        // hay nada mas que hacer desde aqui, y tapar el error original con el
        // de la limpieza dejaria a la persona sin saber por que no se envio.
        if (attachments.length > 0) {
          void supabase.storage
            .from(CHAT_BUCKET)
            .remove(attachments.map((a) => a.path))
            .catch(() => {});
        }
        // Y se devuelve lo escrito a la bandeja: reintentar tiene que costar un
        // toque, no volver a buscar las fotos en la galeria.
        const fotosDelEnvio = fotosPorTempRef.current.get(tempId);
        if (fotosDelEnvio && fotosDelEnvio.length > 0) {
          setFotos(fotosDelEnvio);
          setInput(text);
        }
        fotosPorTempRef.current.delete(tempId);

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


  // Un canal por montaje y generacion; las referencias no reconstruyen el canal.
  useEffect(() => {
    let disposed = false;
    const controller = canalesGestionados(supabase);
    const pending = () => { if (!disposed) { setRecovery("pending"); salesFailed(); } };
    let cancelRefresh = () => {};
    const unregister = controller.registrar(`chat:${chatId}`, ({ vigente }) => {
      cancelRefresh();
      const changedMessages = new Map<string, Message>();
      const changedSales = new Map<string, Omit<SaleConfirmation, "products_services"> | null>();
      let subscribed = false;
      let subscriptionGeneration = 0;
      const refresh = refrescoCoalescido(async () => {
        if (!vigente() || !subscribed) return;
        const subscription = subscriptionGeneration;
        setRecovery("recovering");
        changedMessages.clear();
        changedSales.clear();
        const result = await reconciliarChat(supabase, {
          chatId, userId: currentUserId, deletedAt,
          loadedIds: messagesRef.current.map((m) => m.id),
          cursor: recoveredCursorRef.current, intervalo: incompleteRef.current,
        });
        if (!vigente() || subscription !== subscriptionGeneration) return;
        if (result.denied) {
          setMessages([]);
          setSaleConfirmations([]);
          setRecovery("pending");
          router.refresh();
          return;
        }
        const sending = inFlightSendsRef.current.size > 0;
        deletedAtRef.current = result.deletedAt;
        // No se emparejan textos de una instantanea con temporales. El resultado
        // real del envio decide su UUID; otra vuelta recoge los otros dispositivos.
        const recovered = result.messages.filter((m) => !sending || m.autor_id !== currentUserId);
        const changed = new Map([...changedMessages].filter(([, m]) => !sending || m.autor_id !== currentUserId));
        preserveRecoveryScrollRef.current = true;
        const container = scrollContainerRef.current;
        const anchor = container && [...container.querySelectorAll<HTMLElement>("[data-message-id]")]
          .find((node) => node.getBoundingClientRect().bottom >= container.getBoundingClientRect().top);
        recoveryAnchorRef.current = anchor ? { id: anchor.dataset.messageId!, top: anchor.getBoundingClientRect().top } : null;
        setMessages((prev) => fusionarMensajes(prev, recovered, changed, result.deletedAt));
        const salesChanges = new Map(changedSales);
        applySalesSnapshot(() => {
          const sales = new Map(result.sales.map((sc) => [sc.id, sc as SaleConfirmation]));
          for (const [id, sc] of salesChanges) {
            if (!sc || !["pending_confirmation", "completed"].includes(sc.status)) sales.delete(id);
            else sales.set(id, { ...sales.get(id), ...sc, products_services: sales.get(id)?.products_services ?? null });
          }
          return [...sales.values()].sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? "") || b.id.localeCompare(a.id)).slice(0, 5);
        });
        if (!sending) {
          recoveredCursorRef.current = result.cursor;
          incompleteRef.current = result.intervalo;
        }
        setRecovery(sending ? "pending" : result.intervalo ? "more" : "synced");
      }, pending);
      cancelRefresh = () => refresh.cancelar();
      retryRecoveryRef.current = () => { if (vigente()) refresh.solicitar(); };
      return supabase.channel(`chat:${chatId}`)
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `chat_id=eq.${chatId}` }, (payload) => {
          if (!vigente()) return;
          const message = payload.new as Message;
          changedMessages.set(message.id, message);
          if (message.autor_id === currentUserId && inFlightSendsRef.current.size > 0) return;
          setMessages((prev) => fusionarMensajes(prev, [message], new Map(), deletedAtRef.current));
        })
        .on("postgres_changes", { event: "UPDATE", schema: "public", table: "messages", filter: `chat_id=eq.${chatId}` }, (payload) => {
          if (!vigente()) return;
          const message = payload.new as Message;
          changedMessages.set(message.id, message);
          setMessages((prev) => prev.map((m) => m.id === message.id ? message : m));
        })
        .on("postgres_changes", { event: "*", schema: "public", table: "sale_confirmations", filter: `chat_id=eq.${chatId}` }, (payload) => {
          if (!vigente()) return;
          if (payload.eventType !== "DELETE") {
            const sale = payload.new as Omit<SaleConfirmation, "products_services">;
            changedSales.set(sale.id, sale);
            setSaleConfirmations((prev) => ["pending_confirmation", "completed"].includes(sale.status)
              ? prev.map((sc) => sc.id === sale.id ? { ...sc, ...sale } : sc)
              : prev.filter((sc) => sc.id !== sale.id));
          }
          if (payload.eventType === "DELETE") {
            const id = (payload.old as { id?: string }).id;
            if (id) {
              changedSales.set(id, null);
              setSaleConfirmations(prev => prev.filter(sale => sale.id !== id));
            }
          }
          refresh.solicitar();
        })
        .subscribe((status) => {
          if (!vigente()) return;
          subscriptionGeneration++;
          subscribed = status === "SUBSCRIBED";
          if (subscribed) refresh.solicitar();
          else pending();
        });
    }, pending);
    return () => {
      disposed = true;
      retryRecoveryRef.current = () => {};
      cancelRefresh();
      unregister();
    };
  }, [chatId, currentUserId, deletedAt, supabase, router, setMessages, setSaleConfirmations, applySalesSnapshot, salesFailed]);

  // A5.1: scroll preservation on prepend. Runs synchronously BEFORE
  // paint (useLayoutEffect, NOT useEffect) so the user does NOT see a
  // one-frame jump when older messages prepend.
  //
  // CODEX H1 fix: gate on isPrependingRef. Without the gate, a Realtime
  // INSERT arriving during an in-flight loadOlder would increment
  // messages.length first, consume the snapshot (calculating a delta
  // against the wrong scrollHeight), and corrupt the subsequent prepend
  // commit. With the gate, the snapshot is consumed ONLY when the change
  // is a prepend, never when it is a bottom append.
  useLayoutEffect(() => {
    const anchor = recoveryAnchorRef.current;
    recoveryAnchorRef.current = null;
    if (anchor) {
      const container = scrollContainerRef.current;
      const node = container && [...container.querySelectorAll<HTMLElement>("[data-message-id]")].find((item) => item.dataset.messageId === anchor.id);
      if (node && container) container.scrollTop += node.getBoundingClientRect().top - anchor.top;
    }
    if (!isPrependingRef.current) return;
    isPrependingRef.current = false;
    const snap = pendingScrollSnapshotRef.current;
    pendingScrollSnapshotRef.current = null;
    if (!snap) return;
    const container = scrollContainerRef.current;
    if (!container) return;
    const delta = container.scrollHeight - snap.height;
    container.scrollTop = snap.top + delta;
  }, [messages.length]);

  // A5.1: gated auto-scroll-to-bottom. Only fires when the LAST message
  // id changed (a NEW message arrived at the bottom: Realtime INSERT,
  // optimistic send, temp->real swap). Prepends do not change the last
  // id, so the user's reading position is preserved by the
  // useLayoutEffect above without a smooth-scroll override here.
  useEffect(() => {
    const lastId = messages[messages.length - 1]?.id ?? null;
    if (lastId === lastMessageIdRef.current) {
      preserveRecoveryScrollRef.current = false;
      return;
    }
    lastMessageIdRef.current = lastId;
    if (preserveRecoveryScrollRef.current) {
      preserveRecoveryScrollRef.current = false;
      return;
    }
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // CODEX ts-M1 + H1 fix: ref-mirror of isLoadingOlder so the
  // IntersectionObserver callback can read the latest value without
  // forcing the effect (and the observer) to re-arm on every toggle.
  // Declared BEFORE the observer effect so the closure capture is
  // legal under TypeScript's temporal-dead-zone semantics for const.
  const isLoadingOlderRef = useRef(false);
  useEffect(() => {
    isLoadingOlderRef.current = isLoadingOlder;
  }, [isLoadingOlder]);

  // A5.1: IntersectionObserver on the top sentinel triggers loadOlder.
  // CRITICAL: snapshot {scrollHeight, scrollTop} BEFORE awaiting the
  // action and flip isPrependingRef = true so the useLayoutEffect above
  // can compute the correct delta and discriminate this commit from a
  // Realtime INSERT append.
  //
  // CODEX ts-M1 fix: isLoadingOlder is read from the ref above, NOT a
  // dep of the effect. Previously the effect re-armed on every load
  // start/finish, and if the sentinel was still visible at the moment
  // of re-arm, the new observer fired immediately. The hook's
  // inFlightRef collapsed the duplicate loadMore, but the snapshot was
  // still being written each time. With isLoadingOlder out of the deps
  // the observer is set up once per hasOlder transition and the
  // inflight check runs only inside the callback against the latest
  // ref value.
  useEffect(() => {
    if (!hasOlder) return;
    const sentinel = topSentinelRef.current;
    const container = scrollContainerRef.current;
    if (!sentinel || !container) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry?.isIntersecting) return;
        if (isLoadingOlderRef.current) return;
        // CODEX H1 fix: set the prepend flag SYNCHRONOUSLY around the
        // loadOlder call so the useLayoutEffect can distinguish this
        // commit from a concurrent Realtime INSERT append.
        isPrependingRef.current = true;
        pendingScrollSnapshotRef.current = {
          height: container.scrollHeight,
          top: container.scrollTop,
        };
        void loadOlder().catch(() => {
          // Reset the flag if loadOlder rejects so a subsequent
          // unrelated append does not consume the stale snapshot.
          isPrependingRef.current = false;
          pendingScrollSnapshotRef.current = null;
        });
      },
      { root: container, threshold: 0.1 },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasOlder, loadOlder]);

  // Todas las rutas visibles, firmadas de una sola vez. El hook compara por
  // contenido para no pedir firmas nuevas en cada repintado.
  const rutasVisibles = useMemo(
    () => messages.flatMap((m) => leerAdjuntos(m.attachments).map((a) => a.path)),
    [messages],
  );
  const firmas = useFirmasAdjuntos(supabase, rutasVisibles);

  function elegirFotos(nuevas: File[]) {
    const { fotos: siguientes, aviso } = admitirFotos(fotos, nuevas);
    setFotos(siguientes);
    setSendError(aviso);
  }

  function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (subiendo) return;
    // Una foto sola ya es un mensaje. El texto deja de ser obligatorio.
    if (!input.trim() && fotos.length === 0) return;

    void hapticMedium();
    const text = input.trim();
    const porSubir = fotos;
    setInput("");
    setFotos([]);
    setSendError("");

    // Unique temp id per send so rapid consecutive optimistic messages
    // do not collide. Math.random suffix guards against same-millisecond
    // multiple sends from a fast user.
    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    if (porSubir.length === 0) {
      void sendMutation.mutate({ tempId, text, attachments: [] });
      return;
    }

    // Con fotos, la subida va ANTES del optimista. Pintar el mensaje y subir
    // despues obligaria a deshacerlo en pantalla si la subida falla, y eso es
    // peor que esperar: el mensaje ya publicado con la foto sin llegar.
    void (async () => {
      setSubiendo(true);
      try {
        const adjuntos = await subirAdjuntos(supabase, chatId, currentUserId, porSubir);
        // Se anota ANTES de mandar: si el INSERT falla, onError es quien tiene
        // que poder deshacer, y para entonces porSubir ya no esta a su alcance.
        fotosPorTempRef.current.set(tempId, porSubir);
        await sendMutation.mutate({ tempId, text, attachments: adjuntos });
      } catch (error) {
        // Se devuelven las fotos a la tira para que reintentar sea un toque y
        // no volver a buscarlas en la galeria.
        setFotos(porSubir);
        setInput(text);
        setSendError(
          error instanceof Error && error.message
            ? `No se pudieron enviar las fotos: ${error.message}`
            : "No se pudieron enviar las fotos",
        );
      } finally {
        setSubiendo(false);
      }
    })();
  }

  return (
    <div data-navigation-kind="chat_detail" data-navigation-ready={readinessToken} className="flex flex-col h-full min-h-0">
      {/* Header */}
      <div className="flex shrink-0 items-center gap-3 border-b border-border/10 px-4 pb-3 pt-[calc(0.75rem+env(safe-area-inset-top))]">
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
        {salesStatus === "ready" && saleConfirmations.filter((s) => s.status === "pending_confirmation").length === 0 && (
          <button
            onClick={() => setShowSaleForm(!showSaleForm)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[color:var(--brand)] px-3 py-1.5 text-xs font-semibold text-white shadow-[var(--shadow-glow)] transition-colors hover:bg-[color:var(--brand-dark)]"
          >
            <Handshake className="h-3.5 w-3.5" />
            Confirmar Venta
          </button>
        )}
      </div>

      {/* Aviso de intencion de compra no enviada. El comprador llego desde
          el CTA de "quiere comprar" pero el mensaje automatico no se pudo
          insertar (o el producto ya no es visible para el). Sin este aviso
          creeria que el vendedor ya fue notificado. shrink-0 para no comerle
          altura al scroll de mensajes dentro del flex column h-full. */}
      {buyIntentFailed && (
        <div
          role="status"
          className="mx-4 mb-2 shrink-0 rounded-xl border border-[color:var(--warning)]/30 bg-[color:var(--warning)]/10 px-4 py-3 text-sm text-[color:var(--warning)]"
        >
          No pudimos avisarle al vendedor que te interesa. Escríbele tú aquí abajo para que se entere.
        </div>
      )}

      {salesStatus !== "ready" && <div className="mx-4 shrink-0 text-xs text-fg-muted" role="status">
        {salesStatus === "loading" ? "Cargando confirmaciones…" : <>
          No se pudieron actualizar las confirmaciones. <button type="button" className="min-h-11 font-semibold text-brand"
            disabled={retryingSales} onClick={() => { retryRecoveryRef.current(); startSalesRetry(() => router.refresh()); }}>{retryingSales ? "Reintentando…" : "Reintentar"}</button>
        </>}
      </div>}

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
          className="mx-4 my-2 flex items-center gap-2.5 rounded-xl bg-[color:var(--bg-elev-2)] dark:bg-[color:var(--card-2)] px-3 py-2 shadow-[inset_0_0_0_1px_var(--brand-tint-strong)] transition-shadow hover:shadow-[inset_0_0_0_1px_var(--brand)]"
        >
          <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-md bg-[color:var(--bg-elev-2)] shadow-[inset_0_0_0_1px_var(--border)]">
            {product.imagen_principal ? (
              <img src={posterUrl(product.imagen_principal)} alt="" className="h-full w-full object-cover" />
            ) : (
              <span className="text-xs text-[color:var(--fg-muted)]">{product.titulo[0]}</span>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-semibold text-[color:var(--fg)]">{product.titulo}</p>
            {/* precio es nullable (modo cotizacion/reservacion). Llamar
                .toLocaleString() directo sobre null reventaba el detalle del
                chat entero con un TypeError. */}
            <p className="text-[10px] text-[color:var(--brand-hi)]">
              {(() => {
                const precioFmt = formatPrice(product.precio);
                return precioFmt
                  ? `${precioFmt} MXN`
                  : priceFallbackLabel(product.modo_precio);
              })()}
            </p>
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
        if (primarySc.status === "cancelled" || primarySc.status === "rejected" || primarySc.cancelled_by) {
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
              className="dark flex w-full items-center gap-2.5 px-3 py-2.5 text-left rounded-xl bg-[#121212] text-white transition-colors hover:bg-black"
            >
              <div className="w-7 h-7 rounded-[9px] bg-[#222222] text-white flex items-center justify-center shrink-0">
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
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto min-h-0 px-4 py-3 space-y-2">
        {/* A5.1: top sentinel + load-older indicator. The sentinel is a
            1px target the IntersectionObserver watches; when the user
            scrolls up far enough, loadOlder fires and the spinner shows
            until the next page resolves. When hasOlder becomes false the
            sentinel still mounts but the observer is not armed. */}
        {hasOlder && <div ref={topSentinelRef} className="h-px" aria-hidden="true" />}
        {isLoadingOlder && (
          <div className="flex justify-center py-2 text-[color:var(--fg-muted)]">
            <Loader2 className="h-4 w-4 animate-spin" />
          </div>
        )}
        {loadOlderError && (
          <p className="px-2 py-1 text-center text-[10px] text-[color:var(--danger)]">
            {loadOlderError}
          </p>
        )}
        {messages.map((msg) => {
          const isOwn = msg.autor_id === currentUserId;
          // Read receipt: check if the OTHER party has read the message
          const isRead = isOwn
            ? (isBuyer ? msg.leido_por_vendedor : msg.leido_por_comprador)
            : false;

          return (
            <div
              key={msg.id}
              data-message-id={msg.id}
              className={cn(
                "flex items-end gap-1 group",
                isOwn ? "justify-end" : "justify-start"
              )}
            >
              <div
                className={cn(
                  "max-w-[80%] rounded-2xl px-3.5 py-2 text-sm",
                  isOwn
                    ? "rounded-br-md bg-[color:var(--fg)] text-[color:var(--bg)]"
                    : "rounded-bl-md bg-[color:var(--sidebar-bg)] text-[color:var(--fg)]"
                )}
              >
                <MessagePhotos
                  adjuntos={leerAdjuntos(msg.attachments)}
                  firmas={firmas}
                  esPropio={isOwn}
                />
                {/* Una foto sola viaja con texto vacio: pintar el parrafo
                    igual dejaria una linea en blanco bajo la imagen. */}
                {msg.texto.trim() !== "" && (
                  <p className="whitespace-pre-wrap break-words">{msg.texto}</p>
                )}
                <div
                  className={cn(
                    "mt-1 flex items-center justify-end gap-1",
                    isOwn ? "opacity-70" : "text-[color:var(--fg-muted)]"
                  )}
                >
                  <span className="text-[10px]">
                    {msg.created_at ? formatRelativeTime(msg.created_at) : null}
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
                  targetLabel={msg.texto.trim().slice(0, 60) || "Foto enviada en el chat"}
                  iconSize={14}
                  ariaLabel="Reportar mensaje"
                  className="opacity-40 group-hover:opacity-100 transition-opacity"
                />
              )}
            </div>
          );
        })}
        {recovery !== "synced" && (
          <div className="px-4 py-2 text-sm text-muted-foreground">
            <p role="status" aria-live="polite">{recovery === "recovering" ? "Recuperando conversación…" : recovery === "more" ? "Hay mensajes pendientes de recuperar." : "Sincronización pendiente. Tus mensajes se conservan."}</p>
            {recovery !== "recovering" && <button type="button" className="mt-2 min-h-12 rounded-lg border border-border px-3 text-fg focus-visible:outline-2 focus-visible:outline-primary" onClick={() => retryRecoveryRef.current()}>
              {recovery === "more" ? "Cargar mensajes pendientes" : "Reintentar"}
            </button>}
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Send error */}
      {sendError && (
        <p className="px-4 pt-2 text-xs text-[color:var(--danger)]">
          {sendError}
        </p>
      )}

      {/* Input */}
      <PhotoTray
        fotos={fotos}
        onQuitar={(i) => setFotos((prev) => prev.filter((_, j) => j !== i))}
        ocupado={subiendo}
      />
      <form
        onSubmit={handleSend}
        className="flex shrink-0 items-center gap-2 px-4 pt-3 pb-3 bg-card supports-[-webkit-touch-callout:none]:pb-[calc(0.75rem+env(safe-area-inset-bottom))] [.keyboard-open_&]:!pb-3"
      >
        <PhotoPickerButton
          onElegir={elegirFotos}
          restantes={MAX_ADJUNTOS_POR_MENSAJE - fotos.length}
          disabled={subiendo}
        />
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          maxLength={2000}
          placeholder="Escribe un mensaje..."
          className="flex-1 rounded-full bg-[color:var(--card-2)] px-4 py-2.5 text-sm text-[color:var(--fg)] outline-none placeholder:text-[color:var(--fg-dim)] focus:shadow-[inset_0_0_0_1px_var(--brand-tint-strong)]"
        />
        <button
          type="submit"
          disabled={(!input.trim() && fotos.length === 0) || subiendo}
          className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-[color:var(--brand)] text-white shadow-[var(--shadow-glow)] transition-all hover:bg-[color:var(--brand-dark)] disabled:opacity-50 disabled:shadow-none"
        >
          {subiendo ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </button>
      </form>
    </div>
  );
}
