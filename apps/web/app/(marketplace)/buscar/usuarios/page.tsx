import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { ChevronLeft, ChevronRight, User, Star, ShieldCheck } from "lucide-react";

const PAGE_SIZE = 20;

interface Props {
  searchParams: Promise<{
    q?: string;
    page?: string;
  }>;
}

export const metadata = {
  title: "Buscar Usuarios",
};

export default async function UserSearchPage({ searchParams }: Props) {
  const params = await searchParams;
  const supabase = await createClient();
  const currentPage = Math.max(1, Number(params.page) || 1);
  const offset = (currentPage - 1) * PAGE_SIZE;

  let query = supabase
    .from("profiles")
    .select("id, nombre, avatar_url, trust_level, average_rating, reviews_count", { count: "exact" });

  if (params.q) {
    query = query.ilike("nombre", `%${params.q}%`);
  }

  const { data: users, count: totalCount } = await query
    .order("average_rating", { ascending: false })
    .range(offset, offset + PAGE_SIZE - 1);

  const totalPages = Math.ceil((totalCount ?? 0) / PAGE_SIZE);

  function pageUrl(page: number) {
    const p = new URLSearchParams();
    if (params.q) p.set("q", params.q);
    if (page > 1) p.set("page", String(page));
    return `/buscar/usuarios?${p.toString()}`;
  }

  return (
    <div className="w-full max-w-3xl mx-auto px-4 py-6 space-y-6">
      <div className="flex items-center gap-3">
        <Link
          href={`/buscar?q=${params.q || ""}`}
          className="p-2 rounded-full hover:bg-[color:var(--card-2)] transition-colors text-[color:var(--fg-muted)] hover:text-[color:var(--fg)]"
        >
          <ChevronLeft className="w-5 h-5" />
        </Link>
        <h1 className="text-xl font-bold text-[color:var(--fg)]">
          Búsqueda de Usuarios
        </h1>
      </div>

      <div className="flex items-center justify-between">
        <p className="text-sm text-[color:var(--fg-muted)]">
          <span className="font-semibold text-[color:var(--fg)]">
            {totalCount ?? 0}
          </span>{" "}
          resultado{totalCount !== 1 ? "s" : ""}
          {params.q && (
            <>
              {" "}para{" "}
              <span className="text-[color:var(--brand-hi)]">
                &ldquo;{params.q}&rdquo;
              </span>
            </>
          )}
        </p>
        {totalPages > 1 && (
          <p className="text-xs text-[color:var(--fg-dim)]">
            Página {currentPage} de {totalPages}
          </p>
        )}
      </div>

      {users && users.length > 0 ? (
        <div className="flex flex-col gap-3">
          {users.map((user) => (
            <Link
              key={user.id}
              href={`/tienda/${user.id}`}
              className="flex items-center gap-4 p-4 rounded-2xl bg-[color:var(--card-2)] hover:bg-[color:var(--card)] border border-[color:var(--border)] transition-all group"
            >
              <div className="w-14 h-14 rounded-full overflow-hidden bg-muted flex-shrink-0 flex items-center justify-center">
                {user.avatar_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={user.avatar_url}
                    alt={user.nombre ?? "Usuario"}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <User className="w-6 h-6 text-muted-foreground" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h2 className="font-semibold text-base text-[color:var(--fg)] group-hover:text-[color:var(--brand-hi)] transition-colors truncate">
                    {user.nombre}
                  </h2>
                  {user.trust_level === "verificado" && (
                    <ShieldCheck className="w-4 h-4 text-[color:var(--brand)] flex-shrink-0" />
                  )}
                </div>
                <div className="flex items-center gap-3 mt-1">
                  <div className="flex items-center gap-1 text-sm font-medium text-[color:var(--fg)]">
                    <Star className="w-3.5 h-3.5 fill-[color:var(--brand)] text-[color:var(--brand)]" />
                    <span>{Number(user.average_rating || 0).toFixed(1)}</span>
                    <span className="text-[color:var(--fg-muted)] font-normal">
                      ({user.reviews_count || 0})
                    </span>
                  </div>
                </div>
              </div>
              <ChevronRight className="w-5 h-5 text-[color:var(--fg-muted)] opacity-0 group-hover:opacity-100 transition-opacity transform group-hover:translate-x-1" />
            </Link>
          ))}
        </div>
      ) : (
        <div className="space-y-2 py-16 text-center bg-[color:var(--card-2)] rounded-2xl border border-[color:var(--border)]">
          <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-2xl bg-[color:var(--brand-tint)] shadow-[inset_0_0_0_1px_var(--brand-tint-strong)]">
            <UsersIcon className="w-8 h-8 text-[color:var(--brand-hi)]" />
          </div>
          <p className="font-heading text-base font-semibold text-[color:var(--fg)]">
            No se encontraron usuarios
          </p>
          <p className="text-sm text-[color:var(--fg-muted)]">
            Intenta con otro nombre
          </p>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 pt-4">
          {currentPage > 1 ? (
            <Link
              href={pageUrl(currentPage - 1)}
              className="inline-flex items-center gap-1 rounded-xl bg-[color:var(--card-2)] px-4 py-2 text-sm font-semibold text-[color:var(--fg)] shadow-[inset_0_0_0_1px_var(--border)] transition-all hover:shadow-[inset_0_0_0_1px_var(--brand-tint-strong)]"
            >
              <ChevronLeft className="w-4 h-4" />
              Anterior
            </Link>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-xl px-4 py-2 text-sm font-medium text-[color:var(--fg-dim)] shadow-[inset_0_0_0_1px_var(--border)]">
              <ChevronLeft className="w-4 h-4" />
              Anterior
            </span>
          )}

          {currentPage < totalPages ? (
            <Link
              href={pageUrl(currentPage + 1)}
              className="inline-flex items-center gap-1 rounded-xl bg-[color:var(--card-2)] px-4 py-2 text-sm font-semibold text-[color:var(--fg)] shadow-[inset_0_0_0_1px_var(--border)] transition-all hover:shadow-[inset_0_0_0_1px_var(--brand-tint-strong)]"
            >
              Siguiente
              <ChevronRight className="w-4 h-4" />
            </Link>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-xl px-4 py-2 text-sm font-medium text-[color:var(--fg-dim)] shadow-[inset_0_0_0_1px_var(--border)]">
              Siguiente
              <ChevronRight className="w-4 h-4" />
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function UsersIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}
