import { createReadStream, createWriteStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { INPUT_MAX, MediaError } from './transcode.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function canonicalJob(job) {
  if (!job || !UUID.test(job.id) || !UUID.test(job.user_id) || !UUID.test(job.lease_id) || !Number.isSafeInteger(Number(job.input_size)) || Number(job.input_size) < 1 || Number(job.input_size) > INPUT_MAX) throw new MediaError('INVALID_JOB');
  const input = `${job.user_id}/${job.id}/source`;
  const output = `${job.user_id}/processed/${job.id}.mp4`;
  if (job.input_path !== input || job.output_path !== output || !['video/mp4','video/webm','video/quicktime'].includes(job.mime)) throw new MediaError('INVALID_JOB');
  return { input, output, thumb: output.replace(/\.mp4$/, '_thumb.jpg') };
}

export function createApi({ url, key, fetcher = fetch }) {
  const base = new URL(url);
  if (base.protocol !== 'https:' || base.username || base.password || base.pathname !== '/' || base.search || base.hash || !key) throw new MediaError('INVALID_CONFIGURATION');
  const origin = base.origin;
  const headers = { apikey: key, Authorization: `Bearer ${key}` };
  function endpoint(path) { return `${origin}${path}`; }
  async function request(path, init = {}, signal, timeout = 30_000) {
    try {
      return await fetcher(endpoint(path), { ...init, headers: { ...headers, ...init.headers }, redirect: 'error', signal: AbortSignal.any([AbortSignal.timeout(timeout), ...(signal ? [signal] : [])]) });
    } catch { throw new MediaError('NETWORK_ERROR'); }
  }
  async function jsonResponse(response, max = 128 * 1024) {
    if (response.status === 204) return null;
    if (!response.ok) { await response.body?.cancel(); throw new MediaError(`HTTP_${response.status}`); }
    if (!response.body) throw new MediaError('INVALID_RESPONSE');
    const chunks = []; let length = 0;
    try {
      for await (const chunk of response.body) {
        length += chunk.byteLength;
        if (length > max) throw new MediaError('RESPONSE_TOO_LARGE');
        chunks.push(Buffer.from(chunk));
      }
    } catch (error) {
      if (error instanceof MediaError) throw error;
      throw new MediaError('NETWORK_ERROR');
    }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new MediaError('INVALID_RESPONSE'); }
  }
  async function rpc(name, body = {}, signal) {
    if (!/^[a-z_]+$/.test(name)) throw new MediaError('INVALID_RPC');
    return jsonResponse(await request(`/rest/v1/rpc/${name}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, signal));
  }
  const objectPath = (bucket, path) => `/storage/v1/object/${encodeURIComponent(bucket)}/${path.split('/').map(encodeURIComponent).join('/')}`;
  async function download(bucket, path, target, maxBytes, expectedBytes, signal) {
    const response = await request(objectPath(bucket, path), {}, signal, 180_000);
    if (!response.ok || !response.body) { await response.body?.cancel(); throw new MediaError(`HTTP_${response.status}`); }
    const length = response.headers.get('content-length');
    if (length && (!/^\d+$/.test(length) || Number(length) > maxBytes || (expectedBytes && Number(length) !== expectedBytes))) {
      await response.body.cancel(); throw new MediaError('INPUT_SIZE_MISMATCH');
    }
    let total = 0;
    const limiter = new Transform({ transform(chunk, _encoding, callback) {
      total += chunk.length;
      callback(total > maxBytes ? new MediaError('DOWNLOAD_SIZE_LIMIT') : null, chunk);
    } });
    try {
      await pipeline(Readable.fromWeb(response.body), limiter, createWriteStream(target, { flags: 'wx', mode: 0o600 }), { signal });
    } catch (error) {
      if (error instanceof MediaError) throw error;
      throw new MediaError(signal?.aborted ? 'PROCESS_TIMEOUT' : 'NETWORK_ERROR');
    }
    if (!total || (expectedBytes && total !== expectedBytes)) throw new MediaError('INPUT_SIZE_MISMATCH');
    return total;
  }
  async function upload(bucket, path, file, mime, signal) {
    const size = (await stat(file)).size;
    const source = createReadStream(file);
    try {
      const response = await request(objectPath(bucket, path), { method: 'POST', headers: { 'Content-Type': mime, 'Content-Length': String(size), 'Cache-Control': 'max-age=31536000', 'x-upsert': 'false' }, body: source, duplex: 'half' }, signal, 90_000);
      if (response.status === 409) { await response.body?.cancel(); return false; }
      await jsonResponse(response);
      return true;
    } finally { source.destroy(); }
  }
  async function remove(bucket, paths, signal) {
    if (!paths.length) return;
    await jsonResponse(await request(`/storage/v1/object/${encodeURIComponent(bucket)}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prefixes: paths }) }, signal));
  }
  async function job(id, signal) {
    if (!UUID.test(id)) throw new MediaError('INVALID_JOB');
    const rows = await jsonResponse(await request(`/rest/v1/media_processing_jobs?id=eq.${id}&select=*`, {}, signal));
    if (!Array.isArray(rows) || rows.length !== 1) throw new MediaError('JOB_NOT_FOUND');
    return rows[0];
  }
  async function garbage(signal) {
    await rpc('expire_product_video_jobs', {}, signal);
    const before = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const params = new URLSearchParams({ select: 'id,user_id,input_path', status: 'in.(ready,failed,cancelled)', input_deleted_at: 'is.null', created_at: `lt.${before}`, order: 'created_at.asc', limit: '100' });
    return jsonResponse(await request(`/rest/v1/media_processing_jobs?${params}`, {}, signal));
  }
  return { rpc, download, upload, remove, job, garbage, publicBaseUrl: origin };
}
