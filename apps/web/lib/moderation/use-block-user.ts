"use client";

import { useCallback } from "react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";

/**
 * Hook para bloquear/desbloquear a otro usuario.
 *
 * El bloqueo es bidireccional vía RLS: si A bloquea a B, ni A ve a B ni
 * B ve a A automáticamente en queries de profiles, products_services,
 * reviews y messages. No hace falta filtrar manualmente en el cliente.
 *
 * Ver supabase/migrations/20260429120001_moderation_rls.sql
 */
export function useBlockUser() {
  return useCallback(async (blockedId: string): Promise<boolean> => {
    const supabase = createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      toast.error("Inicia sesión para bloquear usuarios.");
      return false;
    }

    if (user.id === blockedId) {
      toast.error("No puedes bloquearte a ti mismo.");
      return false;
    }

    const { error } = await supabase.from("user_blocks").insert({
      blocker_id: user.id,
      blocked_id: blockedId,
    });

    if (error) {
      // 23505 = UNIQUE constraint → ya estaba bloqueado
      if (error.code === "23505") {
        toast.info("Ya tenías bloqueado a este usuario.");
        return true;
      }
      toast.error("No pudimos bloquear al usuario. Intenta de nuevo.");
      return false;
    }

    toast.success("Usuario bloqueado. Ya no verás su contenido.");
    return true;
  }, []);
}

export function useUnblockUser() {
  return useCallback(async (blockedId: string): Promise<boolean> => {
    const supabase = createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      toast.error("Inicia sesión.");
      return false;
    }

    const { error } = await supabase
      .from("user_blocks")
      .delete()
      .eq("blocker_id", user.id)
      .eq("blocked_id", blockedId);

    if (error) {
      toast.error("No pudimos desbloquear al usuario.");
      return false;
    }

    toast.success("Usuario desbloqueado.");
    return true;
  }, []);
}
