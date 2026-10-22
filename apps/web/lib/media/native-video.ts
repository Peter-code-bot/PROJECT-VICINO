'use client';

import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { VIDEO_INPUT_MAX_BYTES, VIDEO_MAX_SECONDS, VIDEO_OUTPUT_MAX_BYTES } from './product-media-policy';

interface NativeVideoPlugin {
  begin(options: { size: number }): Promise<{ id: string }>;
  writeChunk(options: { id: string; offset: number; data: string }): Promise<void>;
  finish(options: { id: string }): Promise<{ uri: string; size: number; duration: number }>;
  cancel(options: { id: string }): Promise<void>;
  addListener(event: 'progress', listener: (event: { id: string; progress: number }) => void): Promise<PluginListenerHandle>;
}

const NativeVideo = registerPlugin<NativeVideoPlugin>('VicinoVideo');
// Never put a full video in a bridge message (or a data URL). Only one chunk is live.
const CHUNK_BYTES = 192 * 1024;
let running = false;
const abortError = () => new DOMException('Preparación de video cancelada', 'AbortError');

/** null means an older native build/web browser; callers must then use server preparation. */
export async function compressNativeVideo(
  file: File,
  options: { signal?: AbortSignal; onProgress?: (progress: number) => void } = {},
): Promise<File | null> {
  if (!Capacitor.isNativePlatform() || !Capacitor.isPluginAvailable('VicinoVideo')) return null;
  if (!file.size || file.size > VIDEO_INPUT_MAX_BYTES) throw new Error('El video debe pesar hasta 200 MB.');
  if (running) throw new Error('Ya se está preparando otro video.');
  if (options.signal?.aborted) throw abortError();
  running = true;
  let id: string | undefined;
  let listener: PluginListenerHandle | undefined;
  const checkAbort = () => { if (options.signal?.aborted) throw abortError(); };
  const onAbort = () => { if (id) void NativeVideo.cancel({ id }).catch(() => {}); };
  options.signal?.addEventListener('abort', onAbort, { once: true });
  try {
    ({ id } = await NativeVideo.begin({ size: file.size }));
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error('Sesión de video inválida.');
    checkAbort();
    listener = await NativeVideo.addListener('progress', (event) => {
      if (event.id === id && Number.isFinite(event.progress)) {
        options.onProgress?.(0.25 + Math.max(0, Math.min(1, event.progress)) * 0.7);
      }
    });
    for (let offset = 0; offset < file.size; offset += CHUNK_BYTES) {
      checkAbort();
      const bytes = new Uint8Array(await file.slice(offset, offset + CHUNK_BYTES).arrayBuffer());
      let binary = '';
      for (let start = 0; start < bytes.length; start += 8192) {
        binary += String.fromCharCode(...bytes.subarray(start, start + 8192));
      }
      checkAbort();
      await NativeVideo.writeChunk({ id, offset, data: btoa(binary) });
      options.onProgress?.(Math.min(0.25, (offset + bytes.length) / file.size * 0.25));
    }
    checkAbort();
    const output = await NativeVideo.finish({ id });
    checkAbort();
    if (!Number.isFinite(output.duration) || output.duration <= 0 || output.duration > VIDEO_MAX_SECONDS ||
        !Number.isSafeInteger(output.size) || output.size <= 0 || output.size > VIDEO_OUTPUT_MAX_BYTES) {
      throw new Error('El video preparado excede los límites permitidos.');
    }
    // The native plugin only exports its own internal cache; no remote URLs or caller paths.
    const uri = new URL(output.uri);
    if (uri.protocol !== 'file:' || uri.host || !uri.pathname.endsWith(`/vicino-video/${id}/output.mp4`)) {
      throw new Error('Ruta de video inválida.');
    }
    const response = await fetch(Capacitor.convertFileSrc(output.uri), { signal: options.signal });
    if (!response.ok) throw new Error('No se pudo leer el video preparado.');
    const blob = await response.blob();
    checkAbort();
    if (blob.size !== output.size || blob.size > VIDEO_OUTPUT_MAX_BYTES) throw new Error('Video preparado incompleto.');
    options.onProgress?.(1);
    return new File([blob], `${file.name.replace(/\.[^.]+$/, '') || 'video'}.mp4`, { type: 'video/mp4' });
  } catch (error) {
    if (options.signal?.aborted) throw abortError();
    throw error;
  } finally {
    options.signal?.removeEventListener('abort', onAbort);
    try { if (listener) await listener.remove(); } catch { /* cleanup must still run */ }
    try { if (id) await NativeVideo.cancel({ id }); } finally { running = false; }
  }
}
