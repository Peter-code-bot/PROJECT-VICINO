import "server-only";
import * as Sentry from "@sentry/nextjs";
import { createAdminClient } from "@/lib/supabase/admin";
import { catalogFailure } from "@/lib/catalogo/estado-consulta";
import {
  HOME_GUEST_PREVIEW_LIMIT, parseGuestRequests, parseGuestCommunities, parseGuestPosts,
  type HomeGuestPreview,
} from "@/lib/home-guest-contract";

/** National examples, read only through restricted RPCs. No user location,
 * private feed, membership, profile or media query is used for this preview.
 */
export async function getGuestHomePreview(feed: "solicitudes" | "comunidades"): Promise<HomeGuestPreview> {
  const admin = createAdminClient();
  if (feed === "solicitudes") {
    try {
      const { data } = await admin.rpc("home_guest_requests_preview", { result_limit: HOME_GUEST_PREVIEW_LIMIT }).throwOnError();
      return { kind: feed, requests: parseGuestRequests(data), failure: null };
    } catch (error) {
      Sentry.captureException(error, { tags: { action: "home_guest_requests_preview" } });
      return { kind: feed, requests: [], failure: catalogFailure(error) };
    }
  }
  const [communities, posts] = await Promise.allSettled([
    admin.rpc("home_guest_communities_preview", { result_limit: HOME_GUEST_PREVIEW_LIMIT }).throwOnError().then(({ data }) => parseGuestCommunities(data)),
    admin.rpc("home_guest_posts_preview", { result_limit: HOME_GUEST_PREVIEW_LIMIT }).throwOnError().then(({ data }) => parseGuestPosts(data)),
  ]);
  for (const [action, result] of [["home_guest_communities_preview", communities], ["home_guest_posts_preview", posts]] as const) {
    if (result.status === "rejected") Sentry.captureException(result.reason, { tags: { action } });
  }
  return {
    kind: feed,
    communities: communities.status === "fulfilled" ? communities.value : [],
    posts: posts.status === "fulfilled" ? posts.value : [],
    communityFailure: communities.status === "rejected" ? catalogFailure(communities.reason) : null,
    postFailure: posts.status === "rejected" ? catalogFailure(posts.reason) : null,
  };
}
