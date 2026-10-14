import { CATEGORIES } from "./categories";

/** Community-only catalog. Product and purchase-request options stay unchanged. */
export const COMMUNITY_CATEGORIES = [
  { id: "comunidad-vecinal", name: "Comunidad vecinal", icon: "Users", sourceCategoryId: null },
  ...CATEGORIES.filter(category => !category.hidden_in_form).map(category => ({
    id: category.id, name: category.name, icon: category.icon, sourceCategoryId: category.id,
  })),
] as const;

export type CommunityCategoryId = (typeof COMMUNITY_CATEGORIES)[number]["id"];
export function communityCategoryName(id: string | null | undefined): string {
  return COMMUNITY_CATEGORIES.find(category => category.id === id)?.name ?? "Otros";
}

/** Preserve the server's order inside each category (activity or proximity). */
export function groupCommunitiesByCategory<T extends { categoria_id?: string | null }>(items: T[]) {
  const categoryFor = (item: T) => COMMUNITY_CATEGORIES.find(category => category.id === item.categoria_id)?.id ?? "otros";
  return COMMUNITY_CATEGORIES.map(category => ({
    ...category,
    items: items.filter(item => categoryFor(item) === category.id),
  })).filter(group => group.items.length > 0);
}
