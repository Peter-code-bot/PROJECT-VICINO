"use client";

import { publicProfileName } from "@vicino/shared";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { BotonRegresar } from "@/components/ui/boton-regresar";
import { createClient } from "@/lib/supabase/client";
import { canalesGestionados, refrescoCoalescido } from "@/lib/realtime/canales-gestionados";
import { recuperacionConexion } from "@/lib/realtime/recuperacion-conexion";
import { reconciliarChat, recuperarVentasChat, fusionarMensajes, ultimoConfirmado, type Cursor, type Intervalo } from "@/lib/realtime/reconciliar-chat";
import { formatPrice, formatRelativeTime, cleanDisplayName } from "@vicino/shared";
import { priceFallbackLabel } from "@/lib/price-mode";
import { Send, Handshake, Check, CheckCheck, Loader2, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { sendMessage, getMessagesBefore } from "../actions";
import { hapticMedium } from "@/lib/haptics";
import { useOptimisticMutation } from "@/hooks/use-optimistic-mutation";
import { useInfiniteCursor } from "@/hooks/use-infinite-cursor";
import { useDeferredSales, type SalesSeed } from "@/hooks/use-deferred-sales";
import { useVisibleChatRead } from "@/hooks/use-visible-chat-read";
import type { SaleConfirmation } from "./sale-confirmation-card";
import { ChatOperationCard } from "./chat-operation-card";
import { useChatOperations } from "@/hooks/use-chat-operations";
import { operationForMessage } from "@/lib/chat/operations";
import type { OperationCursor } from "@/lib/chat/operations";
import { readChatViewState, saveChatViewState } from "@/lib/chat/view-state";
import { ChatSalesHistoryDrawer } from "./chat-sales-history-drawer";
import { SaleConfirmationForm } from "./sale-confirmation-form";
import { ChatProductSelector } from "./chat-product-selector";
import { productoElegible, reconciliarProducto, type ProductoActivoChat, type ProductoChat } from "@/lib/chat/producto-activo";
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
  message_type?: string | null;
  intent_status?: string | null;
  publicacion_id?: string | null;
  sale_confirmation_id?: string | null;
}


interface ChatWindowProps {
  chatId: string;
  currentUserId: string;
  isBuyer: boolean;
  otherUser: { id: string; nombre: string; foto: string | null; trust_level: string } | null;
  product: ProductoChat | null;
  productRevision: number;
  initialMessages: Message[];
  initialSaleConfirmations: SaleConfirmation[];
  salesSeed?: Promise<SalesSeed>;
  readinessToken?: string;
  buyIntentFailed?: boolean;
  missingPurchaseIntent?: boolean;
  deletedAt: string | null;
  /** Si algun participante tiene productos disponibles al cargar el chat.
   *  null = desconocido (fallo la consulta). */
  hayProductosDisponibles?: boolean | null;
}

export function ChatWindow({
  chatId,
  currentUserId,
  isBuyer,
  otherUser,
  product: initialProduct,
  productRevision,
  initialMessages,
  initialSaleConfirmations,
  salesSeed,
  readinessToken,
  buyIntentFailed = false,
  missingPurchaseIntent = false,
  deletedAt,
  hayProductosDisponibles = null,
}: ChatWindowProps) {
  const chatAccessRef = useRef({ allowed: true });
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
      const access = chatAccessRef.current;
      if (!access.allowed) return { items: [], nextCursor: null };
      // The hook only invokes the action when cursor !== null (gated by
      // hasMore). The non-null assertion is safe.
      const result = await getMessagesBefore(chatId, cursor as string, limit);
      if (!access.allowed || access !== chatAccessRef.current) return { items: [], nextCursor: null };
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
  const [retryingSales, setRetryingSales] = useState(false);
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
  const [activeProduct, setActiveProduct] = useState<ProductoActivoChat>({ product: initialProduct, revision: productRevision });
  const [productSeed, setProductSeed] = useState({ product: initialProduct, revision: productRevision });
  if (productSeed.product !== initialProduct || productSeed.revision !== productRevision) {
    const next = { product: initialProduct, revision: productRevision };
    setProductSeed(next);
    setActiveProduct(previous => reconciliarProducto(previous, next));
  }
  const product = activeProduct.product;
  const applyProduct = useCallback((next: ProductoActivoChat) => setActiveProduct(prev => reconciliarProducto(prev, next)), []);
  const [saleDraft, setSaleDraft] = useState<{ productId: string; revision: number } | null>(null);
  const [showProductSelector, setShowProductSelector] = useState(false);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [restoredHistory, setRestoredHistory] = useState<{ ids: string[]; cursor: OperationCursor | null } | null>(null);
  const [operationsAllowed, setOperationsAllowed] = useState(true);
  const operations = useChatOperations(chatId, [
    ...messages.filter(message => ["purchase_intent", "sale_proposed"].includes(message.message_type ?? "")).map(message => message.id),
    ...saleConfirmations.map(sale => sale.id),
  ], restoredHistory, operationsAllowed);
  const refreshOperationsRef = useRef<() => void>(() => {});
  const { refresh: refreshOperations } = operations;
  useEffect(() => { refreshOperationsRef.current = () => { void refreshOperations(); }; }, [refreshOperations]);
  const [expandedOperations, setExpandedOperations] = useState<Set<string>>(new Set());
  const historyTriggerRef = useRef<HTMLButtonElement>(null);
  const historyOpenerRef = useRef<HTMLButtonElement | null>(null);
  const pendingOperation = operations.operations.find(op => op.status === "accepted" || op.status === "pending_confirmation");
  const toggleOperation = (id: string) => setExpandedOperations(previous => {
    const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next;
  });
  const eligibleProduct = productoElegible(product, [currentUserId, otherUser?.id ?? ""]);
  // Sin producto elegible y sin nada publicado por ninguno de los dos, no hay
  // venta posible: se ocultan "Confirmar Venta" y el selector, que solo
  // decian "Ningun participante tiene productos disponibles". Si no se pudo
  // saber (null) se muestran como antes.
  const hayQueVender = eligibleProduct || hayProductosDisponibles !== false;
  const showSaleForm = salesStatus === "ready" && !!saleDraft && saleDraft.revision === activeProduct.revision && saleDraft.productId === product?.id && eligibleProduct;
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
  const restoredViewRef = useRef(false);
  const saveView = () => saveChatViewState(currentUserId, chatId, {
    draft: input, expanded: [...expandedOperations], scrollTop: scrollContainerRef.current?.scrollTop ?? 0,
    historyOpen: showHistoryModal,
    history: { ids: operations.history.map(op => op.intentMessageId ?? op.id), cursor: operations.nextCursor },
  });
  useLayoutEffect(() => {
    const saved = readChatViewState(currentUserId, chatId);
    if (!saved) return;
    restoredViewRef.current = true;
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      setInput(saved.draft); setExpandedOperations(new Set(saved.expanded)); setShowHistoryModal(saved.historyOpen);
      setRestoredHistory(saved.history);
      requestAnimationFrame(() => { if (active && scrollContainerRef.current) scrollContainerRef.current.scrollTop = saved.scrollTop; });
    });
    return () => { active = false; };
  }, [currentUserId, chatId]);
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
  const syncChatRef = useRef<() => void>(() => {});
  const retryRecoveryRef = useRef<() => void>(() => {});
  const retrySalesRef = useRef<() => void>(() => {});
  const preserveRecoveryScrollRef = useRef(false);
  const recoveryAnchorRef = useRef<{ id: string; top: number } | null>(null);
  // SSR ya entrego una lectura autorizada. La primera conciliacion es silenciosa.
  const [recovery, setRecovery] = useState<"recovering" | "pending" | "more" | "synced" | "denied">("synced");
  const [liveConnection, setLiveConnection] = useState<"connecting" | "connected" | "pending">("connecting");
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
        syncChatRef.current();
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
    let authorized = true;
    const access = { allowed: true };
    chatAccessRef.current = access;
    const controller = canalesGestionados(supabase);
    // Una escritura sana tambien necesita reconciliar, pero no abre un incidente
    // de conexion. La revision evita que una lectura anterior cierre una
    // recuperacion solicitada mientras esa lectura estaba en vuelo.
    let needsRecovery = false;
    let recoveryRevision = 0;
    const pending = () => {
      if (!disposed && authorized) {
        needsRecovery = true;
        recoveryRevision++;
        setRecovery("pending");
      }
    };
    let recover = () => {};
    const connection = recuperacionConexion({
      reconectar: () => controller.reintentar(`chat:${chatId}`),
      recuperar: () => recover(),
      pendiente: pending,
      disponible: () => !disposed && authorized && navigator.onLine && document.visibilityState !== "hidden",
      conexion: (status) => { if (!disposed && authorized) setLiveConnection(previous => status === "connecting" && previous === "pending" ? previous : status); },
    });
    retryRecoveryRef.current = () => {
      if (disposed || !authorized) return;
      if (!navigator.onLine || document.visibilityState === "hidden") return;
      needsRecovery = true;
      recoveryRevision++;
      if (!disposed) setRecovery("recovering");
      connection.reintentar();
    };
    // Los HTTP sobreviven a una sustitucion del canal, pero nunca al montaje
    // ni a su identidad. Solo los eventos WS usan la generacion de su canal.
      const changedMessages = new Map<string, Message>();
      const changedSales = new Map<string, Omit<SaleConfirmation, "products_services"> | null>();
      const refreshSales = refrescoCoalescido(async () => {
        if (disposed || !authorized) return;
        setRetryingSales(true);
        changedSales.clear();
        const snapshot = await recuperarVentasChat(supabase, chatId)
          .finally(() => { if (!disposed) setRetryingSales(false); });
        if (disposed || !authorized) return;
        refreshOperationsRef.current();
        const salesChanges = new Map(changedSales);
        applySalesSnapshot(() => {
          const sales = new Map(snapshot.map((sc) => [sc.id, sc as SaleConfirmation]));
          for (const [id, sc] of salesChanges) {
            if (!sc || !["pending_confirmation", "completed"].includes(sc.status)) sales.delete(id);
            else sales.set(id, { ...sales.get(id), ...sc, products_services: sales.get(id)?.products_services ?? null });
          }
          return [...sales.values()].sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? "") || b.id.localeCompare(a.id)).slice(0, 5);
        });
      }, () => { if (!disposed && authorized) salesFailed(); });
      retrySalesRef.current = () => refreshSales.solicitar();
      const refresh = refrescoCoalescido(async () => {
        if (disposed || !authorized || !navigator.onLine || document.visibilityState === "hidden") return;
        const revision = recoveryRevision;
        if (needsRecovery) setRecovery("recovering");
        changedMessages.clear();
        const result = await reconciliarChat(supabase, {
          chatId, userId: currentUserId, deletedAt,
          loadedIds: messagesRef.current.map((m) => m.id),
          cursor: recoveredCursorRef.current, intervalo: incompleteRef.current,
        });
        if (disposed) return;
        if (result.denied) {
          setOperationsAllowed(false);
          setShowHistoryModal(false);
          authorized = false;
          access.allowed = false;
          connection.cancelar();
          refreshSales.cancelar();
          setMessages([]);
          setSaleConfirmations([]);
          salesFailed();
          setRecovery("denied");
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
        refreshSales.solicitar();
        if (!sending) {
          recoveredCursorRef.current = result.cursor;
          incompleteRef.current = result.intervalo;
        }
        applyProduct(result.activeProduct);
        connection.confirmada();
        if (revision !== recoveryRevision) return;
        if (result.intervalo) needsRecovery = true;
        if (needsRecovery) setRecovery(sending ? "pending" : result.intervalo ? "more" : "synced");
        // Un envio sin UUID final retiene el cursor, sin convertir una
        // sincronizacion rutinaria en un aviso de conexion pendiente.
        if (!sending && !result.intervalo) needsRecovery = false;
      }, () => { if (!disposed && authorized) connection.falloConsulta(); });
      syncChatRef.current = () => { if (!disposed && authorized) refresh.solicitar(); };
      recover = () => {
        if (disposed || !authorized) return;
        refresh.solicitar();
      };
    const unregister = controller.registrar(`chat:${chatId}`, ({ vigente }) => {
      connection.esperando();
      return supabase.channel(`chat:${chatId}`)
        .on("postgres_changes", { event: "UPDATE", schema: "public", table: "chats", filter: `id=eq.${chatId}` }, () => {
          if (vigente() && authorized) refresh.solicitar();
        })
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `chat_id=eq.${chatId}` }, (payload) => {
          if (!vigente() || !authorized) return;
          const message = payload.new as Message;
          if (message.message_type && message.message_type !== "user_text") refreshOperationsRef.current();
          changedMessages.set(message.id, message);
          if (message.autor_id === currentUserId && inFlightSendsRef.current.size > 0) return;
          setMessages((prev) => fusionarMensajes(prev, [message], new Map(), deletedAtRef.current));
        })
        .on("postgres_changes", { event: "UPDATE", schema: "public", table: "messages", filter: `chat_id=eq.${chatId}` }, (payload) => {
          if (!vigente() || !authorized) return;
          const message = payload.new as Message;
          if (message.message_type && message.message_type !== "user_text") refreshOperationsRef.current();
          changedMessages.set(message.id, message);
          setMessages((prev) => prev.map((m) => m.id === message.id ? message : m));
        })
        .on("postgres_changes", { event: "*", schema: "public", table: "sale_confirmations", filter: `chat_id=eq.${chatId}` }, (payload) => {
          if (!vigente() || !authorized) return;
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
          refreshSales.solicitar();
        })
        .subscribe((status) => {
          if (!vigente() || !authorized) return;
          connection.estado(status);
        });
    }, () => connection.pausar());
    refresh.solicitar();
    const resume = () => { if (document.visibilityState !== "hidden") connection.reintentar(); };
    const offline = () => { connection.pausar(); controller.reintentar(`chat:${chatId}`); };
    window.addEventListener("online", resume);
    window.addEventListener("focus", resume);
    window.addEventListener("offline", offline);
    document.addEventListener("visibilitychange", resume);
    return () => {
      disposed = true;
      access.allowed = false;
      connection.cancelar();
      window.removeEventListener("online", resume);
      window.removeEventListener("focus", resume);
      window.removeEventListener("offline", offline);
      document.removeEventListener("visibilitychange", resume);
      syncChatRef.current = () => {};
      retryRecoveryRef.current = () => {};
      retrySalesRef.current = () => {};
      refresh.cancelar();
      refreshSales.cancelar();
      unregister();
    };
  }, [chatId, currentUserId, deletedAt, supabase, router, setMessages, setSaleConfirmations, applySalesSnapshot, salesFailed, applyProduct]);

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
    if (restoredViewRef.current) { restoredViewRef.current = false; lastMessageIdRef.current = lastId; return; }
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
    if (recovery === "denied") return;
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
        <BotonRegresar href="/chat" aria-label="Volver a mensajes" className="md:hidden" />
        <Link
          href={`/vendedor/${otherUser?.id ?? ""}`}
          className="-mx-2 flex min-w-0 flex-1 items-center gap-3 rounded-md px-2 py-1 transition-colors hover:bg-[color:var(--bg-elev-2)]/60"
          aria-label={publicProfileName(otherUser) ? `Ver perfil de ${cleanDisplayName(publicProfileName(otherUser))}` : "Perfil de usuario"}
        >
          <UserAvatar src={otherUser?.foto} name={cleanDisplayName(publicProfileName(otherUser))} size="sm" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-[color:var(--fg)]">
              {cleanDisplayName(publicProfileName(otherUser))}
            </p>
            {product && (
              <p className="truncate text-xs text-[color:var(--fg-muted)]">
                {product.titulo}
              </p>
            )}
          </div>
        </Link>
        {(hayQueVender || pendingOperation) && (
          <button
            type="button"
            disabled={!operations.ready}
            onClick={(event) => {
              if (pendingOperation) {
                historyOpenerRef.current = event.currentTarget;
                operations.reveal(pendingOperation);
                setExpandedOperations(previous => new Set([...previous, pendingOperation.intentMessageId ?? pendingOperation.id]));
                setShowHistoryModal(true); return;
              }
              if (!eligibleProduct || !product) { setShowProductSelector(true); return; }
              setSaleDraft(showSaleForm ? null : { productId: product.id, revision: activeProduct.revision });
            }}
            className="inline-flex min-h-12 items-center gap-1.5 rounded-lg bg-[color:var(--brand)] px-3 py-1.5 text-sm font-semibold text-white shadow-[var(--shadow-glow)] transition-colors hover:bg-[color:var(--brand-dark)] disabled:opacity-50"
          >
            <Handshake className="h-3.5 w-3.5" />
            Confirmar venta
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
      {missingPurchaseIntent && (
        <div role="status" className="mx-4 mb-2 shrink-0 rounded-xl border border-[color:var(--warning)]/30 bg-[color:var(--warning)]/10 px-4 py-3 text-sm text-[color:var(--warning)]">
          Se abrió el chat sin avisar de una compra. Vuelve a la publicación y pulsa Quiero comprarlo para avisar al vendedor.
        </div>
      )}

      {salesStatus !== "ready" && <div className="mx-4 shrink-0 text-xs text-fg-muted" role="status">
        {salesStatus === "loading" ? "Cargando confirmaciones…" : <>
          No se pudieron actualizar las confirmaciones. <button type="button" className="min-h-12 font-semibold text-brand"
            disabled={retryingSales || recovery === "denied"} onClick={() => retrySalesRef.current()}>{retryingSales ? "Reintentando…" : "Reintentar"}</button>
        </>}
      </div>}

      {/* Sale confirmation form */}
      {showSaleForm && (
        <SaleConfirmationForm
          key={`${activeProduct.revision}:${product?.id}`}
          chatId={chatId}
          currentUserId={currentUserId}
          product={product}
          productRevision={activeProduct.revision}
          onClose={() => setSaleDraft(null)}
          onCreated={() => { syncChatRef.current(); void operations.refresh(); }}
          onProductRefresh={() => { syncChatRef.current(); router.refresh(); }}
        />
      )}
      <div className="mx-4 flex shrink-0 items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-2">
          {(hayQueVender || showProductSelector) && (
            <button
              type="button"
              className="min-h-12 rounded-lg px-2 font-semibold text-brand"
              onClick={() => setShowProductSelector((value) => !value)}
            >
              {showProductSelector ? "Cerrar selección" : product ? "Cambiar producto" : "Elegir producto"}
            </button>
          )}
          {product && !eligibleProduct && (
            <span className="text-muted-foreground">Este producto ya no está disponible para confirmar una venta.</span>
          )}
        </div>
        <button
          ref={historyTriggerRef}
          type="button"
          onClick={(event) => { historyOpenerRef.current = event.currentTarget; setShowHistoryModal(true); }}
          className="inline-flex items-center gap-1.5 text-sm text-fg-muted hover:text-fg font-medium py-1 px-2.5 rounded-lg hover:bg-muted transition-colors ml-auto min-h-12"
          aria-label="Abrir historial de ventas del chat"
        >
          <Clock className="w-3.5 h-3.5" />
          <span>Historial</span>
        </button>
      </div>
      {showProductSelector && <ChatProductSelector key={activeProduct.revision} chatId={chatId} currentUserId={currentUserId} active={activeProduct}
        onRefresh={() => retryRecoveryRef.current()}
        onSelected={(next) => { applyProduct(next); setSaleDraft(null); setShowProductSelector(false); syncChatRef.current(); }} />}
      {saleDraft && !showSaleForm && salesStatus === "ready" && <p role="status" className="mx-4 text-xs text-muted-foreground">
        El producto cambió o dejó de estar disponible. Revisa la selección y abre una nueva confirmación.
      </p>}

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
            <p className="line-clamp-2 text-sm font-semibold text-[color:var(--fg)]">{product.titulo}</p>
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

      {operations.error && <div role="alert" className="mx-4 text-sm text-fg-muted">
        {operations.error} <button type="button" className="min-h-12 font-semibold text-brand-hi" onClick={() => void operations.refresh()}>Actualizar operaciones</button>
      </div>}
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
          const isOperation = ["purchase_intent", "sale_proposed"].includes(msg.message_type ?? "");
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
                  isOperation ? "w-full max-w-sm text-sm text-[color:var(--fg)]" : [
                    "max-w-[80%] rounded-2xl px-3.5 py-2 text-sm",
                    isOwn
                      ? "rounded-br-md bg-[color:var(--fg)] text-[color:var(--bg)]"
                      : "rounded-bl-md bg-[color:var(--sidebar-bg)] text-[color:var(--fg)]",
                  ]
                )}
              >
                <MessagePhotos
                  adjuntos={leerAdjuntos(msg.attachments)}
                  firmas={firmas}
                  esPropio={isOwn}
                />
                {/* Una foto sola viaja con texto vacio: pintar el parrafo
                    igual dejaria una linea en blanco bajo la imagen. */}
                {isOperation && (() => {
                  const operation = operationForMessage(operations.operations, msg);
                  if (!operation) return <p className="text-sm text-fg-muted" role="status">{operations.error ?? "Consultando operación…"}</p>;
                  const key = operation.intentMessageId ?? operation.id;
                  return <ChatOperationCard operation={operation} currentUserId={currentUserId}
                    expanded={expandedOperations.has(key)} onToggle={() => toggleOperation(key)}
                    busy={operations.isPending(operation)} disabled={!operations.ready} error={operations.errorFor(operation)}
                    onBeforeProduct={saveView} onAction={(action, proposal) => operations.mutate(operation, action, proposal)} />;
                })()}
                {!isOperation && msg.texto.trim() !== "" && (
                  <p className="whitespace-pre-wrap break-words">{msg.texto}</p>
                )}
                <div
                  className={cn(
                    "mt-1 flex items-center justify-end gap-1",
                    isOwn && !isOperation ? "opacity-70" : "text-[color:var(--fg-muted)]"
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
        {(recovery !== "synced" || liveConnection === "pending") && (
          <div className="px-4 py-2 text-sm text-muted-foreground">
            <p role="status" aria-live="polite">{recovery === "denied" ? "Esta conversación ya no está disponible para tu cuenta." : recovery === "recovering" ? "Actualizando mensajes…" : recovery === "more" ? "Hay mensajes pendientes de recuperar." : recovery === "pending" ? "No se pudieron actualizar los mensajes. Reintenta." : "Conexión en vivo pendiente. Puedes enviar mensajes y reintentar."}</p>
            {recovery !== "recovering" && recovery !== "denied" && <button type="button" className="mt-2 min-h-12 rounded-lg border border-border px-3 text-fg focus-visible:outline-2 focus-visible:outline-primary" onClick={() => retryRecoveryRef.current()}>
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
        className="flex shrink-0 items-center gap-2 px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] bg-card [.keyboard-open_&]:!pb-3"
      >
        <PhotoPickerButton
          onElegir={elegirFotos}
          restantes={MAX_ADJUNTOS_POR_MENSAJE - fotos.length}
          disabled={subiendo || recovery === "denied"}
        />
        <input
          type="text"
          value={input}
          disabled={recovery === "denied"}
          onChange={(e) => setInput(e.target.value)}
          maxLength={2000}
          placeholder="Escribe un mensaje..."
          className="flex-1 rounded-full bg-[color:var(--card-2)] px-4 py-2.5 text-sm text-[color:var(--fg)] outline-none placeholder:text-[color:var(--fg-dim)] focus:shadow-[inset_0_0_0_1px_var(--brand-tint-strong)]"
        />
        <button
          type="submit"
          disabled={(!input.trim() && fotos.length === 0) || subiendo || recovery === "denied"}
          aria-label="Enviar mensaje"
          className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-[color:var(--brand)] text-white shadow-[var(--shadow-glow)] transition-all hover:bg-[color:var(--brand-dark)] disabled:opacity-50 disabled:shadow-none"
        >
          {subiendo ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </button>
      </form>
      <ChatSalesHistoryDrawer
        open={showHistoryModal}
        onClose={() => setShowHistoryModal(false)}
        currentUserId={currentUserId}
        stateKey={`${currentUserId}:${chatId}`}
        model={operations}
        expanded={expandedOperations}
        onToggle={toggleOperation}
        onBeforeProduct={saveView}
        onRestoreFocus={() => (historyOpenerRef.current ?? historyTriggerRef.current)?.focus()}
      />
    </div>
  );
}
