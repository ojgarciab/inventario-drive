// Lectura y escritura mínimas de archivos ZIP, suficientes para las copias de
// seguridad. Se escribe sin compresión: el contenido son JPEG, que ya están
// comprimidos. Se leen también los ZIP comprimidos con «deflate», por si la
// copia se ha vuelto a empaquetar con otra herramienta.

export interface ZipEntry {
  name: string;
  data: Uint8Array;
}

const LOCAL_SIGNATURE = 0x04034b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const END_SIGNATURE = 0x06054b50;
const UTF8_FLAG = 0x0800;
const STORED = 0;
const DEFLATED = 8;
const MAX_ENTRIES = 0xffff;
const MAX_SIZE = 0xffffffff;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

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
  for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** Empaqueta los archivos en un ZIP sin compresión. */
export function createZip(entries: ZipEntry[], date = new Date()): Uint8Array {
  if (entries.length > MAX_ENTRIES) throw new Error('Demasiados archivos para un ZIP');
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
  const day =
    ((Math.max(1980, date.getFullYear()) - 1980) << 9) |
    ((date.getMonth() + 1) << 5) |
    date.getDate();

  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const crc = crc32(entry.data);
    const size = entry.data.length;

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, LOCAL_SIGNATURE, true);
    local.setUint16(4, 20, true); // versión necesaria
    local.setUint16(6, UTF8_FLAG, true);
    local.setUint16(8, STORED, true);
    local.setUint16(10, time, true);
    local.setUint16(12, day, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, size, true);
    local.setUint32(22, size, true);
    local.setUint16(26, name.length, true);

    const header = new DataView(new ArrayBuffer(46));
    header.setUint32(0, CENTRAL_SIGNATURE, true);
    header.setUint16(4, 20, true); // versión que lo creó
    header.setUint16(6, 20, true);
    header.setUint16(8, UTF8_FLAG, true);
    header.setUint16(10, STORED, true);
    header.setUint16(12, time, true);
    header.setUint16(14, day, true);
    header.setUint32(16, crc, true);
    header.setUint32(20, size, true);
    header.setUint32(24, size, true);
    header.setUint16(28, name.length, true);
    header.setUint32(42, offset, true);

    chunks.push(new Uint8Array(local.buffer), name, entry.data);
    central.push(new Uint8Array(header.buffer), name);
    offset += 30 + name.length + size;
  }

  const centralSize = central.reduce((total, chunk) => total + chunk.length, 0);
  if (offset + centralSize > MAX_SIZE)
    throw new Error('La copia supera el tamaño máximo de un ZIP');

  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, END_SIGNATURE, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);

  return concat([...chunks, ...central, new Uint8Array(end.buffer)]);
}

/** Devuelve los archivos de un ZIP, por nombre. */
export async function readZip(zip: Uint8Array): Promise<Map<string, Uint8Array>> {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  // El final del directorio está en los últimos bytes, antes de un comentario opcional.
  let end = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 0xffff); i--) {
    if (view.getUint32(i, true) === END_SIGNATURE) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error('El archivo no es un ZIP válido');

  const count = view.getUint16(end + 10, true);
  let pointer = view.getUint32(end + 16, true);
  const files = new Map<string, Uint8Array>();

  for (let i = 0; i < count; i++) {
    if (view.getUint32(pointer, true) !== CENTRAL_SIGNATURE) throw new Error('ZIP dañado');
    const method = view.getUint16(pointer + 10, true);
    const compressedSize = view.getUint32(pointer + 20, true);
    const nameLength = view.getUint16(pointer + 28, true);
    const extraLength = view.getUint16(pointer + 30, true);
    const commentLength = view.getUint16(pointer + 32, true);
    const localOffset = view.getUint32(pointer + 42, true);
    const name = decoder.decode(zip.subarray(pointer + 46, pointer + 46 + nameLength));
    pointer += 46 + nameLength + extraLength + commentLength;

    if (name.endsWith('/')) continue; // carpeta
    if (view.getUint32(localOffset, true) !== LOCAL_SIGNATURE) throw new Error('ZIP dañado');
    const start =
      localOffset +
      30 +
      view.getUint16(localOffset + 26, true) +
      view.getUint16(localOffset + 28, true);
    const raw = zip.subarray(start, start + compressedSize);

    if (method === STORED) files.set(name, raw);
    else if (method === DEFLATED) files.set(name, await inflate(raw));
    else throw new Error(`El ZIP usa una compresión no admitida (${method})`);
  }
  return files;
}

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}
