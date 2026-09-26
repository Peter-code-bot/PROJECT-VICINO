"use client";

import { useEffect, useRef, useState } from "react";
import { getChatProducts, selectChatProduct } from "../actions";
import type { ProductoActivoChat, ProductoChat } from "@/lib/chat/producto-activo";

export function ChatProductSelector({ chatId, currentUserId, active, onSelected, onRefresh }: {
  chatId: string;
  currentUserId: string;
  active: ProductoActivoChat;
  onSelected: (next: ProductoActivoChat) => void;
  onRefresh?: () => void;
}) {
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState({ text: "", request: 0 });
  const [products, setProducts] = useState<ProductoChat[]>([]);
  const [selected, setSelected] = useState(active.product?.id ?? "");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const submitting = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    let disposed = false;
    void getChatProducts({ chatId, query: search.text }).then(result => {
      if (disposed) return;
      if ("error" in result) { setProducts([]); setError(result.error); return; }
      setProducts((result.data ?? []).filter(p => p.estatus === "disponible" && !p.is_hidden));
    }).catch(() => { if (!disposed) setError("No pudimos cargar los productos. Intenta de nuevo."); })
      .finally(() => { if (!disposed) setLoading(false); });
    return () => { disposed = true; };
  }, [chatId, search]);

  const choice = products.find(p => p.id === selected);
  async function apply() {
    if (!choice || submitting.current) return;
    submitting.current = true;
    setSaving(true); setError("");
    try {
      const result = await selectChatProduct({ chatId, productId: choice.id, expectedRevision: active.revision });
      if (!mounted.current) return;
      if ("error" in result) { setError(result.error); onRefresh?.(); return; }
      if (result.data) onSelected(result.data);
    } catch { if (mounted.current) setError("No pudimos confirmar el cambio. Reintenta para comprobar el producto actual."); }
    finally { submitting.current = false; if (mounted.current) setSaving(false); }
  }
  return <section aria-label="Seleccionar producto de la conversación" className="max-h-[45vh] shrink-0 space-y-2 overflow-y-auto border-b border-border px-4 py-3 text-sm">
    <p className="text-xs text-muted-foreground">El producto seleccionado se comparte con la otra persona. Las confirmaciones existentes conservan su producto.</p>
    <form className="flex gap-2" onSubmit={event => {
      event.preventDefault(); setLoading(true); setError("");
      setSearch(previous => ({ text: query.trim(), request: previous.request + 1 }));
    }}>
      <label className="flex-1 text-xs">Buscar producto
        <input value={query} maxLength={100} onChange={event => setQuery(event.target.value)} className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2" />
      </label>
      <button type="submit" disabled={loading || saving} className="min-h-12 self-end rounded-lg border border-border px-3 disabled:opacity-50">Buscar</button>
    </form>
    {error && <p role="alert" className="text-xs text-danger">{error}</p>}
    {loading ? <p role="status">Cargando productos…</p> : products.length ? <>
      <label className="block text-xs">Producto de la conversación
        <select value={choice ? selected : ""} disabled={saving} onChange={event => setSelected(event.target.value)} className="mt-1 min-h-12 w-full rounded-lg border border-border bg-background px-3">
          <option value="">Elige un producto</option>
          {products.map(p => <option key={p.id} value={p.id}>{p.titulo} · {p.creador_id === currentUserId ? "Tú vendes" : "La otra persona vende"}</option>)}
        </select>
      </label>
      {products.length === 50 && <p className="text-xs text-muted-foreground">Mostramos hasta 50 resultados. Busca por nombre para encontrar otro producto.</p>}
      <button type="button" disabled={!choice || saving} onClick={() => void apply()} className="min-h-12 rounded-lg bg-brand px-4 text-white disabled:opacity-50">
        {saving ? "Guardando…" : "Aplicar producto"}
      </button>
    </> : !error && <p className="text-xs text-muted-foreground">No hay productos disponibles para esta búsqueda.</p>}
  </section>;
}
