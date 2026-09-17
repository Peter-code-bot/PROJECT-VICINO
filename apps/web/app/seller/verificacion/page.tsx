import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { VerificationUpload } from "./verification-upload";

export const metadata = { title: "Verificación" };

/**
 * El techo de duracion, declarado y no heredado del plan.
 *
 * La revision automatica manda TRES imagenes en una sola llamada al modelo y
 * su propio tope interno es de 28 segundos. Si el techo de la plataforma
 * quedara por debajo, el resultado seria el peor de los dos mundos: la cuota ya
 * consumida y la fila sin veredicto ni motivo, o sea un fallo que no deja ni
 * rastro de por que no hubo respuesta. Con 60 hay margen para la llamada y para
 * la escritura posterior.
 *
 * Aplica a esta ruta y a las Server Actions que se invocan desde ella, que es
 * donde vive verifyDocument.
 */
export const maxDuration = 60;

export default async function VerificacionPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Solo las columnas que el formulario lee de verdad. El `select("*")` que
  // habia aqui mandaba al cliente reviewer_notes y phone_number, que no pinta
  // nadie, y arrastraba cuatro banderas (selfie_verified, id_verified,
  // phone_verified, current_level) que el hijo declara y no usa.
  const { data: verification } = await supabase
    .from("trust_level_verification")
    .select("selfie_url, id_front_url, id_back_url")
    .eq("user_id", user.id)
    .maybeSingle();

  // El `id` no es decoracion: `user_id` NO es unico en seller_verification —el
  // historial multi-fila es el diseno y aqui se lee la fila mas reciente—, asi
  // que el formulario necesita saber A CUAL escribe. Sin el, su UPDATE iba con
  // `.eq("user_id")` y tocaba TODAS las filas del vendedor: una solicitud de
  // agosto ya rechazada resucitaba en la cola del panel arrastrando su
  // reviewer_note y su reviewed_at viejos, que el admin ni puede limpiar porque
  // esas dos columnas no estan en su GRANT.
  //
  // El SELECT de esta tabla es a nivel de tabla (20260826301000 solo revoca por
  // columna INSERT y UPDATE), asi que pedir `id` no necesita ningun grant nuevo.
  const { data: sellerVerification } = await supabase
    .from("seller_verification")
    .select(
      "id, status, ine_front_url, ine_back_url, selfie_url, document_type, university_name",
    )
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // Consentimiento expreso para datos biometricos (LFPDPPP art. 8). Si ya
  // consintio en una sesion anterior no se le vuelve a pedir: el consentimiento
  // no caduca por cerrar la pestana.
  const { data: yaConsintio } = await supabase.rpc(
    "tiene_consentimiento_biometrico",
    { p_user_id: user.id },
  );

  return (
    <div className="space-y-4 -mt-2 sm:-mt-3 min-w-0">
      <div className="min-w-0">
        <h1 className="text-xl font-bold truncate">Verificación</h1>
      </div>
      <p className="text-sm text-muted-foreground">
        Sube tus documentos para verificar tu identidad y subir de nivel de
        confianza. Los documentos serán revisados por un administrador.
      </p>

      <VerificationUpload
        userId={user.id}
        verification={verification}
        sellerVerification={
          sellerVerification && {
            ...sellerVerification,
            // La columna status admite NULL, y el hijo expresa "todavia no hay
            // dato" como ausente (luego lo traduce a "none"). Se traduce aqui
            // para que las dos representaciones digan lo mismo.
            status: sellerVerification.status ?? undefined,
          }
        }
        // Si la RPC no devolvio nada —error, o ninguna fila de consentimiento—
        // se asume que NO consintio y se le vuelve a preguntar. Dar por bueno
        // un consentimiento que no consta es justo lo que el art. 8 LFPDPPP
        // no permite.
        yaConsintio={yaConsintio ?? false}
      />
    </div>
  );
}
