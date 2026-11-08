# Delta — selling (change 2026-11-08-enlaces-negocio)

> Delta sobre `openspec/specs/selling/spec.md`. Se mergea al archivar el change. Solo
> ADDED; ningun requisito existente cambia.

## ADDED Requirement: Enlaces de contacto del negocio

The system SHALL let a seller store up to four outbound contact links on `profiles`:
`instagram_usuario`, `whatsapp_numero`, `google_maps_url`, `google_resenas_url`. The
columns SHALL be readable by `anon` and `authenticated` and SHALL be writable only through
the RPC `actualizar_enlaces_negocio`, which requires an authenticated session. Setting a
non-null link SHALL require `es_vendedor = TRUE`; clearing all four SHALL always be
allowed. The system SHALL NOT read, store or synchronize any message or review from the
linked providers. `whatsapp_numero` SHALL be 11 to 15 digits in international format; a
10-digit local number SHALL be rejected with a message and SHALL NOT be completed with a
guessed country code.

Anchored at `supabase/migrations/20261108120000_enlaces_de_contacto_del_negocio.sql`,
`packages/shared/src/utils/enlaces-negocio.ts`,
`apps/web/app/(marketplace)/perfil/actions.ts` (`updateProfile`).

### Scenario: Pasted input is normalized before it is stored

- GIVEN a seller types `@Mi.Tienda`, `+52 (222) 123-4567`, `maps.app.goo.gl/AbC` and an empty review link
- WHEN the profile form is submitted
- THEN `profiles` stores `mi.tienda`, `522221234567`, `https://maps.app.goo.gl/AbC` and `NULL`

### Scenario: A link outside the allowed shape is rejected by name

- GIVEN a seller types `https://evil.com/maps`, `https://www.google.xyz/maps/x`,
  `https://www.google.com/maps/../url?q=https://evil.com` or a URL with a control
  character in the Google Maps field, or a 10-digit WhatsApp number
- WHEN the profile form is submitted
- THEN nothing is written (neither profile nor links) and the error names the field
- AND the same rule is enforced by the RPC (ERRCODE 22023) and by the CHECK constraint
  with an explicit list of forbidden code points identical on both sides

### Scenario: A stale form never clears links

- GIVEN a profile form opened before the fields existed (no link keys in the FormData)
- WHEN it is submitted by a seller
- THEN the profile is saved and `actualizar_enlaces_negocio` is NOT called

### Scenario: Turning seller mode off clears the links

- GIVEN a seller with links who disables seller mode (the form still carries the four keys)
- WHEN the profile is saved
- THEN `actualizar_enlaces_negocio` is called with the four parameters omitted and the
  columns become `NULL`, while `nombre_negocio`, `descripcion_negocio` and
  `metodos_pago_aceptados` keep their values; the deactivation dialog states this

### Scenario: The second RPC fails after the profile was saved

- GIVEN a valid profile and a link the RPC rejects (22023) or a permission error
- WHEN the profile form is submitted
- THEN the layout is revalidated, the message says the profile was saved but the links were
  not, 22023 and the expected 42501 are shown verbatim, and any other error is reported to
  Sentry with a generic message

## ADDED Requirement: Public profile renders the links; the Google review link is gated

The public profile `/vendedor/[id]` SHALL render Instagram, WhatsApp and Google Maps
buttons when the profile is a seller and the corresponding column is set. The Google
review link SHALL be rendered only to the owner or to a viewer with at least one
`sale_confirmations` row in status `completed` where `buyer_id` is the viewer and
`seller_id` is the profile. Links SHALL open with `target="_blank"` and
`rel="noopener noreferrer nofollow ugc"`. The WhatsApp link SHALL be
`https://wa.me/<digits>?text=<encoded fixed text>` and SHALL NOT include any data about
the viewer. The review-link rule is a rendering rule: the four columns are publicly
readable like the rest of the public profile. On Android inside the Capacitor app, links
whose host matches the `*.google.com` entry of `allowNavigation` SHALL be opened with
`@capacitor/browser` instead of navigating the WebView.

Anchored at `apps/web/app/(marketplace)/vendedor/[id]/page.tsx`,
`apps/web/components/profile/enlaces-negocio.tsx`,
`apps/web/lib/perfil/abrir-enlace-externo.ts`,
`apps/web/app/(marketplace)/perfil/profile-header.tsx` (`enlacesNegocio` slot).

### Scenario: Anonymous visitor

- GIVEN a seller with all four links
- WHEN an anonymous visitor opens the profile
- THEN Instagram, WhatsApp and Google Maps are shown and the review link is not

### Scenario: Buyer with a completed purchase

- GIVEN the same seller and a signed-in viewer with a completed sale from that seller
- WHEN the viewer opens the profile
- THEN the review link is shown as well

### Scenario: Maps link copied from the browser, on Android

- GIVEN `google_maps_url = https://www.google.com/maps/place/...` and the Android app
- WHEN the viewer taps "Google Maps"
- THEN the link opens in a system tab (`Browser.open`) and closing it returns to the profile;
  the WebView never loads google.com in place of the profile

## ADDED Requirement: Link clicks are counted without identity

The system SHALL record one row in `clics_enlaces_negocio` (`vendedor_id`, `canal`,
`con_sesion`, `created_at`) per click on a business link, through the RPC
`registrar_clic_enlace_negocio`, callable by `anon` and `authenticated`. The row SHALL NOT
contain the clicker's user id, IP address or user agent. The RPC SHALL return FALSE and
insert nothing when the clicker is the owner, the channel is not configured, the profile
is not a visible seller, the business already has 20 clicks in the last minute, or 5,000
clicks were recorded platform-wide in the last hour; it SHALL serialize calls per business
with an advisory lock. Rows older than 90 days SHALL be purged daily. Only the owner SHALL be
able to read their rows (RLS). The Server Action SHALL key its rate limit by user id or by
a dated hash of the IP, with Upstash analytics disabled, and SHALL NOT persist the IP. The
seller dashboard SHALL count per channel (not fetch rows), SHALL state that a click is not a
message nor a sale and that the count is indicative, and SHALL show "—" (not 0) when the
query fails.

Anchored at the migration above, `apps/web/app/actions/enlaces-negocio.ts`,
`apps/web/lib/perfil/cubeta-clic.ts`, `apps/web/lib/rate-limit.ts` (`clicEnlaceRateLimit`),
`apps/web/app/seller/analytics/page.tsx`.

### Scenario: Owner testing their own links

- GIVEN a seller viewing their own profile
- WHEN they tap their WhatsApp button
- THEN the link opens and no row is inserted

### Scenario: Burst from one business page

- GIVEN 20 rows for a business in the last minute
- WHEN another click arrives
- THEN the RPC returns FALSE without raising and inserts nothing

### Scenario: Anonymous click

- GIVEN a visitor without a session
- WHEN they tap a link
- THEN the rate-limit bucket is `clic-ip:<22-char hash of day|ip>`, never the IP, and the
  RPC receives only the business id and the channel
