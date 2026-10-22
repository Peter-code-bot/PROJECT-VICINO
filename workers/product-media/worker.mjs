import { mkdtemp, rm } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { canonicalJob, createApi } from './api.mjs';
import { INPUT_MAX, OUTPUT_MAX, MediaError, probe, inspectProbe, transcode, thumbnail } from './transcode.mjs';

const TRANSIENT = /^(NETWORK_ERROR|HTTP_5\d\d|HTTP_429|HTTP_401|HTTP_403|PROCESS_TIMEOUT)$/;
async function sha256(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}
const safeCode = error => error instanceof MediaError && /^[A-Z0-9_]{1,64}$/.test(error.code) ? error.code : 'WORKER_ERROR';
const log = (job, code) => console.log(JSON.stringify({ job_id: job, code }));

export async function processJob(api, job, { signal, ffmpeg = 'ffmpeg', ffprobe = 'ffprobe', logger = log } = {}) {
  const paths = canonicalJob(job);
  const jobSignal = AbortSignal.any([AbortSignal.timeout(5 * 60_000), ...(signal ? [signal] : [])]);
  const directory = await mkdtemp(join(tmpdir(), 'vicino-media-'));
  const input = join(directory, 'source');
  const output = join(directory, 'output.mp4');
  const thumb = join(directory, 'output_thumb.jpg');
  let published = false;
  async function finish(status, size = null, duration = null, code = null) {
    return api.rpc('finish_product_video_job', { p_job_id: job.id, p_lease_id: job.lease_id, p_status: status, p_output_size: size, p_duration: duration, p_error_code: code }, jobSignal);
  }
  // Never delete if a ready commit is ambiguous or another lease could be adopting the immutable output.
  async function cleanupTerminal() {
    try {
      const current = await api.job(job.id);
      if (['failed', 'cancelled'].includes(current.status)) {
        await api.remove('product-media', [paths.output, paths.thumb]);
        await api.remove('media-processing', [paths.input]);
        await api.rpc('mark_product_video_input_deleted', { p_job_id: job.id });
      }
    } catch { logger(job.id, 'CLEANUP_DEFERRED'); }
  }
  try {
    await api.download('media-processing', paths.input, input, INPUT_MAX, Number(job.input_size), jobSignal);
    let result = await transcode(input, output, { ffmpeg, ffprobe, signal: jobSignal });
    const current = await api.job(job.id, jobSignal);
    if (current.status !== 'processing' || current.lease_id !== job.lease_id || !Number.isFinite(Date.parse(current.lease_until)) || Date.parse(current.lease_until) < Date.now() + 120_000) throw new MediaError('LEASE_LOST');
    const created = await api.upload('product-media', paths.output, output, 'video/mp4', jobSignal);
    let thumbnailSource = output;
    if (!created) {
      // Recover a prior attempt whose upload response was lost. The protected namespace only accepts service writes.
      const existing = join(directory, 'existing.mp4');
      const size = await api.download('product-media', paths.output, existing, OUTPUT_MAX, null, jobSignal);
      if (await sha256(existing) !== await sha256(output)) throw new MediaError('OUTPUT_CONFLICT');
      const metadata = await probe(existing, { ffprobe, signal: jobSignal });
      inspectProbe(metadata.json, { output: true });
      if (metadata.duration + 0.15 < result.duration) throw new MediaError('OUTPUT_TRUNCATED');
      result = { size, duration: metadata.duration, metadata };
      thumbnailSource = existing;
    }
    try {
      await thumbnail(thumbnailSource, thumb, { ffmpeg, signal: jobSignal });
      await api.upload('product-media', paths.thumb, thumb, 'image/jpeg', jobSignal);
    } catch { logger(job.id, 'THUMBNAIL_UNAVAILABLE'); }
    published = await finish('ready', result.size, result.duration);
    if (!published) { await cleanupTerminal(); logger(job.id, 'LEASE_LOST'); return false; }
    logger(job.id, 'READY');
    try {
      await api.remove('media-processing', [paths.input]);
      await api.rpc('mark_product_video_input_deleted', { p_job_id: job.id });
    } catch { logger(job.id, 'INPUT_CLEANUP_DEFERRED'); }
    return true;
  } catch (error) {
    const code = safeCode(error);
    logger(job.id, code);
    if (!published && !TRANSIENT.test(code) && !jobSignal.aborted && code !== 'LEASE_LOST') {
      try { await finish('failed', null, null, code); } catch { logger(job.id, 'FINISH_DEFERRED'); }
    }
    await cleanupTerminal();
    return false;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export async function collectGarbage(api, { signal, logger = log } = {}) {
  const rows = await api.garbage(signal);
  if (!Array.isArray(rows) || rows.length > 100) throw new MediaError('INVALID_RESPONSE');
  for (const row of rows) {
    const expected = `${row.user_id}/${row.id}/source`;
    if (!/^[0-9a-f-]{36}$/i.test(row.id) || !/^[0-9a-f-]{36}$/i.test(row.user_id) || row.input_path !== expected) throw new MediaError('INVALID_JOB');
    try {
      // Only original inputs. Ready outputs may already be referenced by a product.
      await api.remove('media-processing', [expected], signal);
      await api.rpc('mark_product_video_input_deleted', { p_job_id: row.id }, signal);
      logger(row.id, 'INPUT_COLLECTED');
    } catch { logger(row.id, 'INPUT_CLEANUP_DEFERRED'); }
  }
  const outputs = await api.rpc('expire_unlinked_product_video_outputs', { p_public_base_url: api.publicBaseUrl }, signal);
  if (!Array.isArray(outputs) || outputs.length > 100) throw new MediaError('INVALID_RESPONSE');
  for (const row of outputs) {
    const expected = `${row.user_id}/processed/${row.id}.mp4`;
    if (!/^[0-9a-f-]{36}$/i.test(row.id) || !/^[0-9a-f-]{36}$/i.test(row.user_id) || row.output_path !== expected) throw new MediaError('INVALID_JOB');
    try {
      await api.remove('product-media', [expected, expected.replace(/\.mp4$/, '_thumb.jpg')], signal);
      await api.rpc('mark_product_video_output_deleted', { p_job_id: row.id }, signal);
      logger(row.id, 'OUTPUT_COLLECTED');
    } catch { logger(row.id, 'OUTPUT_CLEANUP_DEFERRED'); }
  }
}

async function main() {
  const api = createApi({ url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY });
  const controller = new AbortController();
  process.once('SIGTERM', () => controller.abort());
  process.once('SIGINT', () => controller.abort());
  const signal = controller.signal;
  if (process.argv.includes('--gc')) { await collectGarbage(api, { signal }); return; }
  let lastGc = 0;
  do {
    if (Date.now() - lastGc > 60 * 60_000) {
      try { await collectGarbage(api, { signal }); } catch { log(null, 'GC_DEFERRED'); }
      lastGc = Date.now();
    }
    const job = await api.rpc('claim_product_video_job', {}, signal);
    if (job) await processJob(api, job, { signal, ffmpeg: process.env.FFMPEG_PATH || 'ffmpeg', ffprobe: process.env.FFPROBE_PATH || 'ffprobe' });
    if (process.argv.includes('--once')) break;
    if (!job) await delay(5000, undefined, { signal }).catch(() => {});
  } while (!signal.aborted);
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main().catch(error => { console.error(JSON.stringify({ code: safeCode(error) })); process.exitCode = 1; });
