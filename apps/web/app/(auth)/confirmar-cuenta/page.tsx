import Link from "next/link";
import { redirect } from "next/navigation";
import { AVISO_PRIVACIDAD_VERSION, TERMINOS_VERSION } from "@vicino/shared";
import { createClient } from "@/lib/supabase/server";
import { legalStateSchema, rutaConfirmacionCuenta } from "@/lib/auth/confirmacion-legal";
import { destinoAutenticadoSeguro } from "@/lib/auth/destino-seguro";
import { signOut } from "../actions";
import { ConfirmacionCuenta } from "./confirmacion-cuenta";

export const metadata = { title: "Confirma tu cuenta — VICINO" };

async function cerrarSesion() {
  "use server";
  await signOut();
}

export default async function ConfirmarCuentaPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const params = await searchParams;
  const next = destinoAutenticadoSeguro(params.next);
  const destino = next.startsWith("/confirmar-cuenta") ? "/" : next;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(rutaConfirmacionCuenta(destino))}`);
  const { data, error } = await supabase.rpc("estado_confirmacion_legal");
  const state = legalStateSchema.safeParse(data);
  if (!error && state.success && state.data.confirmed) redirect(destino);
  const matches = state.success && state.data.documents.some(d => d.documento === "terminos" && d.version === TERMINOS_VERSION)
    && state.data.documents.some(d => d.documento === "aviso" && d.version === AVISO_PRIVACIDAD_VERSION);
  return <main className="min-h-dvh bg-background px-5 pb-10 pt-[calc(env(safe-area-inset-top)+2rem)] text-foreground">
    <div className="mx-auto w-full max-w-md space-y-6">
      <h1 className="font-heading text-3xl font-bold">Antes de empezar</h1>
      <p className="text-fg-muted">Revisa los documentos de tu cuenta. Esta confirmación también se aplica cuando compras o exploras.</p>
      {error || !matches ? <div role="alert" className="space-y-4">
        <p>No pudimos comprobar los documentos actuales. Tu sesión está guardada.</p>
        <Link href={rutaConfirmacionCuenta(destino)} prefetch={false} className="inline-flex min-h-12 items-center rounded-xl bg-brand px-5 font-semibold text-primary-foreground">Reintentar</Link>
        <p><Link href="/terminos" className="underline">Términos</Link> · <Link href="/privacidad" className="underline">Aviso de Privacidad</Link></p>
      </div> : <ConfirmacionCuenta userId={user.id} destino={destino} terminosVersion={TERMINOS_VERSION} avisoVersion={AVISO_PRIVACIDAD_VERSION} />}
      <form action={cerrarSesion}><button type="submit" className="min-h-12 text-sm text-fg-muted underline">Cerrar sesión</button></form>
      <Link href="/eliminar-cuenta" className="inline-block text-sm text-fg-muted underline">Eliminación de cuenta y privacidad</Link>
    </div>
  </main>;
}
