import type { WorldMeta, WorldSnapshot } from '../sim/save/worldSave';

/**
 * Save file container:
 *   "CRDYSAVE" | u16 container version | u16 section count
 *   per section: u8 name length, name (ASCII), u8 compression (0 none, 1 deflate),
 *                u32 raw length, u32 stored length, u32 CRC-32 of the raw bytes
 *   section payloads, in order
 *   u32 CRC-32 of everything above
 * All integers little-endian. Any mismatch makes the file unreadable rather than half-loaded.
 */

const MAGIC = 'CRDYSAVE';
export const CONTAINER_VERSION = 1;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) crc = CRC_TABLE[(crc ^ data[i]!) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

async function pipe(data: Uint8Array, stream: TransformStream<Uint8Array, Uint8Array>): Promise<Uint8Array> {
  const out = await new Response(new Blob([data as BlobPart]).stream().pipeThrough(stream)).arrayBuffer();
  return new Uint8Array(out);
}

const deflate = (data: Uint8Array) =>
  pipe(data, new CompressionStream('deflate-raw') as TransformStream<Uint8Array, Uint8Array>);
const inflate = (data: Uint8Array) =>
  pipe(data, new DecompressionStream('deflate-raw') as TransformStream<Uint8Array, Uint8Array>);

export class SaveFormatError extends Error {}

interface Section {
  name: string;
  raw: Uint8Array;
}

export async function encodeSections(sections: readonly Section[]): Promise<Uint8Array> {
  const stored = await Promise.all(sections.map((s) => deflate(s.raw)));
  let headerLength = 8 + 2 + 2;
  for (const s of sections) headerLength += 1 + s.name.length + 1 + 12;
  const total = headerLength + stored.reduce((n, d) => n + d.byteLength, 0) + 4;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  for (let i = 0; i < MAGIC.length; i++) out[i] = MAGIC.charCodeAt(i);
  view.setUint16(8, CONTAINER_VERSION, true);
  view.setUint16(10, sections.length, true);
  let o = 12;
  sections.forEach((s, k) => {
    out[o++] = s.name.length;
    for (let i = 0; i < s.name.length; i++) out[o++] = s.name.charCodeAt(i);
    out[o++] = 1;
    view.setUint32(o, s.raw.byteLength, true);
    view.setUint32(o + 4, stored[k]!.byteLength, true);
    view.setUint32(o + 8, crc32(s.raw), true);
    o += 12;
  });
  for (const d of stored) {
    out.set(d, o);
    o += d.byteLength;
  }
  view.setUint32(o, crc32(out.subarray(0, o)), true);
  return out;
}

export async function decodeSections(
  data: Uint8Array,
  only?: readonly string[],
): Promise<Map<string, Uint8Array>> {
  if (data.byteLength < 16) throw new SaveFormatError('The save file is empty or cut short.');
  for (let i = 0; i < MAGIC.length; i++) {
    if (data[i] !== MAGIC.charCodeAt(i)) throw new SaveFormatError('This is not a Corduroy save file.');
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const end = data.byteLength - 4;
  if (crc32(data.subarray(0, end)) !== view.getUint32(end, true)) {
    throw new SaveFormatError('The save file is damaged (checksum mismatch).');
  }
  const version = view.getUint16(8, true);
  if (version !== CONTAINER_VERSION)
    throw new SaveFormatError(`Unsupported save container version ${version}.`);
  const count = view.getUint16(10, true);
  let o = 12;
  const entries: { name: string; compression: number; raw: number; stored: number; crc: number }[] = [];
  for (let k = 0; k < count; k++) {
    const length = data[o++]!;
    let name = '';
    for (let i = 0; i < length; i++) name += String.fromCharCode(data[o++]!);
    const compression = data[o++]!;
    entries.push({
      name,
      compression,
      raw: view.getUint32(o, true),
      stored: view.getUint32(o + 4, true),
      crc: view.getUint32(o + 8, true),
    });
    o += 12;
  }
  const sections = new Map<string, Uint8Array>();
  for (const entry of entries) {
    if (o + entry.stored > end) throw new SaveFormatError('The save file is cut short.');
    const stored = data.subarray(o, o + entry.stored);
    o += entry.stored;
    if (only && !only.includes(entry.name)) continue;
    const raw = entry.compression === 1 ? await inflate(stored) : stored.slice();
    if (raw.byteLength !== entry.raw || crc32(raw) !== entry.crc) {
      throw new SaveFormatError(`The save file is damaged (section "${entry.name}").`);
    }
    sections.set(entry.name, raw);
  }
  if (o !== end) throw new SaveFormatError('The save file has unexpected trailing data.');
  return sections;
}

/** What the start menu shows about a save without loading the whole world. */
export interface SaveSummary {
  savedAt: string;
  mode: WorldMeta['mode'];
  money: number | null;
  machines: number;
  playSeconds: number;
}

interface SaveHeader extends SaveSummary {
  format: 'corduroy';
  world: WorldMeta;
}

export async function encodeSave(snapshot: WorldSnapshot, summary: SaveSummary): Promise<Uint8Array> {
  const header: SaveHeader = { format: 'corduroy', ...summary, world: snapshot.meta };
  return encodeSections([
    { name: 'meta', raw: new TextEncoder().encode(JSON.stringify(header)) },
    { name: 'cells', raw: snapshot.cells },
    { name: 'surface', raw: snapshot.surface },
    { name: 'coarse', raw: snapshot.coarse },
  ]);
}

function parseHeader(bytes: Uint8Array | undefined): SaveHeader {
  if (!bytes) throw new SaveFormatError('The save file has no metadata.');
  const header = JSON.parse(new TextDecoder().decode(bytes)) as SaveHeader;
  if (header.format !== 'corduroy') throw new SaveFormatError('This is not a Corduroy save file.');
  return header;
}

export async function decodeSave(
  data: Uint8Array,
): Promise<{ snapshot: WorldSnapshot; summary: SaveSummary }> {
  const sections = await decodeSections(data);
  const header = parseHeader(sections.get('meta'));
  const need = (name: string): Uint8Array => {
    const section = sections.get(name);
    if (!section) throw new SaveFormatError(`The save file is missing its ${name} data.`);
    return section;
  };
  const { world, format, ...summary } = header;
  return {
    snapshot: { meta: world, cells: need('cells'), surface: need('surface'), coarse: need('coarse') },
    summary,
  };
}

/** Reads only the summary of a save (the whole file is still checksummed). */
export async function readSummary(data: Uint8Array): Promise<SaveSummary> {
  const sections = await decodeSections(data, ['meta']);
  const { world, format, ...summary } = parseHeader(sections.get('meta'));
  return summary;
}
