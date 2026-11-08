import { notFound, redirect } from "next/navigation";
import { cleanDisplayName } from "@vicino/shared";

import { createClient } from "@/lib/supabase/server";
import { BANDEJA_WHATSAPP_ACTIVA } from "@/lib/whatsapp/bandera";
import { numeroLegible } from "@/lib/whatsapp/presentacion";
import { HiloWhatsApp, type EstadoCanal, type MensajeHilo } from "../hilo-whatsapp";

export const metadata = { title: "Conversación de WhatsApp" };

interface Props {
  params: Promise<{ id: string }>;
}

const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Cuantos mensajes se cargan: los ULTIMOS, para que lo nuevo siempre aparezca. */
const MENSAJES_POR_HILO = 300;

export default async function ConversacionWhatsAppPage({ params }: Props) {
  if (!BANDEJA_WHATSAPP_ACTIVA) notFound();

  const { id } = await params;
  if (!RE_UUID.test(id)) notFound();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=/seller/bandeja/${id}`);

  // La RLS solo devuelve conversaciones del negocio con sesion: una ajena es un 404.
  const { data: conversacion } = await supabase
    .from("conversaciones_whatsapp")
    .select("id, canal_id, wa_id, nombre_perfil, ultimo_entrante_at")
    .eq("id", id)
    .maybeSingle();
  if (!conversacion) notFound();

  const [canalConsulta, mensajesConsulta] = await Promise.all([
    supabase.from("canales_whatsapp").select("estado").eq("id", conversacion.canal_id).maybeSingle(),
    // Los mas recientes primero (y created_at desempata cuando Meta manda el
    // mismo segundo); se invierten para pintarlos en orden. Pedir los primeros
    // 300 ascendentes dejaria fuera lo nuevo en una conversacion larga.
    supabase
      .from("mensajes_whatsapp")
      .select("id, direccion, tipo, texto, estado, error_codigo, marca_tiempo")
      .eq("conversacion_id", id)
      .order("marca_tiempo", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(MENSAJES_POR_HILO),
  ]);

  // Un fallo al leer el canal no es una pausa: se dice que no se pudo comprobar.
  const estadoCanal: EstadoCanal = canalConsulta.error || !canalConsulta.data
    ? "desconocido"
    : canalConsulta.data.estado === "activo"
      ? "activo"
      : "pausado";

  const mensajes = ([...(mensajesConsulta.data ?? [])] as MensajeHilo[]).reverse();
  const nombre = conversacion.nombre_perfil ? cleanDisplayName(conversacion.nombre_perfil) : numeroLegible(conversacion.wa_id);

  return (
    <HiloWhatsApp
      conversacionId={conversacion.id}
      nombre={nombre}
      numero={numeroLegible(conversacion.wa_id)}
      ultimoEntranteAt={conversacion.ultimo_entrante_at}
      estadoCanal={estadoCanal}
      mensajes={mensajes}
      errorCarga={Boolean(mensajesConsulta.error)}
      hayMasAntiguos={(mensajesConsulta.data?.length ?? 0) >= MENSAJES_POR_HILO}
    />
  );
}
