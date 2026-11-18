"use server";

import { revalidatePath } from "@/lib/revalidate-session";
import * as Sentry from "@sentry/nextjs";
import { createClient } from "@/lib/supabase/server";
import { cookies } from "next/headers";
import { COOKIE_DESTINO_ONBOARDING } from "@/lib/auth/acceso-invitado";
import { destinoAutenticadoSeguro } from "@/lib/auth/destino-seguro";
import { enforce, writeRateLimit } from "@/lib/rate-limit";
import {
  updateProfileSchema,
  usernameSchema,
  cleanDisplayName,
  redesNegocioSchema,
  CAMPOS_TEXTO_ENLACES_NEGOCIO,
} from "@vicino/shared";

/**
 * Marca del formulario que trae los trece enlaces (20261108230000) y el
 * interruptor de Messenger. Hace falta porque una casilla sin marcar NO viaja en
 * el FormData: sin la marca no se distingue "apago Messenger" de "este
 * formulario no conoce Messenger".
 */
const FORMULARIO_ENLACES_CON_REDES = "2";

type EnlacesParaGuardar = Record<string, string | boolean | null>;

function campoTexto(formData: FormData, nombre: string): string | null {
  const valor = formData.get(nombre);
  return typeof valor === "string" ? valor : null;
}

export async function updateProfile(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "No autenticado" };

  const rate = await enforce(writeRateLimit, `write:${user.id}`);
  if (!rate.ok) return { error: rate.error };

  // Build raw input from FormData. Empty strings collapse to null because the
  // shared schema accepts string-or-null for optional fields, and downstream
  // (DB columns + RPC TEXT params) treats null as "not set".
  const seller_type_input = (formData.get("seller_type") as string) || "casual";
  const es_vendedor = formData.get("es_vendedor") === "on";

  const raw = {
    nombre: cleanDisplayName(((formData.get("nombre") as string) ?? "").trim()),
    bio: ((formData.get("bio") as string) ?? "").trim() || null,
    foto: ((formData.get("foto") as string) ?? "").trim() || null,
    ubicacion: ((formData.get("ubicacion") as string) ?? "").trim() || null,
    es_vendedor,
    seller_type: es_vendedor && seller_type_input === "business" ? "business" : "casual",
    nombre_negocio:
      es_vendedor && seller_type_input === "business"
        ? ((formData.get("nombre_negocio") as string) ?? "").trim() || null
        : null,
    descripcion_negocio:
      es_vendedor && seller_type_input === "business"
        ? ((formData.get("descripcion_negocio") as string) ?? "").trim() || null
        : null,
    metodos_pago_aceptados: es_vendedor
      ? ((formData.get("metodos_pago_aceptados") as string) ?? "").trim() || null
      : null,
  };

  const parsed = updateProfileSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  }

  // Enlaces del negocio (contacto y redes sociales). Se validan ANTES de
  // escribir el perfil para no dejar un guardado a medias por un enlace mal
  // escrito.
  //
  // Solo se mandan los campos que el formulario TRAE: un cliente viejo, abierto
  // antes del deploy, no conoce las redes nuevas y no debe borrarlas. En
  // guardar_enlaces_negocio una clave que no viene no se toca.
  //
  // Con el modo vendedor APAGADO se QUITAN TODOS, tambien los que este
  // formulario no trae, al reves que nombre_negocio (que se conserva). Son
  // columnas publicas y legibles por cualquiera via PostgREST aunque la ficha ya
  // no las pinte; un comercio que deja de vender tiene que poder retirarlas sin
  // volver a activar nada, y apagar el modo vendedor es la unica puerta que le
  // queda (los campos solo se ven con el modo encendido). El aviso lo dice.
  const presentes = CAMPOS_TEXTO_ENLACES_NEGOCIO.filter((campo) => formData.has(campo));
  const conRedes = formData.get("enlaces_formulario") === FORMULARIO_ENLACES_CON_REDES;
  const traeEnlaces = presentes.length > 0 || conRedes;
  let enlaces: EnlacesParaGuardar | null = null;
  if (traeEnlaces && es_vendedor) {
    const entrada: EnlacesParaGuardar = Object.fromEntries(presentes.map((campo) => [campo, campoTexto(formData, campo)]));
    if (conRedes) entrada.facebook_messenger = formData.get("facebook_messenger") === "on";
    const parsedEnlaces = redesNegocioSchema.safeParse(entrada);
    if (!parsedEnlaces.success) {
      return { error: parsedEnlaces.error.issues[0]?.message ?? "Revisa los enlaces de tu negocio" };
    }
    const normalizados: Record<string, unknown> = parsedEnlaces.data;
    enlaces = Object.fromEntries(
      Object.keys(entrada).map((campo) => [campo, (normalizados[campo] as string | boolean | null | undefined) ?? null]),
    );
  } else if (traeEnlaces) {
    enlaces = {
      ...Object.fromEntries(CAMPOS_TEXTO_ENLACES_NEGOCIO.map((campo) => [campo, null])),
      facebook_messenger: false,
    };
  }

  // MP#07 Fase 2: profile update + product pause are atomic via RPC
  // `update_profile_and_pause_products`. The Postgres function runs in a
  // single transaction, so the divergent state (profile flipped but products
  // still `disponible`) is no longer reachable. The RPC also enforces
  // `auth.uid() = p_user_id` server-side via SECURITY DEFINER, so passing a
  // wrong id returns 42501.
  const { error } = await supabase.rpc("update_profile_and_pause_products", {
    p_user_id: user.id,
    p_nombre: parsed.data.nombre,
    // `?? undefined` y no `?? null`: JSON.stringify descarta las claves
    // undefined, asi que PostgREST omite el parametro y Postgres aplica su
    // DEFAULT NULL (migracion 20260826390000). Misma columna, mismo valor,
    // sin el cast que haria falta para mandar null — el codegen de Supabase
    // no sabe declarar un argumento nulable.
    p_bio: parsed.data.bio ?? undefined,
    p_foto: parsed.data.foto ?? undefined,
    p_ubicacion: parsed.data.ubicacion ?? undefined,
    p_es_vendedor: parsed.data.es_vendedor,
    p_seller_type: parsed.data.seller_type ?? undefined,
    p_nombre_negocio: parsed.data.nombre_negocio ?? undefined,
    p_descripcion_negocio: parsed.data.descripcion_negocio ?? undefined,
    p_metodos_pago_aceptados: parsed.data.metodos_pago_aceptados ?? undefined,
  });

  if (error) return { error: error.message };

  // Segundo RPC y no un parametro mas del primero: ampliar la firma de
  // update_profile_and_pause_products crearia una SOBRECARGA (PostgREST 300,
  // ver feedback de migraciones que cambian la aridad), y los enlaces tienen
  // sus propias reglas y sus propios mensajes. Si este falla, el perfil ya
  // quedo guardado y se dice asi, igual que hace el formulario con el @.
  if (enlaces) {
    // guardar_enlaces_negocio (20261108230000): null quita ese enlace y una
    // clave que no viene no se toca.
    const { error: errorEnlaces } = await supabase.rpc("guardar_enlaces_negocio", { p_enlaces: enlaces });
    if (errorEnlaces) {
      // El perfil SI quedo guardado: se revalida igual, o la interfaz seguiria
      // ensenando el perfil viejo mientras el mensaje dice que se guardo.
      await revalidatePath("/", "layout");
      // 22023 (formato) y el 42501 de "activa el modo vendedor" traen su
      // mensaje redactado desde la base y son del usuario, no fallos: no
      // ensucian Sentry. Un 42501 de otra cosa (permiso de verdad) si es fallo.
      const delUsuario =
        errorEnlaces.code === "22023" ||
        (errorEnlaces.code === "42501" && errorEnlaces.message.startsWith("Activa el modo vendedor"));
      if (!delUsuario) {
        Sentry.captureException(errorEnlaces, {
          tags: { action: "updateProfile", step: "enlaces_negocio" },
          contexts: { supabase: { code: errorEnlaces.code } },
        });
      }
      const detalle = delUsuario ? errorEnlaces.message : "No se pudieron guardar. Intenta de nuevo.";
      return { error: `Tu perfil se guardó, pero los enlaces de tu negocio no. ${detalle}` };
    }
  }

  await revalidatePath("/", "layout");
  return { success: true };
}

/**
 * Cambia el @ publico del usuario.
 *
 * Va por su propio RPC y no por update_profile_and_pause_products porque sus
 * fallos son distintos y la interfaz tiene que poder distinguirlos: "ya esta
 * en uso" y "esta reservado" piden que el usuario escriba otra cosa, no que
 * reintente. Los mensajes vienen ya redactados desde la base, asi que se
 * pasan tal cual en vez de traducir codigos aqui y alla.
 */
export async function setUsername(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "No autenticado" };

  const rate = await enforce(writeRateLimit, `write:${user.id}`);
  if (!rate.ok) return { error: rate.error };

  const parsed = usernameSchema.safeParse(formData.get("username") ?? "");
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Nombre de usuario invalido" };
  }

  const { data, error } = await supabase.rpc("set_username", {
    p_username: parsed.data,
  });

  if (error) {
    // 22023 (formato o reservado) y 23505 (en uso) son del usuario, no fallos:
    // no ensucian Sentry. Cualquier otro codigo si es un fallo de verdad.
    if (error.code !== "22023" && error.code !== "23505") {
      Sentry.captureException(error, { tags: { action: "setUsername" } });
    }
    return { error: error.message };
  }

  await revalidatePath("/perfil");
  await revalidatePath(`/vendedor/${user.id}`);
  return { success: true, username: data as string };
}

export async function updateProductsOrder(updates: { id: string; sort_order: number }[]) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "No autenticado" };

  const rate = await enforce(writeRateLimit, `write:${user.id}`);
  if (!rate.ok) return { error: rate.error };

  // Ejecutamos las actualizaciones en paralelo asegurándonos de que 
  // solo el creador pueda modificar sus productos.
  const results = await Promise.all(
    updates.map((update) =>
      supabase
        .from("products_services")
        .update({ sort_order: update.sort_order })
        .eq("id", update.id)
        .eq("creador_id", user.id)
    )
  );

  const error = results.find((r) => r.error)?.error;
  if (error) {
    // El `details` de Postgres es donde el motor nombra la columna o la policy
    // que rechazo; se va a Sentry ANTES del return, que es donde sirve. Al
    // usuario le llega una frase, no un mensaje de PostgREST en ingles.
    Sentry.captureException(error, {
      tags: { action: "updateProductsOrder" },
      contexts: {
        order: { items: updates.length },
        supabase: { code: error.code },
      },
    });
    return { error: "No se pudo guardar el nuevo orden. Intenta de nuevo." };
  }

  await revalidatePath("/perfil");
  await revalidatePath(`/vendedor/${user.id}`);
  return { success: true };
}

export async function completeOnboarding() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "No autenticado" };

  // Misma cubeta `write:` que el resto de escrituras, NO un identificador
  // propio: en Upstash la clave es prefijo + identificador, asi que inventar
  // uno nuevo aqui no compartiria cuota, abriria una paralela y subiria el
  // techo real por usuario sin que nadie lo decidiera. Es el fallo que ya
  // tiene `follow:`.
  const rate = await enforce(writeRateLimit, `write:${user.id}`);
  if (!rate.ok) return { error: rate.error };

  const { error } = await supabase.rpc("complete_user_onboarding");

  if (error) {
    console.error("[completeOnboarding] RPC error:", error.code, error.message);
    // P0002: no profiles row for the caller (raised by the anti-loop RPC).
    // Keep the technical detail in the server log, not in the toast.
    if (error.code === "P0002") {
      return {
        error:
          "Tu perfil aún no está listo. Espera unos segundos e intenta de nuevo; si persiste, contáctanos.",
      };
    }
    return { error: error.message };
  }

  await revalidatePath("/");
  const store = await cookies();
  const destino = destinoAutenticadoSeguro(store.get(COOKIE_DESTINO_ONBOARDING)?.value);
  store.delete(COOKIE_DESTINO_ONBOARDING);
  return { success: true, destino };
}
