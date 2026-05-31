// ProductCategory interface mirroring the pivot schema in
// supabase/migrations/20260529000001_product_categories_pivot_and_backfill.sql
// (MP#08 #1 Parte 1a) and the is_primary flag added in
// 20260530000002_pivot_is_primary_and_max3.sql (MP#08 #5c-1). Write path
// (multi-row + primary marker) wired in 5c-2. Search ranking primary >
// secondary is 5c-3, badges on cards is 5c-4. categoria TEXT on
// products_services stays as a mirror of the current primary slug for URL
// retrocompat (#4 drops it later).

export interface ProductCategory {
  product_id: string;
  categoria_id: string;
  is_primary: boolean;
  created_at: string;
}

// Shape used at insert time: omits the server-defaulted created_at column
// but keeps is_primary explicit. Useful as the argument type for
// product_categories INSERT calls in server actions.
export type ProductCategoryInsert = Pick<
  ProductCategory,
  "product_id" | "categoria_id" | "is_primary"
>;
