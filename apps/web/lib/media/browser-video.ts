'use client';

import { VIDEO_INPUT_MAX_BYTES, VIDEO_MAX_SECONDS, VIDEO_OUTPUT_MAX_BYTES } from './product-media-policy';
import { readProductVideoMetadata } from './video-metadata';

const MAX_PIXELS = 50_000_000;
let running = false;
const abortError = () => new DOMException('Preparación de video cancelada', 'AbortError');

export class VideoValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VideoValidationError';
  }
}

/**
 * Free client-side hardware-accelerated video compression via WebCodecs + Mediabunny.
 * Returns null only when WebCodecs is unavailable in the current runtime.
 */
export async function compressBrowserVideo(
  file: File,
  options: { signal?: AbortSignal; onProgress?: (progress: number) => void } = {},
): Promise<File | null> {
  if (typeof window === 'undefined' || typeof VideoEncoder !== 'function' || typeof VideoDecoder !== 'function') {
    return null;
  }
  if (!file.size || file.size > VIDEO_INPUT_MAX_BYTES) {
    throw new VideoValidationError('Elige un video de hasta 200 MB.');
  }
  if (running) {
    throw new VideoValidationError('Ya se está preparando otro video.');
  }
  if (options.signal?.aborted) throw abortError();

  running = true;
  try {
    const {
      Input,
      Output,
      BlobSource,
      BufferTarget,
      Mp4OutputFormat,
      Conversion,
      ConversionCanceledError,
      MP4,
      QTFF,
      WEBM,
      canEncodeAudio,
    } = await import('mediabunny');
    if (options.signal?.aborted) throw abortError();

    for (const videoBitrate of [2_500_000, 1_200_000]) {
      const input = new Input({
        source: new BlobSource(file),
        formats: [MP4, QTFF, WEBM],
      });
      let cancelConversion: (() => void) | undefined;
      const onAbort = () => { cancelConversion?.(); };
      options.signal?.addEventListener('abort', onAbort, { once: true });

      try {
        if (!(await input.canRead())) {
          throw new VideoValidationError('El contenedor de video no es válido.');
        }
        const videoTrack = await input.getPrimaryVideoTrack();
        if (!videoTrack) {
          throw new VideoValidationError('El archivo no contiene una pista de video válida.');
        }
        const width = await videoTrack.getDisplayWidth();
        const height = await videoTrack.getDisplayHeight();
        if (!Number.isFinite(width) || !Number.isFinite(height) || width < 2 || height < 2 || width * height > MAX_PIXELS) {
          throw new VideoValidationError('Las dimensiones del video no son válidas.');
        }
        const duration = await input.computeDuration();
        if (!Number.isFinite(duration) || duration <= 0 || duration > VIDEO_MAX_SECONDS + 0.05) {
          throw new VideoValidationError('El video debe durar hasta 10 segundos.');
        }
        if (options.signal?.aborted) throw abortError();

        const scale = Math.min(1, 1280 / Math.max(width, height), 720 / Math.min(width, height));
        const outW = Math.max(2, Math.round((width * scale) / 2) * 2);
        const outH = Math.max(2, Math.round((height * scale) / 2) * 2);
        const aacSupported = await canEncodeAudio('aac', {
          numberOfChannels: 2,
          sampleRate: 48_000,
          bitrate: 128_000,
        }).catch(() => false);

        const target = new BufferTarget();
        const output = new Output({
          format: new Mp4OutputFormat({ fastStart: 'in-memory' }),
          target,
        });

        const conversion = await Conversion.init({
          input,
          output,
          tracks: 'primary',
          tags: {},
          showWarnings: false,
          trim: { start: 0, end: Math.min(duration, VIDEO_MAX_SECONDS - 0.03) },
          video: {
            width: outW,
            height: outH,
            fit: 'fill',
            frameRate: 30,
            codec: 'avc',
            bitrate: videoBitrate,
            forceTranscode: true,
            allowTransformationMetadata: false,
          },
          audio: async track => {
            const codec = await track.getCodec();
            if (aacSupported && (await track.canDecode())) {
              return {
                codec: 'aac',
                bitrate: 128_000,
                numberOfChannels: 2,
                sampleRate: 48_000,
                forceTranscode: true,
              };
            }
            if (codec === 'aac') return { codec: 'aac' };
            return { discard: true };
          },
        });

        cancelConversion = () => { void conversion.cancel().catch(() => {}); };
        if (options.signal?.aborted) {
          await conversion.cancel().catch(() => {});
          throw abortError();
        }
        if (!conversion.isValid) {
          return null;
        }

        conversion.onProgress = progress => {
          if (Number.isFinite(progress)) {
            options.onProgress?.(Math.max(0, Math.min(0.95, progress * 0.95)));
          }
        };

        try {
          await conversion.execute();
        } catch (error) {
          if (options.signal?.aborted || error instanceof ConversionCanceledError) {
            throw abortError();
          }
          throw error;
        }

        if (options.signal?.aborted) throw abortError();
        const buffer = target.buffer;
        if (!buffer || !buffer.byteLength) return null;
        if (buffer.byteLength > VIDEO_OUTPUT_MAX_BYTES) {
          continue;
        }

        const outFile = new File(
          [buffer],
          `${file.name.replace(/\.[^.]+$/, '') || 'video'}.mp4`,
          { type: 'video/mp4' },
        );
        await readProductVideoMetadata(outFile);
        options.onProgress?.(1);
        return outFile;
      } finally {
        options.signal?.removeEventListener('abort', onAbort);
        input.dispose();
      }
    }
    throw new VideoValidationError('No pudimos reducir el video a menos de 10 MB.');
  } catch (error) {
    if (options.signal?.aborted || (error instanceof DOMException && error.name === 'AbortError')) {
      throw abortError();
    }
    throw error;
  } finally {
    running = false;
  }
}
