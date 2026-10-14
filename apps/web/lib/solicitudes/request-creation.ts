/** A database rejection rolls back the RPC transaction. Transport/5xx failures
 * can arrive after commit: retain the operation and attachment for safe replay. */
export function isKnownRequestRejection(code: string | undefined) {
  return !!code && (/^(22|23|28|40|42)[0-9A-Z]{3}$/.test(code) || code === "P0001" || /^PGRST20[023]$/.test(code));
}

export type RequestCreationResult =
  | { status: "success"; id: string }
  | { status: "rejected"; message: string }
  | { status: "uncertain"; message: string };
