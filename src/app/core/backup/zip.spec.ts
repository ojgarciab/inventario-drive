import { crc32, createZip, readZip } from './zip';

const bytes = (text: string) => new TextEncoder().encode(text);
const text = (data: Uint8Array | undefined) => new TextDecoder().decode(data);

describe('ZIP', () => {
  it('calcula el CRC-32 estándar', () => {
    expect(crc32(bytes('123456789'))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array())).toBe(0);
  });

  it('lee lo mismo que escribe, con nombres con acentos y contenido binario', async () => {
    const binary = Uint8Array.from({ length: 1000 }, (_, i) => (i * 7) % 256);
    const zip = createZip([
      { name: 'inventario.json', data: bytes('{"ñ":"árbol"}') },
      { name: 'fotos/caja de cartón.jpg', data: binary },
      { name: 'vacio.txt', data: new Uint8Array() },
    ]);

    const files = await readZip(zip);

    expect([...files.keys()]).toEqual(['inventario.json', 'fotos/caja de cartón.jpg', 'vacio.txt']);
    expect(text(files.get('inventario.json'))).toBe('{"ñ":"árbol"}');
    expect(files.get('fotos/caja de cartón.jpg')).toEqual(binary);
    expect(files.get('vacio.txt')?.length).toBe(0);
  });

  it('genera la estructura que esperan otros programas', () => {
    const zip = createZip([{ name: 'a.txt', data: bytes('hola') }], new Date(2026, 10, 12, 8, 30));
    const view = new DataView(zip.buffer);

    expect(view.getUint32(0, true)).toBe(0x04034b50); // cabecera local
    expect(view.getUint16(8, true)).toBe(0); // sin compresión
    expect(view.getUint32(14, true)).toBe(crc32(bytes('hola')));
    expect(view.getUint32(18, true)).toBe(4);
    const central = 30 + 5 + 4;
    expect(view.getUint32(central, true)).toBe(0x02014b50); // directorio central
    const end = zip.length - 22;
    expect(view.getUint32(end, true)).toBe(0x06054b50); // fin del directorio
    expect(view.getUint16(end + 10, true)).toBe(1);
    expect(view.getUint32(end + 16, true)).toBe(central);
  });

  it('admite un ZIP sin archivos', async () => {
    expect((await readZip(createZip([]))).size).toBe(0);
  });

  it('rechaza lo que no es un ZIP', async () => {
    await expect(readZip(bytes('esto no es un zip, solo texto corriente'))).rejects.toThrow(
      'no es un ZIP válido',
    );
    await expect(readZip(new Uint8Array(4))).rejects.toThrow('no es un ZIP válido');
  });
});
