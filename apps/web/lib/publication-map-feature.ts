/** The validated S10 migration is installed. Set false and rebuild to disable. */
export function isPublicationMapEnabled(): boolean {
  return (process.env.NEXT_PUBLIC_VICINO_MAP_ENABLED ?? "true") === "true";
}
