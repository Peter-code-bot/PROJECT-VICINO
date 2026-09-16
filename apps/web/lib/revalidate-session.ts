import "server-only";
import { cookies } from "next/headers";
import { revalidatePath as nextRevalidatePath } from "next/cache";
/** Called only after a successful server mutation. The persistent layout observes this revision. */
export async function revalidatePath(path: string, type?: "page" | "layout") {
  (await cookies()).set("vicino_data_revision", crypto.randomUUID(), { path: "/", sameSite: "lax", httpOnly: true });
  nextRevalidatePath(path, type);
}
