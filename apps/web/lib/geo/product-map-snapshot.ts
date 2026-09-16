import "server-only";
import { sign } from "node:crypto";

/** Signed URLs stay on the server. Apple renders attribution in the PNG. */
export async function productMapSnapshot(zone: { lat: number; lng: number }, dark: boolean): Promise<ArrayBuffer> {
  const teamId = process.env.APPLE_MAPKIT_TEAM_ID;
  const keyId = process.env.APPLE_MAPKIT_KEY_ID;
  const rawKey = process.env.APPLE_MAPKIT_PRIVATE_KEY;
  if (!teamId || !keyId || !rawKey) throw new Error("Map provider unavailable");
  let key = rawKey.trim().replace(/\\n/g, "\n");
  if (!key.includes("-----BEGIN PRIVATE KEY-----")) key = `-----BEGIN PRIVATE KEY-----\n${key}\n-----END PRIVATE KEY-----`;
  const center = `${zone.lat},${zone.lng}`;
  const query = new URLSearchParams({ center, size: "640x180", scale: "2", spn: "0.025,0.09", lang: "es-MX", poi: "0", colorScheme: dark ? "dark" : "light", teamId, keyId });
  // The UI draws the approximation circle with its brand token over this fixed region.
  const path = `/api/v1/snapshot?${query}`;
  const signature = sign("SHA256", Buffer.from(path), { key, dsaEncoding: "ieee-p1363" }).toString("base64url");
  const response = await fetch(`https://snapshot.apple-mapkit.com${path}&signature=${signature}`, {
    cache: "no-store", signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok || !response.headers.get("content-type")?.startsWith("image/png")) throw new Error("Map provider unavailable");
  return response.arrayBuffer();
}
