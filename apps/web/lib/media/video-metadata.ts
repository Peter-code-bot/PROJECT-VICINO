import { VIDEO_MAX_SECONDS, VIDEO_OUTPUT_MAX_BYTES } from './product-media-policy';

type Box = { type: string; data: number; end: number };
const invalid = () => new Error('El contenedor de video no es válido.');

/** Structural/timeline admission for normalized non-fragmented H264/AAC MP4.
 * Not a decoder: native AVFoundation/Media3 and the worker perform codec probes.
 */
export async function readProductVideoMetadata(file: Blob): Promise<{ duration: number }> {
  if (!file.size || file.size > VIDEO_OUTPUT_MAX_BYTES) throw new Error('El video optimizado debe pesar hasta 10 MB.');
  const b = new Uint8Array(await file.arrayBuffer()), v = new DataView(b.buffer);
  let boxCount = 0;
  const need = (at: number, length: number, end: number) => { if (at < 0 || length < 0 || at + length > end) throw invalid(); };
  const u32 = (at: number, end: number) => { need(at, 4, end); return v.getUint32(at); };
  const u64 = (at: number, end: number) => { need(at, 8, end); const n = v.getBigUint64(at); if (n > BigInt(Number.MAX_SAFE_INTEGER)) throw invalid(); return Number(n); };
  const byte = (at: number): number => { need(at, 1, b.length); return b.at(at)!; };
  const text = (at: number) => String.fromCharCode(...b.subarray(at, at + 4));
  function boxes(start: number, end: number, depth = 0): Box[] {
    if (depth > 10) throw invalid();
    const result: Box[] = [];
    for (let at = start; at < end;) {
      if (++boxCount > 10_000) throw invalid();
      need(at, 8, end); let size = u32(at, end), header = 8;
      if (size === 1) { size = u64(at + 8, end); header = 16; } else if (!size) size = end - at;
      if (size < header || size > end - at) throw invalid();
      result.push({ type: text(at + 4), data: at + header, end: at + size }); at += size;
    }
    return result;
  }
  const one = (list: Box[], type: string): Box => { const found = list.filter(x => x.type === type); if (found.length !== 1) throw invalid(); return found[0]!; };
  const children = (box: Box, depth: number) => boxes(box.data, box.end, depth);
  const full = (box: Box) => { need(box.data, 4, box.end); if (byte(box.data)) throw invalid(); };
  function timing(box: Box) {
    need(box.data, 4, box.end); const version = byte(box.data); if (version > 1) throw invalid();
    const at = box.data + (version ? 20 : 12), scale = u32(at, box.end), ticks = version ? u64(at + 4, box.end) : u32(at + 4, box.end);
    if (!scale || !ticks) throw invalid(); return { scale, ticks, seconds: ticks / scale };
  }
  // Inspect metadata regions, never compressed samples (which may contain these words).
  function metadata(list: Box[], depth: number) {
    if (depth > 10) throw invalid();
    for (const box of list) {
      // Opaque UUID/XMP payloads cannot be audited for location metadata here.
      if (box.type === 'uuid') throw invalid();
      if (['©xyz', 'loci', 'gps ', 'GPS ', 'exif', 'Exif'].includes(box.type)) throw new Error('El video contiene datos de ubicación.');
      if (['udta', 'meta'].includes(box.type)) {
        const value = new TextDecoder('latin1').decode(b.subarray(box.data, box.end)).replaceAll('\0', '').toLowerCase();
        if (/location|iso6709|\bgps\b|exif|©xyz|\bloci\b/.test(value)) throw new Error('El video contiene datos de ubicación.');
      }
      if (['moov', 'trak', 'mdia', 'minf', 'stbl', 'edts', 'dinf', 'udta'].includes(box.type)) metadata(children(box, depth + 1), depth + 1);
      if (box.type === 'meta') { full(box); metadata(boxes(box.data + 4, box.end, depth + 1), depth + 1); }
    }
  }
  const top = boxes(0, b.length); metadata(top, 0);
  if (top.some(x => ['moof', 'mfra', 'sidx'].includes(x.type))) throw invalid();
  const ftyp = one(top, 'ftyp'); need(ftyp.data, 8, ftyp.end); if ((ftyp.end - ftyp.data) % 4) throw invalid();
  const brands = [text(ftyp.data)]; for (let at = ftyp.data + 8; at < ftyp.end; at += 4) brands.push(text(at));
  if (!brands.some(x => ['isom', 'iso2', 'iso4', 'iso5', 'iso6', 'avc1', 'mp41', 'mp42', 'M4V '].includes(x))) throw invalid();
  const media = top.filter(x => x.type === 'mdat' && x.end > x.data); if (!media.length) throw invalid();
  const movie = children(one(top, 'moov'), 1); if (movie.some(x => x.type === 'mvex')) throw invalid();
  const movieTime = timing(one(movie, 'mvhd')); if (movieTime.seconds > VIDEO_MAX_SECONDS) throw invalid();
  const tracks = movie.filter(x => x.type === 'trak'); if (!tracks.length || tracks.length > 2) throw invalid();
  const sampleRanges: { start: number; end: number }[] = [];
  let videos = 0, audios = 0;
  for (const track of tracks) {
    const tk = children(track, 2), tkhd = one(tk, 'tkhd'); need(tkhd.data, 4, tkhd.end); if (byte(tkhd.data) > 1) throw invalid();
    const dimensions = tkhd.data + (byte(tkhd.data) ? 88 : 76);
    const matrix = dimensions - 36;
    need(matrix, 36, tkhd.end);
    const a = v.getInt32(matrix), angleB = v.getInt32(matrix + 4), c = v.getInt32(matrix + 12), d = v.getInt32(matrix + 16);
    const unit = (n: number) => Math.abs(n) === 65536;
    if (!((unit(a) && unit(d) && angleB === 0 && c === 0) || (a === 0 && d === 0 && unit(angleB) && unit(c))) ||
        v.getInt32(matrix + 8) !== 0 || v.getInt32(matrix + 20) !== 0 || u32(matrix + 32, tkhd.end) !== 0x40000000) throw invalid();
    const displayWidth = u32(dimensions, tkhd.end) / 65536, displayHeight = u32(dimensions + 4, tkhd.end) / 65536;
    const mdia = children(one(tk, 'mdia'), 3), time = timing(one(mdia, 'mdhd')), hdlr = one(mdia, 'hdlr'); full(hdlr); need(hdlr.data, 12, hdlr.end);
    const handler = text(hdlr.data + 8); if (handler !== 'vide' && handler !== 'soun') throw invalid();
    if (handler === 'vide') videos++; else audios++; if (videos > 1 || audios > 1) throw invalid();
    const minf = children(one(mdia, 'minf'), 4), dinf = children(one(minf, 'dinf'), 5), dref = one(dinf, 'dref'); full(dref);
    if (u32(dref.data + 4, dref.end) !== 1) throw invalid();
    const refs = boxes(dref.data + 8, dref.end, 6); if (refs.length !== 1) throw invalid(); const ref = one(refs, 'url ');
    if (ref.end - ref.data !== 4 || u32(ref.data, ref.end) !== 1) throw invalid();
    const table = children(one(minf, 'stbl'), 5), stsd = one(table, 'stsd'); full(stsd); if (u32(stsd.data + 4, stsd.end) !== 1) throw invalid();
    const entries = boxes(stsd.data + 8, stsd.end, 6); if (entries.length !== 1) throw invalid(); const entry = entries[0]!; need(entry.data, 8, entry.end);
    if (v.getUint16(entry.data + 6) !== 1) throw invalid();
    if (handler === 'vide') {
      if (!['avc1', 'avc3'].includes(entry.type)) throw invalid(); need(entry.data, 78, entry.end);
      const w = v.getUint16(entry.data + 24), h = v.getUint16(entry.data + 26);
      if (!w || !h || !displayWidth || !displayHeight || Math.max(w, h, displayWidth, displayHeight) > 1280 || Math.min(w, h) > 720 || Math.min(displayWidth, displayHeight) > 720) throw invalid();
      const avcc = one(boxes(entry.data + 78, entry.end, 7), 'avcC'); need(avcc.data, 7, avcc.end);
      if (byte(avcc.data) !== 1 || ![66, 77, 88, 100].includes(byte(avcc.data + 1)) || (byte(avcc.data + 4) & 3) === 2) throw invalid();
      let cursor = avcc.data + 6; const sps = byte(avcc.data + 5) & 31; if (!sps) throw invalid();
      const nal = (type: number) => { need(cursor, 2, avcc.end); const len = v.getUint16(cursor); cursor += 2; need(cursor, len, avcc.end); if (len < (type === 7 ? 4 : 1) || (byte(cursor) & 31) !== type || (type === 7 && byte(cursor + 1) !== byte(avcc.data + 1))) throw invalid(); cursor += len; };
      for (let i = 0; i < sps; i++) nal(7); need(cursor, 1, avcc.end); const pps = byte(cursor++); if (!pps) throw invalid(); for (let i = 0; i < pps; i++) nal(8);
    } else {
      if (entry.type !== 'mp4a') throw invalid(); need(entry.data, 28, entry.end); if (v.getUint16(entry.data + 8) !== 0) throw invalid();
      const esds = one(boxes(entry.data + 28, entry.end, 7), 'esds'); full(esds); let aac = false, config = false;
      function descriptors(start: number, end: number, depth: number) {
        if (depth > 4) throw invalid();
        for (let at = start; at < end;) {
          need(at, 2, end); const tag = byte(at++); let len = 0, finished = false;
          for (let i = 0; i < 4; i++) { need(at, 1, end); const n = byte(at++); len = len * 128 + (n & 127); if (!(n & 128)) { finished = true; break; } }
          if (!finished) throw invalid(); need(at, len, end); const limit = at + len;
          if (tag === 3) { need(at, 3, limit); const flags = byte(at + 2); let child = at + 3; if (flags & 128) child += 2; if (flags & 64) { need(child, 1, limit); child += 1 + byte(child); } if (flags & 32) child += 2; need(child, 0, limit); descriptors(child, limit, depth + 1); }
          else if (tag === 4) { need(at, 13, limit); if (byte(at) !== 0x40 || ((byte(at + 1) >> 2) & 63) !== 5) throw invalid(); aac = true; descriptors(at + 13, limit, depth + 1); }
          else if (tag === 5) { need(at, 2, limit); const frequency = ((byte(at) & 7) << 1) | (byte(at + 1) >> 7), channels = (byte(at + 1) >> 3) & 15; if (byte(at) >> 3 !== 2 || frequency > 12 || channels < 1 || channels > 7) throw invalid(); config = true; }
          at = limit;
        }
      }
      descriptors(esds.data + 4, esds.end, 0); if (!aac || !config) throw invalid();
    }
    const stsz = one(table, 'stsz'); full(stsz); const fixed = u32(stsz.data + 4, stsz.end), samples = u32(stsz.data + 8, stsz.end);
    if (!samples || samples > 10_000 || stsz.end !== stsz.data + 12 + (fixed ? 0 : samples * 4)) throw invalid();
    const sizes = Array.from({ length: samples }, (_, i) => fixed || u32(stsz.data + 12 + i * 4, stsz.end)); if (sizes.some(n => !n)) throw invalid();
    const stts = one(table, 'stts'); full(stts); const times = u32(stts.data + 4, stts.end);
    if (!times || times > samples || stts.end !== stts.data + 8 + times * 8) throw invalid(); let totalSamples = 0, ticks = 0;
    for (let i = 0; i < times; i++) { const at = stts.data + 8 + i * 8, amount = u32(at, stts.end), delta = u32(at + 4, stts.end); if (!amount || !delta) throw invalid(); totalSamples += amount; ticks += amount * delta; }
    if (!Number.isSafeInteger(ticks) || totalSamples !== samples || Math.abs(ticks - time.ticks) > 1 || (handler === 'vide' && samples / time.seconds > 30.05)) throw invalid();
    const offsetTables = table.filter(x => x.type === 'stco' || x.type === 'co64'); if (offsetTables.length !== 1) throw invalid(); const offsets = offsetTables[0]!; full(offsets);
    const chunks = u32(offsets.data + 4, offsets.end), stride = offsets.type === 'co64' ? 8 : 4; if (!chunks || chunks > samples || offsets.end !== offsets.data + 8 + chunks * stride) throw invalid();
    const stsc = one(table, 'stsc'); full(stsc); const maps = u32(stsc.data + 4, stsc.end); if (!maps || maps > chunks || stsc.end !== stsc.data + 8 + maps * 12) throw invalid();
    const mapping: { first: number; amount: number }[] = [];
    for (let i = 0; i < maps; i++) { const at = stsc.data + 8 + i * 12, first = u32(at, stsc.end), amount = u32(at + 4, stsc.end); if ((!i && first !== 1) || (i > 0 && first <= mapping[i - 1]!.first) || first > chunks || !amount || amount > samples || u32(at + 8, stsc.end) !== 1) throw invalid(); mapping.push({ first, amount }); }
    let sample = 0, map = 0;
    for (let i = 0; i < chunks; i++) { while (map + 1 < maps && mapping[map + 1]!.first <= i + 1) map++; const amount = mapping[map]!.amount; if (sample + amount > samples) throw invalid(); const size = sizes.slice(sample, sample + amount).reduce((sum, n) => sum + n, 0), at = offsets.data + 8 + i * stride, offset = stride === 8 ? u64(at, offsets.end) : u32(at, offsets.end); if (!media.some(x => offset >= x.data && size <= x.end - offset)) throw invalid(); sampleRanges.push({ start: offset, end: offset + size }); sample += amount; }
    if (sample !== samples) throw invalid();
    let playable = time.seconds; const edits = tk.filter(x => x.type === 'edts'); if (edits.length > 1) throw invalid();
    if (edits.length) {
      const elst = one(children(edits[0]!, 3), 'elst'); need(elst.data, 8, elst.end); const version = byte(elst.data); if (version > 1) throw invalid(); const entries = u32(elst.data + 4, elst.end), stride = version ? 20 : 12; if (!entries || entries > 4 || elst.end !== elst.data + 8 + entries * stride) throw invalid(); playable = 0;
      for (let i = 0; i < entries; i++) { const at = elst.data + 8 + i * stride, segment = (version ? u64(at, elst.end) : u32(at, elst.end)) / movieTime.scale, mediaAt = version ? v.getBigInt64(at + 8) : BigInt(v.getInt32(at + 4)); if (!segment || mediaAt < BigInt(-1) || mediaAt > BigInt(Number.MAX_SAFE_INTEGER) || u32(at + (version ? 16 : 8), elst.end) !== 65536) throw invalid(); if (mediaAt >= 0 && Number(mediaAt) / time.scale + segment > time.seconds + 0.1) throw invalid(); playable += segment; }
    }
    if (playable <= 0 || playable > VIDEO_MAX_SECONDS || Math.abs(playable - movieTime.seconds) > 0.15 || time.seconds > VIDEO_MAX_SECONDS + 0.25) throw new Error('El video debe durar hasta 10 segundos.');
  }
  if (videos !== 1) throw invalid();
  sampleRanges.sort((left, right) => left.start - right.start);
  if (sampleRanges.some((range, index) => index > 0 && range.start < sampleRanges[index - 1]!.end)) throw invalid();
  return { duration: movieTime.seconds };
}
