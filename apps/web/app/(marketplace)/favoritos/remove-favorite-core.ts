import { z } from "zod";
import * as Sentry from "@sentry/nextjs";
import { toggleFavoriteSchema } from "@vicino/shared";

const uuidSchema = z.string().uuid();

export interface RemoveFavoriteDeps {
  getSupabaseClient: () => Promise<any> | any;
  getUser: (client: any) => Promise<{ id: string } | null>;
  enforceRateLimit: (key: string) => Promise<{ ok: boolean; error?: string }>;
  revalidate: (path: string) => Promise<void>;
}

/**
 * Lógica interna desacoplada para la retirada idempotente de un favorito.
 * Utilizada tanto por la Server Action pública en servidor (actions.ts)
 * como por suites de verificación unitarias.
 */
export async function removeFavoriteCore(
  productId: string,
  deps: RemoveFavoriteDeps
) {
  if (!uuidSchema.safeParse(productId).success) return { error: "ID inválido" };

  const supabase = await deps.getSupabaseClient();
  const user = await deps.getUser(supabase);
  if (!user) return { error: "No autenticado" };

  const rate = await deps.enforceRateLimit(`write:${user.id}`);
  if (!rate.ok) return { error: rate.error };

  const parsed = toggleFavoriteSchema.safeParse({ product_id: productId });
  if (!parsed.success) {
    return { error: parsed.error.errors[0]?.message ?? "Producto inválido" };
  }

  const { error: deleteErr } = await supabase
    .from("favorites")
    .delete()
    .eq("usuario_id", user.id)
    .eq("producto_id", parsed.data.product_id);

  if (deleteErr) {
    Sentry.captureException(deleteErr, {
      tags: { action: "removeFavorite", step: "delete" },
      contexts: {
        favorite: { productId: parsed.data.product_id },
        supabase: { code: deleteErr.code },
      },
    });
    return { error: "No se pudo quitar de favoritos. Intenta de nuevo." };
  }

  await deps.revalidate("/favoritos");
  return { success: true, isFavorite: false };
}
