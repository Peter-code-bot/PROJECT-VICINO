import { redirect } from "next/navigation";
import * as Sentry from "@sentry/nextjs";
import { createClient } from "@/lib/supabase/server";
import { HiloPublicacion } from "@/components/comunidades/hilo-publicacion";
import { ComunidadNoDisponible } from "@/components/comunidades/no-disponible";
import { esMando } from "@/lib/comunidades/tipos";

interface Props {
  params: Promise<{ id: string; postId: string }>;
}

export const dynamic = "force-dynamic";
export const metadata = { title: "Publicación — Comunidades VICINO" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAGINA = 30;
/**
 * No hay RPC "una publicacion por id". feed_muro_comunidad pagina con
 * (created_at, id) < (cursor_time, cursor_id): pasando el created_at de la
 * publicacion y el uuid mas alto posible, la primera fila DESC es la propia
 * publicacion, con le_di_like y los conteos ya calculados y con las mismas
 * reglas de visibilidad (privada, oculta, bloqueo) que el muro. Un empate
 * exacto de microsegundo con otra publicacion es tan improbable que basta
 * con comprobar el id y caer al estado "no disponible" si no coincide.
 */
const UUID_MAXIMO = "ffffffff-ffff-ffff-ffff-ffffffffffff";

export default async function PublicacionPage({ params }: Props) {
  const { id, postId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/comunidades/${id}/publicacion/${postId}`)}`);

  if (!UUID_RE.test(id) || !UUID_RE.test(postId)) {
    return <ComunidadNoDisponible titulo="Esta publicación no está disponible" />;
  }

  // La fila cruda (RLS: miembro, o publica) solo para el created_at; el
  // resto lo pone la RPC, que es quien sabe de likes y de visibilidad.
  const [filaR, detalleR, perfilR] = await Promise.all([
    supabase
      .from("community_posts")
      .select("id, created_at, community_id, parent_post_id")
      .eq("id", postId)
      .eq("community_id", id)
      .maybeSingle(),
    supabase.rpc("detalle_comunidad", { p_community_id: id }),
    supabase.from("profiles").select("nombre, foto").eq("id", user.id).maybeSingle(),
  ]);

  if (filaR.error) Sentry.captureException(filaR.error, { tags: { action: "community_posts@hilo" } });
  const fila = filaR.data;
  const detalle = detalleR.data?.[0];
  // Un comentario no tiene hilo propio: se manda a la madre.
  if (fila?.parent_post_id) redirect(`/comunidades/${id}/publicacion/${fila.parent_post_id}`);
  if (!fila || !detalle) return <ComunidadNoDisponible titulo="Esta publicación no está disponible" />;

  const [postR, comentariosR] = await Promise.all([
    supabase.rpc("feed_muro_comunidad", {
      p_community_id: id,
      cursor_time: fila.created_at,
      cursor_id: UUID_MAXIMO,
      result_limit: 1,
    }),
    supabase.rpc("comentarios_de_publicacion", { p_post_id: postId, result_limit: PAGINA }),
  ]);

  if (postR.error) Sentry.captureException(postR.error, { tags: { action: "feed_muro_comunidad@hilo" } });
  if (comentariosR.error) Sentry.captureException(comentariosR.error, { tags: { action: "comentarios_de_publicacion" } });

  const post = postR.data?.[0];
  if (!post || post.id !== postId) return <ComunidadNoDisponible titulo="Esta publicación no está disponible" />;

  const comentarios = comentariosR.data ?? [];
  const ultimo = comentarios[comentarios.length - 1];

  return (
    <HiloPublicacion
      post={post}
      comentarios={comentarios}
      cursor={comentarios.length === PAGINA && ultimo ? { time: ultimo.created_at, id: ultimo.id } : null}
      currentUser={{ id: user.id, nombre: perfilR.data?.nombre ?? "Tu", foto: perfilR.data?.foto ?? null }}
      puedoComentar={detalle.soy_miembro && detalle.disponible}
      puedoModerar={esMando(detalle.mi_rol)}
    />
  );
}
