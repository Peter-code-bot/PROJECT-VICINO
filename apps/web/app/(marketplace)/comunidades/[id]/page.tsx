import { redirect } from "next/navigation";
import * as Sentry from "@sentry/nextjs";
import { createClient } from "@/lib/supabase/server";
import { DetalleCabecera } from "@/components/comunidades/detalle-cabecera";
// import type: el modulo del drawer es "use client" y de ahi solo puede
// cruzar la frontera un tipo, que se borra al compilar. Traer una funcion de
// ahi revienta en runtime con el build en verde.
import type { SolicitudesIniciales } from "@/components/comunidades/comunidad-miembros-drawer";
import { MuroComunidad } from "@/components/comunidades/muro-comunidad";
import { MuroDifuminado } from "@/components/comunidades/muro-difuminado";
import { ComunidadNoDisponible } from "@/components/comunidades/no-disponible";
import { esMando, cursorDeUltimo } from "@/lib/comunidades/tipos";
import { traducirErrorComunidad, esErrorDePermiso, esErrorNoDisponible } from "@/lib/comunidades/errores";
import { Archive } from "lucide-react";

interface Props {
  params: Promise<{ id: string }>;
}

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAGINA = 30;
const PAGINA_SOLICITUDES = 30;

/** Muro sin pedir: la forma exacta que devuelve cargarMuroInicial, sin cast. */
const MURO_VACIO: Awaited<ReturnType<typeof cargarMuroInicial>> = { items: [], errorPermiso: false, error: null };

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
    nombre: perfilR.data?.nombre ?? "Tú",
    foto: perfilR.data?.foto ?? null,
  };

  // El muro se pide solo cuando hay derecho a verlo: la comunidad esta viva
  // Y (soy miembro, o es publica). Una archivada u oculta NO se lee, ni
  // siquiera por sus miembros: feed_muro_comunidad, puedo_ver_publicacion y
  // comentarios_de_publicacion exigen archived_at IS NULL e is_hidden = false
  // desde 20260912200000 ("dejan de leerse"). Pedirlo igual daba P0002 y una
  // excepcion en Sentry por cada visita. Si aun asi la RPC dice 42501 (la
  // comunidad se cerro entre una lectura y otra), se pinta la silueta igual
  // que si fuera privada de entrada.
  const puedeVerMuro = detalle.disponible && (detalle.soy_miembro || !detalle.es_privada);
  // La cola se lee aqui para que el drawer de la cabecera abra con las
  // solicitudes puestas. Solo si hay mando: solicitudes_de_comunidad responde
  // 42501 a quien no manda. Y solo si es privada, igual que la pantalla de
  // administrar: en una publica se entra sin solicitar.
  const pedirSolicitudes = esMando(detalle.mi_rol) && detalle.es_privada && detalle.disponible;
  const [posts, solicitudes] = await Promise.all([
    puedeVerMuro ? cargarMuroInicial(supabase, id) : Promise.resolve(MURO_VACIO),
    pedirSolicitudes ? cargarSolicitudesIniciales(supabase, id) : Promise.resolve(null),
  ]);

  const muroBloqueado = (!puedeVerMuro || posts.errorPermiso) && !detalle.soy_miembro;

  return (
    <div className="mx-auto w-full max-w-lg pb-28">
      <DetalleCabecera detalle={detalle} solicitudes={solicitudes} />

      {!detalle.disponible && detalle.soy_miembro && (
        <div className="mx-4 mb-3 flex items-start gap-2 rounded-2xl bg-[color:var(--card-2)] p-3 text-xs text-[color:var(--fg-muted)] shadow-[inset_0_0_0_1px_var(--border)]">
          <Archive className="mt-0.5 h-4 w-4 shrink-0" />
          {detalle.archivada
            ? "Esta comunidad fue archivada. Ya no se puede leer ni publicar en ella; puedes salir cuando quieras."
            : "Esta comunidad no está disponible por ahora. Ya no se puede leer ni publicar en ella; puedes salir cuando quieras."}
        </div>
      )}

      <section className="px-4" aria-label="Muro">
        {!detalle.disponible ? null : muroBloqueado ? (
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
            // Reaccionar exige pertenencia (alternar_like_publicacion, 42501):
            // un no miembro de una publica ve el muro pero no enciende corazones.
            puedoReaccionar={detalle.soy_miembro && detalle.disponible}
            puedoModerar={esMando(detalle.mi_rol)}
          />
        )}
      </section>
    </div>
  );
}

async function cargarSolicitudesIniciales(
  supabase: Awaited<ReturnType<typeof createClient>>,
  id: string,
): Promise<SolicitudesIniciales> {
  const { data, error } = await supabase.rpc("solicitudes_de_comunidad", {
    p_community_id: id,
    result_limit: PAGINA_SOLICITUDES,
  });
  if (error) {
    // 42501 es un estado esperado: el mando se puede haber perdido entre
    // detalle_comunidad y esta lectura. El drawer pinta el motivo y la pagina
    // sigue en pie; a Sentry solo va lo que no se espera.
    if (!esErrorDePermiso(error)) {
      Sentry.captureException(error, { tags: { action: "solicitudes_de_comunidad@detalle" } });
    }
    return { items: [], cursor: null, error: traducirErrorComunidad(error) };
  }
  const items = data ?? [];
  const ultima = items[items.length - 1];
  return {
    items,
    // Solo si la pagina vino llena: un cursor con la pagina a medias haria
    // que el boton de cargar mas repitiera lo que ya esta en pantalla.
    cursor:
      items.length === PAGINA_SOLICITUDES && ultima ? { time: ultima.created_at, id: ultima.id } : null,
  };
}

async function cargarMuroInicial(supabase: Awaited<ReturnType<typeof createClient>>, id: string) {
  const { data, error } = await supabase.rpc("feed_muro_comunidad", {
    p_community_id: id,
    result_limit: PAGINA,
  });
  if (error) {
    if (esErrorDePermiso(error)) return { items: [], errorPermiso: true, error: null };
    // P0002: la comunidad se archivo u oculto entre detalle_comunidad y esta
    // llamada. Es un estado esperado, no un incidente para Sentry.
    if (esErrorNoDisponible(error)) return { items: [], errorPermiso: false, error: traducirErrorComunidad(error) };
    Sentry.captureException(error, { tags: { action: "feed_muro_comunidad" } });
    return { items: [], errorPermiso: false, error: traducirErrorComunidad(error) };
  }
  return { items: data ?? [], errorPermiso: false, error: null };
}
