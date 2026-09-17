import "server-only";
import { cookies } from "next/headers";
import { revalidatePath as nextRevalidatePath } from "next/cache";
/**
 * Revalidacion con marca de revision.
 *
 * Se llama SOLO despues de una mutacion que el servidor confirmo. Ademas de
 * purgar la cache del router, cambia la cookie que el layout del marketplace
 * lee en cada render: el proveedor de la memoria de sesion compara la revision
 * con la que ya tenia y, si cambio, vacia lo guardado. Asi una escritura hecha
 * por una Server Action tambien alcanza a las pestañas que conservan datos en
 * memoria, no solo al arbol que el router vuelve a pedir.
 *
 * `secure` en produccion: la cookie no lleva nada privado (un uuid), pero una
 * cookie de sesion que viaje en claro es un habito, no una excepcion. En
 * desarrollo se omite porque localhost no es https.
 */
export async function revalidatePath(path: string, type?: "page" | "layout") {
  (await cookies()).set("vicino_data_revision", crypto.randomUUID(), {
    path: "/",
    sameSite: "lax",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
  });
  nextRevalidatePath(path, type);
}
