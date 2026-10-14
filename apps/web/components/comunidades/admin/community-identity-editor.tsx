"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { COMMUNITY_CATEGORIES } from "@vicino/shared";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { editarIdentidad } from "@/app/(marketplace)/comunidades/actions";
import { uploadCommunityPhoto, removeCommunityPhoto, cleanupUnreferencedCommunityPhoto } from "@/lib/comunidades/group-photo";
import type { DetalleComunidad } from "@/lib/comunidades/tipos";
import { CommunityPhotoInput } from "../community-photo-input";

export function CommunityIdentityEditor({ detalle }: { detalle: DetalleComunidad }) {
  const router = useRouter();
  const [categoria, setCategoria] = useState(detalle.categoria_id);
  const [foto, setFoto] = useState<File | null>(null);
  const [removePhoto, setRemovePhoto] = useState(false);
  const [saving, setSaving] = useState(false);
  async function save() {
    if (saving) return;
    setSaving(true);
    const supabase = createClient();
    let newPath: string | null = null;
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Inicia sesión para continuar.");
      if (foto) newPath = await uploadCommunityPhoto(supabase, detalle.id, user.id, foto);
      const result = await editarIdentidad({ community_id: detalle.id, categoria_id: categoria, foto_path: newPath ?? (removePhoto ? null : detalle.foto_path) });
      if ("error" in result) {
        if (newPath) await removeCommunityPhoto(supabase, newPath);
        toast.error(result.error);
        return;
      }
      // Delete the previous object only after the row no longer refers to it.
      if (detalle.foto_path && (newPath || removePhoto)) await removeCommunityPhoto(supabase, detalle.foto_path);
      setFoto(null); setRemovePhoto(false);
      toast.success("Categoría y foto guardadas");
      router.refresh();
    } catch {
      if (newPath) await cleanupUnreferencedCommunityPhoto(supabase, detalle.id, newPath);
      toast.error("No se pudo confirmar el cambio. Revisa la comunidad antes de volver a intentar.");
    }
    finally { setSaving(false); }
  }
  return <div className="space-y-3">
    <label className="block text-sm font-medium text-fg">Categoría
      <select value={categoria} onChange={event => setCategoria(event.target.value)} disabled={saving} className="mt-2 min-h-12 w-full rounded-xl border border-input bg-background px-3">
        {COMMUNITY_CATEGORIES.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}
      </select>
    </label>
    <CommunityPhotoInput nombre={detalle.nombre} foto={foto} onChange={file => { setFoto(file); if (file) setRemovePhoto(false); }} currentUrl={removePhoto ? null : detalle.foto_url} disabled={saving} />
    {detalle.foto_path && !foto && <label className="flex min-h-11 items-center gap-2 text-sm text-fg-muted"><input type="checkbox" checked={removePhoto} onChange={event => setRemovePhoto(event.target.checked)} disabled={saving} />Eliminar foto actual</label>}
    <button type="button" onClick={() => void save()} disabled={saving || (categoria === detalle.categoria_id && !foto && !removePhoto)} className="min-h-11 rounded-full bg-brand px-5 text-sm font-semibold text-white disabled:opacity-50">{saving ? "Guardando…" : "Guardar categoría y foto"}</button>
  </div>;
}
