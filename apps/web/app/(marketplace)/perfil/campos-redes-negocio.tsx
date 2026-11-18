import { ChevronDown } from "lucide-react";
import { FieldRow } from "./field-row";

/**
 * Campos de las redes sociales del negocio en Editar perfil (20261108230000).
 *
 * Van plegados en un <details> «Redes sociales» para no ensenar una docena de
 * campos vacios; se abren solos si ya hay alguna red. Un <details> cerrado
 * sigue enviando sus campos, asi que guardar con el bloque cerrado no borra
 * nada.
 *
 * Son campos de texto libre y no type="url" a proposito: la gente pega
 * "@mitienda" o "tiktok.com/@mitienda?_t=..." y el navegador los rechazaria
 * antes de que el servidor pudiera limpiarlos (redesNegocioSchema).
 *
 * `enlaces_formulario=2` le dice a la Server Action que este formulario trae
 * las redes y la casilla de Messenger: una casilla sin marcar no viaja en el
 * FormData, y sin la marca "apago Messenger" seria igual que "no lo conozco".
 */
export interface RedesNegocioDelPerfil {
  instagram_usuario?: string | null;
  facebook_ruta?: string | null;
  facebook_messenger?: boolean | null;
  tiktok_usuario?: string | null;
  youtube_ruta?: string | null;
  x_usuario?: string | null;
  linkedin_ruta?: string | null;
  threads_usuario?: string | null;
  pinterest_usuario?: string | null;
  telegram_usuario?: string | null;
}

const CLASE_INPUT =
  "w-full bg-transparent border-0 p-0 text-base text-foreground outline-none focus:outline-none focus:ring-0 placeholder:text-muted-foreground";

interface CampoRed {
  nombre: Exclude<keyof RedesNegocioDelPerfil, "facebook_messenger">;
  etiqueta: string;
  ayuda: string;
  ejemplo: string;
}

const CAMPOS: ReadonlyArray<CampoRed> = [
  { nombre: "instagram_usuario", etiqueta: "Instagram", ayuda: "Tu usuario, con o sin @", ejemplo: "mitienda.puebla" },
  {
    nombre: "facebook_ruta",
    etiqueta: "Facebook",
    ayuda: "Tu usuario o el enlace de tu página. Si tu página no tiene usuario, pega el enlace con su número (profile.php?id=…).",
    ejemplo: "mitienda.puebla",
  },
  {
    nombre: "tiktok_usuario",
    etiqueta: "TikTok",
    ayuda: "Tu usuario, con o sin @. Los enlaces cortos (vm.tiktok.com) no sirven.",
    ejemplo: "@mitienda",
  },
  { nombre: "youtube_ruta", etiqueta: "YouTube", ayuda: "El @ de tu canal o el enlace de tu canal", ejemplo: "@micanal" },
  { nombre: "x_usuario", etiqueta: "X", ayuda: "Tu usuario, con o sin @", ejemplo: "@mitienda" },
  {
    nombre: "linkedin_ruta",
    etiqueta: "LinkedIn",
    ayuda: "El enlace de tu página de empresa o de tu perfil",
    ejemplo: "linkedin.com/company/mi-tienda",
  },
  { nombre: "threads_usuario", etiqueta: "Threads", ayuda: "Tu usuario, con o sin @", ejemplo: "@mitienda.puebla" },
  { nombre: "pinterest_usuario", etiqueta: "Pinterest", ayuda: "Tu usuario o el enlace de tu perfil", ejemplo: "mitienda" },
  {
    nombre: "telegram_usuario",
    etiqueta: "Telegram",
    ayuda: "Tu usuario, con o sin @ (no el enlace de un grupo)",
    ejemplo: "@mitienda",
  },
];

export function CamposRedesNegocio({ perfil }: { perfil: RedesNegocioDelPerfil | null | undefined }) {
  const tieneRedes = CAMPOS.some(({ nombre }) => Boolean(perfil?.[nombre]));
  return (
    <>
      <input type="hidden" name="enlaces_formulario" value="2" />
      <details open={tieneRedes} className="group/redes border-t border-border/10">
        <summary className="flex cursor-pointer list-none items-center justify-between py-3 text-[13px] text-muted-foreground [&::-webkit-details-marker]:hidden">
          Redes sociales
          <ChevronDown className="w-4 h-4 transition-transform group-open/redes:rotate-180" aria-hidden="true" />
        </summary>
        {CAMPOS.map(({ nombre, etiqueta, ayuda, ejemplo }, i) => (
          <div key={nombre}>
            <FieldRow label={etiqueta} htmlFor={nombre} hint={ayuda} last={i === CAMPOS.length - 1}>
              <input
                id={nombre}
                name={nombre}
                type="text"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                maxLength={200}
                defaultValue={perfil?.[nombre] ?? ""}
                placeholder={ejemplo}
                className={CLASE_INPUT}
              />
            </FieldRow>
            {nombre === "facebook_ruta" ? (
              <label className="flex items-start gap-2 border-b border-border/10 py-3 text-[13px] text-foreground">
                <input
                  type="checkbox"
                  name="facebook_messenger"
                  defaultChecked={perfil?.facebook_messenger === true}
                  className="mt-0.5 h-4 w-4 accent-primary"
                />
                <span>
                  Recibir mensajes por Messenger
                  <span className="mt-1 block text-[11px] text-muted-foreground">
                    Agrega un botón que abre un chat con tu página. Necesita tu usuario de Facebook, no el número.
                  </span>
                </span>
              </label>
            ) : null}
          </div>
        ))}
      </details>
    </>
  );
}
