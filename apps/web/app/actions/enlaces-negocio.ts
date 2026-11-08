"use server";

import { z } from "zod";
import * as Sentry from "@sentry/nextjs";
import { headers } from "next/headers";
import { CANALES_ENLACE_NEGOCIO } from "@vicino/shared";
import { createClient } from "@/lib/supabase/server";
import { clicEnlaceRateLimit, enforce, getClientIp } from "@/lib/rate-limit";
import { cubetaDeClic } from "@/lib/perfil/cubeta-clic";

const clicSchema = z
  .object({
    vendedorId: z.string().uuid(),
    canal: z.enum(CANALES_ENLACE_NEGOCIO),
  })
  .strict();

/**
 * Cuenta que alguien abrio un enlace externo desde la ficha de un negocio.
 *
 * Nunca estorba la navegacion: el enlace se abre en el cliente con un <a>
 * normal y esto corre aparte. Por eso no devuelve errores al usuario; lo que
 * falle se reporta y se responde `registrado: false`. Lo que SI cuenta y lo
 * que no (dueno, canal sin configurar, perfil oculto, freno por negocio) lo
 * decide el RPC registrar_clic_enlace_negocio, que es quien tiene los datos.
 *
 * No se guarda quien toco: el RPC solo recibe el negocio y el canal. La
 * sesion se usa aqui unicamente para elegir la cubeta del freno, y la IP de
 * un invitado entra en esa cubeta como resumen con fecha, no en claro
 * (lib/perfil/cubeta-clic.ts); el limitador va sin analitica.
 */
export async function registrarClicEnlaceNegocio(input: unknown): Promise<{ registrado: boolean }> {
  const parsed = clicSchema.safeParse(input);
  if (!parsed.success) return { registrado: false };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const cubeta = cubetaDeClic({
    userId: user?.id ?? null,
    ip: user ? "" : getClientIp(await headers()),
    dia: new Date().toISOString().slice(0, 10),
  });
  const rate = await enforce(clicEnlaceRateLimit, cubeta);
  if (!rate.ok) return { registrado: false };

  const { data, error } = await supabase.rpc("registrar_clic_enlace_negocio", {
    p_vendedor_id: parsed.data.vendedorId,
    p_canal: parsed.data.canal,
  });

  if (error) {
    Sentry.captureException(error, {
      tags: { action: "registrarClicEnlaceNegocio", canal: parsed.data.canal },
      contexts: { supabase: { code: error.code } },
    });
    return { registrado: false };
  }

  return { registrado: data === true };
}
