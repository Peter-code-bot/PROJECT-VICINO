/** Parse the server-only PostGIS POINT contract and discard exact precision. */
export function productMapZone(value: unknown): { lat: number; lng: number } | null {
  if (typeof value !== "string" || !/^(?:[0-9a-f]{42}|[0-9a-f]{50})$/i.test(value)) return null;
  const bytes = Buffer.from(value, "hex");
  if (bytes[0] !== 0 && bytes[0] !== 1) return null;
  const little = bytes[0] === 1;
  const type = little ? bytes.readUInt32LE(1) : bytes.readUInt32BE(1);
  if (type !== 1 && type !== 0x20000001) return null;
  const offset = type === 1 ? 5 : 9;
  if (bytes.length !== offset + 16) return null;
  if (offset === 9 && (little ? bytes.readUInt32LE(5) : bytes.readUInt32BE(5)) !== 4326) return null;
  const lng = little ? bytes.readDoubleLE(offset) : bytes.readDoubleBE(offset);
  const lat = little ? bytes.readDoubleLE(offset + 8) : bytes.readDoubleBE(offset + 8);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) >= 85 || Math.abs(lng) >= 180) return null;
  // Fixed ~1 km cells; repeated views cannot average noise back to a home.
  return { lat: Math.round(lat * 100) / 100, lng: Math.round(lng * 100) / 100 };
}
