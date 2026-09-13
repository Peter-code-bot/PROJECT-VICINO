import { redirect } from "next/navigation";
import * as Sentry from "@sentry/nextjs";
import { createClient } from "@/lib/supabase/server";
import { AdminPanel } from "@/components/comunidades/admin/admin-panel";
import { ComunidadNoDisponible } from "@/components/comunidades/no-disponible";
import { esMando } from "@/lib/comunidades/tipos";
import { traducirErrorComunidad } from "@/lib/comunidades/errores";

interface Props {
  params: Promise<{ id: string }>;
}

export const dynamic = "force-dynamic";
export const metadata = { title: "Administrar comunidad — VICINO" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAGINA_SOLICITUDES = 30;

export default async function AdministrarPage({ params }: Props) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/comunidades/${id}/administrar`)}`);
  if (!UUID_RE.test(id)) return <ComunidadNoDisponible />;

  const { data: detalleData, error: detalleError } = await supabase.rpc("detalle_comunidad", {
    p_community_id: id,
  });
  if (detalleError) {
    Sentry.captureException(detalleError, { tags: { action: "detalle_comunidad@administrar" } });
    return <ComunidadNoDisponible titulo={traducirErrorComunidad(detalleError)} />;
  }
  const detalle = detalleData?.[0];
  if (!detalle) return <ComunidadNoDisponible />;
  // Sin mando aqui no hay nada que ver: de vuelta a la comunidad.
  if (!esMando(detalle.mi_rol) || !detalle.disponible) redirect(`/comunidades/${id}`);

  const esOwner = detalle.mi_rol === "owner";

  // Cuatro lecturas independientes. Las del owner se piden solo si lo es:
  // centro_de_mi_comunidad devuelve cero filas a un moderador y el padron
  // no le hace falta. allSettled: que falle una no tira la pagina.
  const [centroR, solicitudesR, miembrosR, topeR] = await Promise.allSettled([
    esOwner ? supabase.rpc("centro_de_mi_comunidad", { p_community_id: id }) : Promise.resolve(null),
    detalle.es_privada
      ? supabase.rpc("solicitudes_de_comunidad", { p_community_id: id, result_limit: PAGINA_SOLICITUDES })
      : Promise.resolve(null),
    esOwner
      ? supabase
          .from("community_members")
          .select("user_id, role, joined_at, profiles!community_members_user_id_fkey(nombre, foto)")
          .eq("community_id", id)
          .is("left_at", null)
          .order("joined_at", { ascending: true })
          .limit(200)
      : Promise.resolve(null),
    esOwner ? supabase.rpc("comunidades_limite", { p_clave: "moderadores_por_comunidad" }) : Promise.resolve(null),
  ]);

  const valor = <T,>(r: PromiseSettledResult<T>): T | null => (r.status === "fulfilled" ? r.value : null);
  const centroData = valor(centroR);
  const solicitudesData = valor(solicitudesR);
  const miembrosData = valor(miembrosR);
  const topeData = valor(topeR);

  for (const [nombre, r] of [
    ["centro_de_mi_comunidad", centroData],
    ["solicitudes_de_comunidad", solicitudesData],
    ["community_members@administrar", miembrosData],
    ["comunidades_limite", topeData],
  ] as const) {
    if (r?.error) Sentry.captureException(r.error, { tags: { action: nombre } });
  }

  const solicitudes = solicitudesData?.data ?? [];
  const ultimaSolicitud = solicitudes[solicitudes.length - 1];
  const miembros = (miembrosData?.data ?? []).flatMap((m) => {
    const perfil = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles;
    if (!perfil) return [];
    return [{ user_id: m.user_id, role: m.role, joined_at: m.joined_at, nombre: perfil.nombre, foto: perfil.foto ?? null }];
  });

  return (
    <AdminPanel
      detalle={detalle}
      centro={centroData?.data?.[0] ?? null}
      solicitudes={{
        items: solicitudes,
        cursor:
          solicitudes.length === PAGINA_SOLICITUDES && ultimaSolicitud
            ? { time: ultimaSolicitud.created_at, id: ultimaSolicitud.id }
            : null,
        error: solicitudesData?.error ? traducirErrorComunidad(solicitudesData.error) : undefined,
      }}
      miembros={{
        items: miembros,
        error: miembrosData?.error ? traducirErrorComunidad(miembrosData.error) : undefined,
      }}
      // Si la RPC de limites falla no se inventa un numero: sin tope conocido
      // el panel no deshabilita nada y la base responde 23514 al sexto.
      topeModeradores={typeof topeData?.data === "number" ? topeData.data : Number.POSITIVE_INFINITY}
    />
  );
}
