import { redirect } from "next/navigation";
import * as Sentry from "@sentry/nextjs";
import { createClient } from "@/lib/supabase/server";
import { DetalleCabecera } from "@/components/comunidades/detalle-cabecera";
import { MuroComunidad } from "@/components/comunidades/muro-comunidad";
import { MuroDifuminado } from "@/components/comunidades/muro-difuminado";
import { ComunidadNoDisponible } from "@/components/comunidades/no-disponible";
import { esMando, cursorDeUltimo } from "@/lib/comunidades/tipos";
import { traducirErrorComunidad, esErrorDePermiso } from "@/lib/comunidades/errores";
import { Archive } from "lucide-react";

interface Props {
  params: Promise<{ id: string }>;
}

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAGINA = 30;

export async function generateMetadata({ params }: Props) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return { title: "Comunidad — VICINO" };
  const supabase = await createClient();
  const { data } = await supabase.rpc("detalle_comunidad", { p_community_id: id });
  const nombre = data?.[0]?.nombre;
  return { title: nombre ? `${nombre} — Comunidades VICINO` : "Comunidad — VICINO" };
}

export default async function ComunidadPage({ params }: Props) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/comunidades/${id}`)}`);

  // Un id que no es uuid no toca la base: mismo estado que "no existe".
  if (!UUID_RE.test(id)) return <ComunidadNoDisponible />;

  const [detalleR, perfilR] = await Promise.all([
    supabase.rpc("detalle_comunidad", { p_community_id: id }),
    supabase.from("profiles").select("nombre, foto").eq("id", user.id).maybeSingle(),
  ]);

  if (detalleR.error) {
    Sentry.captureException(detalleR.error, { tags: { action: "detalle_comunidad" } });
    return <ComunidadNoDisponible titulo={traducirErrorComunidad(detalleR.error)} />;
  }
  const detalle = detalleR.data?.[0];
  if (!detalle) return <ComunidadNoDisponible />;

  const currentUser = {
    id: user.id,
    nombre: perfilR.data?.nombre ?? "Tu",
    foto: perfilR.data?.foto ?? null,
  };

  // El muro se pide solo cuando hay derecho a verlo: miembro, o publica. Si
  // aun asi la RPC dice 42501 (la comunidad se cerro entre una lectura y
  // otra), se pinta la silueta igual que si fuera privada de entrada.
  const puedeVerMuro = detalle.soy_miembro || !detalle.es_privada;
  let posts: Awaited<ReturnType<typeof cargarMuroInicial>> = { items: [], errorPermiso: false, error: null };
  if (puedeVerMuro) posts = await cargarMuroInicial(supabase, id);

  const muroBloqueado = (!puedeVerMuro || posts.errorPermiso) && !detalle.soy_miembro;

  return (
    <div className="mx-auto w-full max-w-lg pb-28">
      <DetalleCabecera detalle={detalle} />

      {!detalle.disponible && detalle.soy_miembro && (
        <div className="mx-4 mb-3 flex items-start gap-2 rounded-2xl bg-[color:var(--card-2)] p-3 text-xs text-[color:var(--fg-muted)] shadow-[inset_0_0_0_1px_var(--border)]">
          <Archive className="mt-0.5 h-4 w-4 shrink-0" />
          Esta comunidad está archivada. Puedes leer lo que quedó y salir cuando quieras; ya no se publica.
        </div>
      )}

      <section className="px-4" aria-label="Muro">
        {muroBloqueado ? (
          <MuroDifuminado />
        ) : posts.error ? (
          <p className="py-10 text-center text-sm text-[color:var(--fg-muted)]">{posts.error}</p>
        ) : (
          <MuroComunidad
            communityId={detalle.id}
            communityNombre={detalle.nombre}
            esPrivada={detalle.es_privada}
            initialPosts={posts.items}
            initialCursor={cursorDeUltimo(posts.items, PAGINA)}
            currentUser={currentUser}
            puedoPublicar={detalle.soy_miembro && detalle.disponible}
            puedoModerar={esMando(detalle.mi_rol)}
          />
        )}
      </section>
    </div>
  );
}

async function cargarMuroInicial(supabase: Awaited<ReturnType<typeof createClient>>, id: string) {
  const { data, error } = await supabase.rpc("feed_muro_comunidad", {
    p_community_id: id,
    result_limit: PAGINA,
  });
  if (error) {
    if (esErrorDePermiso(error)) return { items: [], errorPermiso: true, error: null };
    Sentry.captureException(error, { tags: { action: "feed_muro_comunidad" } });
    return { items: [], errorPermiso: false, error: traducirErrorComunidad(error) };
  }
  return { items: data ?? [], errorPermiso: false, error: null };
}
