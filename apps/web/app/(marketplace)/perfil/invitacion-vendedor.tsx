import Link from "next/link";
import { Store } from "lucide-react";

/**
 * La puerta al alta de vendedor desde el propio perfil.
 *
 * Antes solo había tres puertas —bienvenida, el layout de vendedor y el
 * middleware— y las tres se cruzaban por accidente: al registrarse, o al
 * intentar entrar a una zona de vendedor y ser rebotado. Quien simplemente
 * decidía un día que quería vender no tenía dónde pulsar.
 *
 * El texto del botón cambia según el estado, que es lo que hace Instagram: su
 * entrada no dice siempre lo mismo, dice en qué punto estás. Un botón que
 * promete «empieza» a quien ya empezó es un botón que miente.
 */
export function InvitacionVendedor({
  esVendedor,
  altaPaso,
}: {
  esVendedor: boolean;
  /** Paso pendiente del alta. null = sin alta a medias. */
  altaPaso: string | null;
}) {
  // Quien ya es vendedor Y terminó no necesita esta invitación: tiene sus
  // herramientas en el menú.
  if (esVendedor && !altaPaso) return null;

  const aMedias = esVendedor && altaPaso;

  return (
    <Link
      href={aMedias ? "/vender" : "/empezar-a-vender"}
      className="flex items-center gap-3 rounded-2xl bg-card p-4 shadow-[inset_0_0_0_1px_var(--border)] transition-colors hover:bg-[color:var(--bg-elev-2)]"
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[color:var(--brand)]/10">
        <Store className="h-5 w-5 text-[color:var(--brand)]" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-heading font-semibold">
          {aMedias ? "Termina tu alta de vendedor" : "Empieza a vender"}
        </span>
        <span className="block text-sm text-muted-foreground">
          {aMedias
            ? "Ya eres vendedor. Publica algo para que la gente te encuentre."
            : "¿Vendes algo? Actívalo en un minuto."}
        </span>
      </span>
    </Link>
  );
}
