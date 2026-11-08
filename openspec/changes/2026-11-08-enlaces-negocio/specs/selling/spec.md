# Delta — selling (change 2026-11-08-enlaces-negocio)

> Delta sobre `openspec/specs/selling/spec.md`. Se mergea al archivar el change. Solo
> ADDED; ningun requisito existente cambia.

## ADDED Requirement: Enlaces de contacto del negocio

The system SHALL let a seller store up to four outbound contact links on `profiles`:
`instagram_usuario`, `whatsapp_numero`, `google_maps_url`, `google_resenas_url`. The
columns SHALL be readable by `anon` and `authenticated` and SHALL be writable only through
the RPC `actualizar_enlaces_negocio`, which requires an authenticated session and
`es_vendedor = TRUE`. The system SHALL NOT read, store or synchronize any message or
review from the linked providers.

Anchored at `supabase/migrations/20261108120000_enlaces_de_contacto_del_negocio.sql`,
`packages/shared/src/utils/enlaces-negocio.ts`,
`apps/web/app/(marketplace)/perfil/actions.ts` (`updateProfile`).

### Scenario: Pasted input is normalized before it is stored

- GIVEN a seller types `@Mi.Tienda`, `+52 (222) 123-4567`, `maps.app.goo.gl/AbC` and an empty review link
- WHEN the profile form is submitted
- THEN `profiles` stores `mi.tienda`, `522221234567`, `https://maps.app.goo.gl/AbC` and `NULL`

### Scenario: A link outside the allowed shape is rejected by name

- GIVEN a seller types `https://evil.com/maps`, `https://www.google.xyz/maps/x` or
  `https://www.google.com/maps/../url?q=https://evil.com` in the Google Maps field
- WHEN the profile form is submitted
- THEN nothing is written and the error names the Google Maps field
- AND the same rule is enforced by the RPC (ERRCODE 22023) and by the CHECK constraint

### Scenario: A stale form never clears links

- GIVEN a profile form opened before the fields existed (no link keys in the FormData)
- WHEN it is submitted by a seller
- THEN the profile is saved and `actualizar_enlaces_negocio` is NOT called

### Scenario: Turning seller mode off keeps the links

- GIVEN a seller with links who disables seller mode
- WHEN the profile is saved
- THEN the four columns keep their values and the public profile stops rendering them

## ADDED Requirement: Public profile renders the links; the Google review link is gated

The public profile `/vendedor/[id]` SHALL render Instagram, WhatsApp and Google Maps
buttons when the profile is a seller and the corresponding column is set. The Google
review link SHALL be rendered only to the owner or to a viewer with at least one
`sale_confirmations` row in status `completed` where `buyer_id` is the viewer and
`seller_id` is the profile. Links SHALL open with `target="_blank"` and
`rel="noopener noreferrer nofollow ugc"`. The WhatsApp link SHALL be
`https://wa.me/<digits>?text=<encoded fixed text>` and SHALL NOT include any data about
the viewer. The review-link rule is a rendering rule: the four columns are publicly
readable like the rest of the public profile.

Anchored at `apps/web/app/(marketplace)/vendedor/[id]/page.tsx`,
`apps/web/components/profile/enlaces-negocio.tsx`,
`apps/web/app/(marketplace)/perfil/profile-header.tsx` (`enlacesNegocio` slot).

### Scenario: Anonymous visitor

- GIVEN a seller with all four links
- WHEN an anonymous visitor opens the profile
- THEN Instagram, WhatsApp and Google Maps are shown and the review link is not

### Scenario: Buyer with a completed purchase

- GIVEN the same seller and a signed-in viewer with a completed sale from that seller
- WHEN the viewer opens the profile
- THEN the review link is shown as well

## ADDED Requirement: Link clicks are counted without identity

The system SHALL record one row in `clics_enlaces_negocio` (`vendedor_id`, `canal`,
`con_sesion`, `created_at`) per click on a business link, through the RPC
`registrar_clic_enlace_negocio`, callable by `anon` and `authenticated`. The row SHALL NOT
contain the clicker's user id, IP address or user agent. The RPC SHALL return FALSE and
insert nothing when the clicker is the owner, the channel is not configured, the profile
is not a visible seller, the business already has 20 clicks in the last minute, or 5,000
clicks were recorded platform-wide in the last hour. Rows older than 90 days SHALL be
purged daily. Only the owner SHALL be able to read their rows (RLS). The seller dashboard
SHALL count per channel (not fetch rows), SHALL state that a click is not a message nor a
sale and that the count is indicative, and SHALL show "—" (not 0) when the query fails.

Anchored at the migration above, `apps/web/app/actions/enlaces-negocio.ts`,
`apps/web/lib/rate-limit.ts` (`clicEnlaceRateLimit`), `apps/web/app/seller/analytics/page.tsx`.

### Scenario: Owner testing their own links

- GIVEN a seller viewing their own profile
- WHEN they tap their WhatsApp button
- THEN the link opens and no row is inserted

### Scenario: Burst from one business page

- GIVEN 20 rows for a business in the last minute
- WHEN another click arrives
- THEN the RPC returns FALSE without raising and inserts nothing
