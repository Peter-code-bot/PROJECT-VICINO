export async function readStoredMedia(url: string, maxBytes: number, request: typeof fetch = fetch): Promise<Blob> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await request(url, { redirect: "error", cache: "no-store", signal: controller.signal });
    if (!response.ok || !response.body) { await response.body?.cancel(); throw new Error("No se encontró uno de los archivos. Intenta subirlo otra vez."); }
    const length = Number(response.headers.get("content-length"));
    if (Number.isFinite(length) && length > maxBytes) { await response.body.cancel(); throw new Error("Uno de los archivos supera el tamaño permitido."); }
    const reader = response.body.getReader();
    const chunks: Uint8Array<ArrayBuffer>[] = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) { controller.abort(); throw new Error("Uno de los archivos supera el tamaño permitido."); }
        chunks.push(new Uint8Array(value));
      }
    } finally { reader.releaseLock(); }
    if (!size) throw new Error("Uno de los archivos está vacío.");
    return new Blob(chunks, { type: (response.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase() });
  } finally { clearTimeout(timer); }
}

