# Design — Optimize Auth Session Hydration

> Implementation plan for proposal `2026-06-01-optimize-auth-session-hydration`.
> Three surgical fixes: F2 is 2 lines replaced, F3 is a restructure of existing awaits,
> F4 is 2 lines added. F1 was cancelled after build verification (see section 1 below).

## 1. Correction — `proxy.ts` is the active middleware (Next.js 16)

The initial audit hypothesized creating `apps/web/middleware.ts` to "activate" the
middleware logic in `proxy.ts`. This hypothesis was based on the pre-Next.js-16
convention where `middleware.ts` was the only valid entry point.

**Next.js 16 renamed the middleware entry point to `proxy.ts`.** The file
`apps/web/proxy.ts` IS the active middleware. It executes on every matched request,
calling `updateSession` from `lib/supabase/middleware.ts` to refresh the Supabase
session cookie at the edge.

Empirical verification: creating a parallel `apps/web/middleware.ts` produces the
build error `Both middleware file "./middleware.ts" and proxy file "./proxy.ts" are
detected. Please use "./proxy.ts" only.` (Next.js 16.2.6, observed during
implementation gate on branch `feat/optimize-auth-session`.)

Consequence for this change: F1 is removed. The session is already refreshed at the
edge. The flash is caused by the navigation pattern and the layout query waterfall
only, not by a stale cookie reaching the layout. The fix is still correct, but the
expected magnitude of improvement may be smaller than the original 3-5 s projection.

---

## 2. F2 — Replace router.push+refresh with hard navigation

### Problem

`apps/web/components/auth/oauth-url-listener.tsx:71-72`:

```ts
router.push("/");     // Client-side nav — may show stale RSC cache
router.refresh();     // Async server revalidation — fires after push
```

Between `push` and the completion of `refresh`, the home page renders with the
unauthenticated cache: the guest state. This is the flash window.

### Fix

Replace both lines with:

```ts
window.location.replace("/");
```

`window.location.replace` is a full HTTP navigation. The browser:
1. Sends a GET / request with the new session cookie in the request headers.
2. The Next.js server renders the authenticated layout from scratch.
3. The response arrives already authenticated — no stale cache is consulted.
4. The URL history entry for `/auth/callback` is replaced (not pushed), so
   the back button does not return to the callback.

### Why not router.push + router.refresh

`router.refresh` only invalidates the RSC cache for the current rendered tree.
Between the moment `push` navigates and the moment `refresh` resolves, the browser
has already painted the stale (unauthenticated) version. There is no way to atomically
navigate + revalidate with the App Router cache model. `window.location.replace` is
the only mechanism that guarantees the first paint is authenticated.

### Security note

The destination `"/"` is a hardcoded string literal. It does not take input from the
URL, the deep link payload, or any external source. There is no open redirect risk.

### Side effect: remove `useRouter` import if unused

`apps/web/components/auth/oauth-url-listener.tsx:11` imports `useRouter`. After F2,
`router` is still used in lines 57 and 68 (error redirects to `/login`). Therefore
keep the `useRouter` import.

---

## 3. F3 — Parallelize layout DB queries

### Problem

`apps/web/app/(marketplace)/layout.tsx:15-58` makes 6 sequential awaits:

1. `supabase.auth.getUser()` — network call to Supabase Auth (200-800 ms)
2. `supabase.from("profiles").select(...)` — DB query (~50-150 ms)
3. `supabase.from("user_roles").select(...)` — DB query (~50-150 ms)
4. `supabase.from("notifications").select(...)` — DB query (~50-150 ms)
5. `supabase.from("chats").select(...).eq("comprador_id", ...)` — DB query (~50-150 ms)
6. `supabase.from("chats").select(...).eq("vendedor_id", ...)` — DB query (~50-150 ms)

Total: 450-1450 ms sequential.

Queries 2-6 all depend on `user.id` from query 1, but are independent of each other.

### Fix

Two-step execution:

```ts
// Step 1: getUser — required to get userId for the DB queries
const supabase = await createClient();
const { data: { user } } = await supabase.auth.getUser();

// Step 2: all 5 DB queries in parallel (no mutual dependencies)
let profile = null;
let isAdmin = false;
let unreadNotifications = 0;
let unreadChatMessages = 0;

if (user) {
  const [
    profileResult,
    rolesResult,
    notifResult,
    buyerChatsResult,
    sellerChatsResult,
  ] = await Promise.all([
    supabase.from("profiles").select("nombre, foto, es_vendedor")
      .eq("id", user.id).single(),
    supabase.from("user_roles").select("role")
      .eq("user_id", user.id).in("role", ["admin", "moderator"]),
    supabase.from("notifications").select("id", { count: "exact", head: true })
      .eq("user_id", user.id).eq("leida", false).neq("tipo", "message"),
    supabase.from("chats").select("no_leidos_comprador")
      .eq("comprador_id", user.id),
    supabase.from("chats").select("no_leidos_vendedor")
      .eq("vendedor_id", user.id),
  ]);

  profile = profileResult.data ?? null;
  isAdmin = (rolesResult.data?.length ?? 0) > 0;
  unreadNotifications = notifResult.count ?? 0;
  unreadChatMessages =
    (buyerChatsResult.data?.reduce((s, c) => s + (c.no_leidos_comprador ?? 0), 0) ?? 0) +
    (sellerChatsResult.data?.reduce((s, c) => s + (c.no_leidos_vendedor ?? 0), 0) ?? 0);
}
```

### Impact

The 5 DB queries (previously ~250-750 ms sequential) run concurrently and resolve in
the time of the slowest single query (~50-150 ms). Total layout time drops from
450-1450 ms to ~250-950 ms (getUser 200-800 ms + slowest DB query 50-150 ms).

### Correctness guarantee

None of the 5 DB queries depend on the result of any other. Each takes only `user.id`
as its input, which is available from step 1. Confirmed by reading
`apps/web/app/(marketplace)/layout.tsx:26-58`.

---

## 4. F4 — Fix callback route response headers

### Problem

`apps/web/app/auth/callback-server/route.ts:24`:

```ts
return NextResponse.redirect(`${origin}${next}`);
```

Two issues:
1. No explicit status code — defaults to `307 Temporary Redirect`. OAuth Post-Redirect-Get
   flows should use `303 See Other` (RFC 6749 recommendation) to ensure browsers issue a
   GET on the redirect target, not repeat the original method.
2. No `Cache-Control` header — browsers and Vercel CDN can cache the redirect response.
   A cached response with `?code=...` in the URL will fail on second use because Supabase
   invalidates the PKCE code after first exchange.

### Fix

```ts
return NextResponse.redirect(`${origin}${next}`, {
  status: 303,
  headers: { "Cache-Control": "private, no-store" },
});
```

`private`: the response is specific to the user, must not be stored in shared caches.
`no-store`: the response must not be stored in any cache (browser or CDN).

The error path redirect (`/login?error=auth_callback_failed`) does not carry sensitive
query params but is also non-cacheable by nature (redirect target varies). Apply the
same headers for consistency.

### Note on session cookie

The `Cache-Control: private, no-store` header applies to the redirect response body and
headers, not to the `Set-Cookie` header. The session cookie set by Supabase during
`exchangeCodeForSession` is delivered as a separate `Set-Cookie` header on the same
response, which is unaffected by `Cache-Control`. The browser will store the cookie
normally per the cookie's own `Max-Age`/`Expires` attributes.

---

## 5. F5 — getClaims migration (OUT OF SCOPE)

Deferred until Pedro activates asymmetric JWT (RS256) in Supabase Dashboard -> Auth ->
JWT Settings. Without RS256, `supabase.auth.getClaims()` is not available in the SDK.

This change does NOT implement F5.

---

## 6. Commit sequence

All work on branch `feat/optimize-auth-session` cut from current master.

```
docs(openspec): correct middleware hypothesis, proxy.ts active in next 16
fix(auth): replace router.push+refresh with window.location.replace
perf(layout): parallelize marketplace layout DB queries
fix(callback): add Cache-Control no-store and status 303 to auth callback route
```

`pnpm build` green between every code commit (Lesson 1). CODEX adversarial review on
the full branch before push (auth is maximum-priority area per CLAUDE.md).
