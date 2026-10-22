import { execFile } from 'node:child_process';
import { stat } from 'node:fs/promises';

export const INPUT_MAX = 200 * 1024 * 1024;
export const OUTPUT_MAX = 10 * 1024 * 1024;
export class MediaError extends Error {
  constructor(code) { super(code); this.name = 'MediaError'; this.code = code; }
}

/** Never use a shell or pass inherited service credentials to a decoder. */
export function runTool(executable, args, { timeout = 120_000, signal, maxBuffer = 1024 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    execFile(executable, args, {
      timeout, signal, killSignal: 'SIGKILL', maxBuffer, windowsHide: true,
      env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP, LANG: 'C', OMP_NUM_THREADS: '2' },
    }, (error, stdout) => {
      if (error) reject(new MediaError(error.killed || error.code === 'ABORT_ERR' ? 'PROCESS_TIMEOUT' : 'DECODE_FAILED'));
      else resolve(stdout);
    });
  });
}

export async function probe(path, { ffprobe = 'ffprobe', signal } = {}) {
  let json;
  try {
    const raw = await runTool(ffprobe, ['-v', 'error', '-max_alloc', '134217728', '-protocol_whitelist', 'file,pipe', '-format_whitelist', 'mov,matroska,webm', '-probesize', '8388608', '-analyzeduration', '10000000', '-show_streams', '-show_format', '-of', 'json', path], { signal, timeout: 30_000 });
    json = JSON.parse(raw);
  } catch (error) { if (error instanceof MediaError) throw error; throw new MediaError('INVALID_METADATA'); }
  return inspectProbe(json);
}

export function inspectProbe(json, { output = false } = {}) {
  const streams = json?.streams;
  if (!Array.isArray(streams) || streams.length < 1 || streams.length > 2) throw new MediaError('UNSUPPORTED_STREAMS');
  const videos = streams.filter(stream => stream.codec_type === 'video' && stream.disposition?.attached_pic !== 1);
  const audio = streams.filter(stream => stream.codec_type === 'audio');
  if (videos.length !== 1 || audio.length > 1 || streams.some(stream => !['audio', 'video'].includes(stream.codec_type))) throw new MediaError('UNSUPPORTED_STREAMS');
  const video = videos[0];
  const width = Number(video.width), height = Number(video.height);
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 2 || height < 2 || width > 8192 || height > 8192 || width * height > 50_000_000) throw new MediaError('INVALID_DIMENSIONS');
  const duration = Number(json.format?.duration);
  const durations = [duration, ...streams.map(stream => stream.duration).filter(value => value !== undefined && value !== 'N/A').map(Number)];
  if (!Number.isFinite(duration) || duration <= 0 || durations.some(value => !Number.isFinite(value) || value <= 0 || value > 10)) throw new MediaError('VIDEO_DURATION_LIMIT');
  if (video.sample_aspect_ratio && !['1:1', '0:1', 'N/A'].includes(video.sample_aspect_ratio)) throw new MediaError('UNSUPPORTED_ASPECT_RATIO');
  const hdr = ['smpte2084', 'arib-std-b67'].includes(video.color_transfer);
  const [fpsNumerator, fpsDenominator] = String(video.avg_frame_rate || video.r_frame_rate || '0/0').split('/').map(Number);
  const fps = fpsNumerator / fpsDenominator;
  if (output) {
    if (video.codec_name !== 'h264' || (audio[0] && audio[0].codec_name !== 'aac') || video.pix_fmt !== 'yuv420p') throw new MediaError('INVALID_OUTPUT_CODEC');
    if (Math.max(width, height) > 1280 || Math.min(width, height) > 720 || width % 2 || height % 2) throw new MediaError('INVALID_OUTPUT_DIMENSIONS');
    const [numerator, denominator] = String(video.avg_frame_rate).split('/').map(Number);
    if (!denominator || !Number.isFinite(numerator / denominator) || numerator / denominator > 30.01) throw new MediaError('INVALID_OUTPUT_FRAMERATE');
    if (hdr || Number(video.tags?.rotate ?? 0) !== 0 || video.side_data_list?.some(data => Number(data.rotation ?? 0) !== 0)) throw new MediaError('INVALID_OUTPUT_ORIENTATION');
    const forbidden = /location|gps|make|model|serial|creation_time/i;
    if ([json.format?.tags, ...streams.map(stream => stream.tags)].some(tags => Object.keys(tags ?? {}).some(key => forbidden.test(key)))) throw new MediaError('OUTPUT_METADATA_RETAINED');
  }
  return { width, height, duration: Math.max(...durations), hdr, fps, video, hasAudio: audio.length > 0, json };
}

export function videoFilters(metadata) {
  const filters = [];
  if (metadata.hdr) filters.push('zscale=t=linear:npl=100', 'format=gbrpf32le', 'zscale=p=bt709', 'tonemap=tonemap=hable:desat=0', 'zscale=t=bt709:m=bt709:r=tv');
  filters.push("scale=w='min(iw,if(gte(iw,ih),1280,720))':h='min(ih,if(gte(iw,ih),720,1280))':force_original_aspect_ratio=decrease:force_divisible_by=2", 'setsar=1');
  if (!Number.isFinite(metadata.fps) || metadata.fps <= 0) throw new MediaError('INVALID_FRAMERATE');
  if (metadata.fps > 30) filters.push('fps=30');
  filters.push('format=yuv420p');
  return filters.join(',');
}

export async function transcode(input, output, { ffmpeg = 'ffmpeg', ffprobe = 'ffprobe', signal } = {}) {
  const metadata = await probe(input, { ffprobe, signal });
  if (metadata.hdr) {
    const filters = await runTool(ffmpeg, ['-hide_banner', '-filters'], { signal, timeout: 10_000 });
    if (!/\bzscale\b/.test(filters) || !/\btonemap\b/.test(filters)) throw new MediaError('HDR_NOT_SUPPORTED');
  }
  await runTool(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-n', '-max_alloc', '134217728', '-threads', '2', '-filter_threads', '1', '-protocol_whitelist', 'file,pipe', '-format_whitelist', 'mov,matroska,webm', '-probesize', '8388608', '-analyzeduration', '10000000', '-i', input, '-map', '0:v:0', '-map', '0:a:0?', '-map_metadata', '-1', '-map_chapters', '-1', '-sn', '-dn', '-vf', videoFilters(metadata), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-maxrate', '2800k', '-bufsize', '5600k', '-threads', '2', '-pix_fmt', 'yuv420p', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-metadata:s:v:0', 'rotate=0', '-c:a', 'aac', '-b:a', '96k', '-ac', '2', '-ar', '48000', '-movflags', '+faststart', '-fs', String(OUTPUT_MAX), output], { signal });
  const size = (await stat(output)).size;
  if (size < 1 || size >= OUTPUT_MAX - 65536) throw new MediaError('OUTPUT_SIZE_LIMIT');
  const verified = await probe(output, { ffprobe, signal });
  inspectProbe(verified.json, { output: true });
  // Truncated output must not pass just because -fs produced a valid shorter MP4.
  if (verified.duration + 0.15 < metadata.duration) throw new MediaError('OUTPUT_TRUNCATED');
  return { size, duration: verified.duration, metadata: verified };
}

export async function thumbnail(output, target, { ffmpeg = 'ffmpeg', signal } = {}) {
  await runTool(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-n', '-threads', '2', '-filter_threads', '1', '-protocol_whitelist', 'file,pipe', '-format_whitelist', 'mov', '-ss', '0', '-i', output, '-frames:v', '1', '-vf', "scale=w='min(iw,512)':h='min(ih,512)':force_original_aspect_ratio=decrease:force_divisible_by=2,pad=512:512:(ow-iw)/2:(oh-ih)/2:black", '-map_metadata', '-1', '-q:v', '3', target], { signal, timeout: 20_000 });
  if ((await stat(target)).size > 2 * 1024 * 1024) throw new MediaError('THUMBNAIL_SIZE_LIMIT');
}
