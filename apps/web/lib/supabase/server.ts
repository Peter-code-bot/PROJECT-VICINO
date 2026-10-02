import type { Database } from "@/types/database.types";
import { createServerClient } from "@supabase/ssr";
import { fetchConLimite } from "./fetch-con-limite";
import { cookies } from "next/headers";

export async function createClient(options?: { registro: boolean }) {
  const cookieStore = await cookies();
  const boundedFetch = fetchConLimite(fetch, process.env.NEXT_PUBLIC_SUPABASE_URL!);
  const requestFetch: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (options?.registro && url.origin === new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).origin && url.pathname === "/auth/v1/signup") {
      const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
      return boundedFetch(input, { ...init, signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20_000)]) : AbortSignal.timeout(20_000) });
    }
    return boundedFetch(input, init);
  };

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: { fetch: requestFetch },
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // The `setAll` method was called from a Server Component.
            // This can be ignored if you have middleware refreshing sessions.
          }
        },
      },
    }
  );
}
