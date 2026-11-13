import { TestBed } from '@angular/core/testing';
import { InMemoryInventoryRepository } from '../inventory/in-memory-inventory-repository';
import { InventoryRepository } from '../inventory/inventory-repository';
import { InventoryStore } from '../inventory/inventory-store';
import { Container } from '../inventory/models';
import { IMAGE_RESIZER, IMAGE_ROTATOR } from '../photos/image-resizer';
import { PhotoService } from '../photos/photo-service';
import { BackupService } from './backup-service';
import { readZip } from './zip';

async function setup() {
  TestBed.resetTestingModule();
  const repository = new InMemoryInventoryRepository();
  TestBed.configureTestingModule({
    providers: [
      { provide: InventoryRepository, useValue: repository },
      { provide: IMAGE_RESIZER, useValue: async (image: Blob) => image },
      {
        provide: IMAGE_ROTATOR,
        useValue: async (image: Blob, turns: number) =>
          new Blob([`GIRADA${turns}:${await image.text()}`]),
      },
    ],
  });
  const store = TestBed.inject(InventoryStore);
  await store.load();
  return {
    store,
    repository,
    photos: TestBed.inject(PhotoService),
    backups: TestBed.inject(BackupService),
  };
}

/** casa > caja (con foto) > pilas (con foto) ; llaves ; en la papelera: roto */
async function populate({ store, photos }: Awaited<ReturnType<typeof setup>>) {
  const typeId = (name: string) => store.types().find((t) => t.name === name)?.id ?? null;
  const estanteria = await store.addType({ name: 'Estantería', icon: 'shelves' });
  const casa = await store.addContainer({ name: 'Casa', typeId: typeId('Casa') });
  const mueble = await store.addContainer({
    name: 'Mueble',
    typeId: estanteria.id,
    parentId: casa.id,
  });
  const caja = await store.addContainer({
    name: 'Caja',
    typeId: typeId('Caja'),
    parentId: mueble.id,
    notes: 'Marcada',
    tags: ['navidad'],
  });
  const pilas = await store.addItem({ name: 'Pilas', parentId: caja.id, quantity: 4 });
  await store.addItem({ name: 'Llaves' });
  const roto = await store.addItem({ name: 'Roto', parentId: caja.id });
  await store.remove(roto.id);
  await photos.attach(caja.id, new Blob(['FOTO-CAJA']));
  // La caja tiene dos fotos y la destacada no es la primera.
  const tapa = await photos.attach(caja.id, new Blob(['FOTO-TAPA']));
  await photos.feature(caja.id, tapa.id);
  await photos.attach(pilas.id, new Blob(['FOTO-PILAS']));
  return { casa, mueble, caja, pilas };
}

const tree = (store: InventoryStore, parentId: string | null = null, depth = 0): string[] =>
  store
    .children(parentId)
    .flatMap((entity) => [
      `${'  '.repeat(depth)}${entity.name}` +
        (entity.kind === 'container'
          ? ` [${store.typeOf(entity as Container)?.name ?? '-'}]`
          : ` x${entity.quantity}`),
      ...tree(store, entity.id, depth + 1),
    ]);

const text = async (blob: Blob) => new TextDecoder().decode(await blob.arrayBuffer());

describe('BackupService', () => {
  beforeEach(() => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:x');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it('exporta en JSON todos los datos, incluida la papelera', async () => {
    const app = await setup();
    await populate(app);

    const backup = JSON.parse(await text(app.backups.exportJson()));

    expect(backup.format).toBe('inventario-hogar');
    expect(backup.version).toBe(1);
    expect(backup.types.map((t: { name: string }) => t.name)).toEqual([
      'Casa',
      'Habitación',
      'Armario',
      'Caja',
      'Estantería',
    ]);
    expect(backup.entities.map((e: { name: string }) => e.name).sort()).toEqual([
      'Caja',
      'Casa',
      'Llaves',
      'Mueble',
      'Pilas',
      'Roto',
    ]);
    const roto = backup.entities.find((e: { name: string }) => e.name === 'Roto');
    expect(roto.deletedAt).toBeTruthy();
  });

  it('exporta en ZIP los datos y todas las fotografías, informando del avance', async () => {
    const app = await setup();
    const { caja, pilas } = await populate(app);
    const progress: [number, number][] = [];

    const zip = await app.backups.exportZip((done, total) => progress.push([done, total]));
    const files = await readZip(new Uint8Array(await zip.arrayBuffer()));

    const [cajaPhoto, tapaPhoto] = app.store.photosOf(caja.id).map((photo) => photo.id);
    const pilasPhoto = app.store.get(pilas.id)?.photoId;
    expect([...files.keys()].sort()).toEqual(
      [
        'inventario.json',
        `fotos/${cajaPhoto}.jpg`,
        `fotos/${tapaPhoto}.jpg`,
        `fotos/${pilasPhoto}.jpg`,
      ].sort(),
    );
    expect(new TextDecoder().decode(files.get(`fotos/${cajaPhoto}.jpg`))).toBe('FOTO-CAJA');
    expect(new TextDecoder().decode(files.get(`fotos/${tapaPhoto}.jpg`))).toBe('FOTO-TAPA');
    expect(JSON.parse(new TextDecoder().decode(files.get('inventario.json'))).entities.length).toBe(
      6,
    );
    expect(progress).toEqual([
      [0, 3],
      [1, 3],
      [2, 3],
      [3, 3],
    ]);
  });

  it('exporta las fotos giradas ya con su giro aplicado, y al restaurarlas no hay que girarlas', async () => {
    const source = await setup();
    const { caja } = await populate(source);
    const photoId = source.store.featuredPhotoId(caja.id) as string;
    const original = await text(await source.photos.blob(photoId));
    await source.photos.rotate(caja.id, photoId, 1);

    const zip = await source.backups.exportZip();
    const files = await readZip(new Uint8Array(await zip.arrayBuffer()));
    expect(new TextDecoder().decode(files.get(`fotos/${photoId}.jpg`))).toBe(`GIRADA1:${original}`);

    const target = await setup();
    await target.backups.import(await target.backups.read(zip));
    const restored = target.store.search('caja')[0];
    const photo = target.store.photosOf(restored.id).find((p) => p.id === restored.photoId);
    expect(photo?.rotation).toBe(0);
    expect(await text(await target.photos.blob(photo?.id as string))).toBe(`GIRADA1:${original}`);
  });

  it('no da por buena una copia si falta alguna fotografía', async () => {
    const app = await setup();
    await populate(app);
    vi.spyOn(app.photos, 'blob').mockRejectedValue(new Error('sin red'));
    await expect(app.backups.exportZip()).rejects.toThrow('sin red');
  });

  it('restaura una copia ZIP en un inventario vacío: estructura, tipos y fotos', async () => {
    const source = await setup();
    await populate(source);
    const zip = await source.backups.exportZip();
    const expected = tree(source.store);

    const target = await setup();
    const loaded = await target.backups.read(zip);
    expect(loaded.summary).toEqual({ containers: 3, items: 2, photos: 3 });

    const progress: [number, number][] = [];
    const result = await target.backups.import(loaded, (done, total) =>
      progress.push([done, total]),
    );

    expect(result).toEqual({ containers: 3, items: 2, photos: 3, failedPhotos: 0 });
    expect(tree(target.store)).toEqual(expected);
    expect(expected).toEqual([
      'Casa [Casa]',
      '  Mueble [Estantería]',
      '    Caja [Caja]',
      '      Pilas x4',
      'Llaves x1',
    ]);
    // Los tipos por defecto se reutilizan; solo se crea el que faltaba.
    expect(target.store.types().map((t) => t.name)).toEqual([
      'Casa',
      'Habitación',
      'Armario',
      'Caja',
      'Estantería',
    ]);
    const caja = target.store.search('caja')[0];
    expect(caja).toMatchObject({ notes: 'Marcada', tags: ['navidad'] });
    // La galería vuelve entera y con la misma foto destacada.
    const gallery = target.store.photosOf(caja.id);
    expect(
      await Promise.all(gallery.map(async (p) => text(await target.photos.blob(p.id)))),
    ).toEqual(['FOTO-CAJA', 'FOTO-TAPA']);
    expect(await text(await target.photos.blob(caja.photoId as string))).toBe('FOTO-TAPA');
    expect(target.store.trash()).toEqual([]); // la papelera de la copia no se restaura
    expect(progress.at(0)).toEqual([0, 8]);
    expect(progress.at(-1)).toEqual([8, 8]);
  });

  it('importar un JSON añade sin tocar lo existente y sin fotos', async () => {
    const source = await setup();
    await populate(source);
    const json = source.backups.exportJson();

    const target = await setup();
    const propio = await target.store.addItem({ name: 'Propio' });
    const loaded = await target.backups.read(json);
    expect(loaded.summary.photos).toBe(0);

    await target.backups.import(loaded);

    expect(target.store.get(propio.id)?.name).toBe('Propio');
    expect(target.store.counts()).toEqual({ containers: 3, items: 3 });
    expect(target.store.search('pilas')[0].photoId).toBeNull();
  });

  it('sitúa en el inicio lo que colgaba de algo que no está en la copia y rompe los ciclos', async () => {
    const app = await setup();
    const loaded = await app.backups.read(
      new Blob([
        JSON.stringify({
          format: 'inventario-hogar',
          version: 1,
          types: [],
          entities: [
            { id: 'a', kind: 'container', name: 'A', parentId: 'b' },
            { id: 'b', kind: 'container', name: 'B', parentId: 'a' },
            { id: 'h', kind: 'container', name: 'Hija', parentId: 'p' },
            { id: 'p', kind: 'container', name: 'Padre', parentId: 'no-esta' },
            { id: 'o', kind: 'item', name: 'Suelto', parentId: 'borrado' },
            { id: 'borrado', kind: 'container', name: 'Borrado', deletedAt: '2026-01-01' },
          ],
        }),
      ]),
    );

    await app.backups.import(loaded);

    // El ciclo A ↔ B se rompe: el primero va al inicio y el otro queda dentro.
    expect(tree(app.store)).toEqual(['A [-]', '  B [-]', 'Padre [-]', '  Hija [-]', 'Suelto x1']);
  });

  it('si una foto no se puede subir, importa el resto y lo indica', async () => {
    const source = await setup();
    await populate(source);
    const zip = await source.backups.exportZip();

    const target = await setup();
    const upload = vi.spyOn(target.repository, 'uploadPhoto');
    upload.mockRejectedValueOnce(new Error('sin red'));
    const result = await target.backups.import(await target.backups.read(zip));

    expect(result).toMatchObject({ containers: 3, items: 2, photos: 2, failedPhotos: 1 });
  });

  it('rechaza archivos que no son una copia', async () => {
    const app = await setup();
    await expect(app.backups.read(new Blob(['hola']))).rejects.toThrow('no contiene una copia');
    await expect(app.backups.read(new Blob(['PK\u0003\u0004 roto']))).rejects.toThrow(
      'No se ha podido leer el archivo ZIP',
    );
  });
});
