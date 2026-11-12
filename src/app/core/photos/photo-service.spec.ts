import { TestBed } from '@angular/core/testing';
import { InMemoryInventoryRepository } from '../inventory/in-memory-inventory-repository';
import { InventoryRepository } from '../inventory/inventory-repository';
import { InventoryStore } from '../inventory/inventory-store';
import { IMAGE_RESIZER, fitWithin } from './image-resizer';
import { PhotoService } from './photo-service';

/** Caché del navegador simulada: guarda las respuestas por clave. */
function fakeCaches() {
  const entries = new Map<string, Blob>();
  const cache = {
    match: async (key: string) => (entries.has(key) ? new Response(entries.get(key)) : undefined),
    put: async (key: string, response: Response) => void entries.set(key, await response.blob()),
    delete: async (key: string) => entries.delete(key),
  };
  // El entorno de pruebas mezcla dos implementaciones de Blob y su Response
  // no conserva el contenido; basta una que devuelva lo que recibió.
  vi.stubGlobal(
    'Response',
    class {
      constructor(private readonly body: Blob) {}
      blob = async () => this.body;
    },
  );
  vi.stubGlobal('caches', {
    open: async () => cache,
    delete: async () => (entries.clear(), true),
  });
  return entries;
}

async function setup() {
  const repository = new InMemoryInventoryRepository();
  const resize = vi.fn(async (image: Blob) => new Blob([`reducida:${await image.text()}`]));
  TestBed.configureTestingModule({
    providers: [
      { provide: InventoryRepository, useValue: repository },
      { provide: IMAGE_RESIZER, useValue: resize },
    ],
  });
  const store = TestBed.inject(InventoryStore);
  await store.load();
  const item = await store.addItem({ name: 'Taladro' });
  return { photos: TestBed.inject(PhotoService), store, repository, resize, item };
}

describe('PhotoService', () => {
  let cached: Map<string, Blob>;
  let created: Blob[];

  beforeEach(() => {
    cached = fakeCaches();
    created = [];
    vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
      created.push(blob as Blob);
      return `blob:foto-${created.length}`;
    });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('reduce la imagen, la sube y la asocia a la entidad', async () => {
    const { photos, store, repository, item } = await setup();

    await photos.attach(item.id, new Blob(['original']));

    const photoId = store.get(item.id)?.photoId as string;
    expect(photoId).toBeTruthy();
    expect(await (await repository.downloadPhoto(photoId)).text()).toBe('reducida:original');
  });

  it('muestra la foto recién subida sin volver a descargarla', async () => {
    const { photos, store, repository, item } = await setup();
    const download = vi.spyOn(repository, 'downloadPhoto');
    await photos.attach(item.id, new Blob(['original']));

    const url = await photos.objectUrl(store.get(item.id)?.photoId as string);

    expect(url).toBe('blob:foto-1');
    expect(download).not.toHaveBeenCalled();
  });

  it('descarga una foto una sola vez y después la sirve desde la caché del dispositivo', async () => {
    const first = await setup();
    const photoId = await first.repository.uploadPhoto(first.item.id, new Blob(['de otro móvil']));
    const download = vi.spyOn(first.repository, 'downloadPhoto');

    await first.photos.objectUrl(photoId);
    await first.photos.objectUrl(photoId);
    expect(download).toHaveBeenCalledTimes(1);
    expect(cached.size).toBe(1);

    // Al reabrir la aplicación la memoria está vacía, pero la caché no.
    const reopened = TestBed.runInInjectionContext(() => new PhotoService());
    await reopened.objectUrl(photoId);
    expect(download).toHaveBeenCalledTimes(1);
    expect(await created.at(-1)?.text()).toBe('de otro móvil');
  });

  it('al cambiar de foto borra la anterior de Drive y de la caché', async () => {
    const { photos, store, repository, item } = await setup();
    await photos.attach(item.id, new Blob(['primera']));
    const first = store.get(item.id)?.photoId as string;

    await photos.attach(item.id, new Blob(['segunda']));

    const second = store.get(item.id)?.photoId as string;
    expect(second).not.toBe(first);
    await expect(repository.downloadPhoto(first)).rejects.toThrow('not_found');
    expect([...cached.keys()]).toEqual([`/__fotos__/${second}`]);
  });

  it('al quitar la foto la desvincula y la borra', async () => {
    const { photos, store, repository, item } = await setup();
    await photos.attach(item.id, new Blob(['original']));
    const photoId = store.get(item.id)?.photoId as string;

    await photos.detach(item.id);

    expect(store.get(item.id)?.photoId).toBeNull();
    await expect(repository.downloadPhoto(photoId)).rejects.toThrow('not_found');
    expect(cached.size).toBe(0);
  });

  it('no deja el archivo suelto si no se puede asociar a la entidad', async () => {
    const { photos, store, repository, item } = await setup();
    const remove = vi.spyOn(repository, 'deletePhoto');
    vi.spyOn(repository, 'updateEntity').mockRejectedValueOnce(new Error('sin red'));

    await expect(photos.attach(item.id, new Blob(['original']))).rejects.toThrow('sin red');

    expect(store.get(item.id)?.photoId).toBeNull();
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('rechaza los archivos que no son imágenes sin subir nada', async () => {
    const { photos, repository, resize, item } = await setup();
    const upload = vi.spyOn(repository, 'uploadPhoto');
    resize.mockRejectedValueOnce(new Error('no decodificable'));

    await expect(photos.attach(item.id, new Blob(['texto']))).rejects.toThrow('invalid_image');
    expect(upload).not.toHaveBeenCalled();
  });

  it('funciona sin caché del navegador, descargando cuando haga falta', async () => {
    vi.stubGlobal('caches', undefined);
    const { photos, repository, item } = await setup();
    const photoId = await repository.uploadPhoto(item.id, new Blob(['x']));
    expect(await photos.objectUrl(photoId)).toBe('blob:foto-1');
  });

  it('permite reintentar una descarga fallida', async () => {
    const { photos, repository, item } = await setup();
    const photoId = await repository.uploadPhoto(item.id, new Blob(['x']));
    vi.spyOn(repository, 'downloadPhoto').mockRejectedValueOnce(new Error('sin red'));

    await expect(photos.objectUrl(photoId)).rejects.toThrow('sin red');
    expect(await photos.objectUrl(photoId)).toBe('blob:foto-1');
  });

  it('al eliminar definitivamente una entidad se borra también su foto', async () => {
    const { photos, store, repository, item } = await setup();
    await photos.attach(item.id, new Blob(['original']));
    const photoId = store.get(item.id)?.photoId as string;
    await store.remove(item.id);

    await store.purge(item.id);

    await expect(repository.downloadPhoto(photoId)).rejects.toThrow('not_found');
  });

  it('vacía la caché del dispositivo al cerrar sesión', async () => {
    const { photos, store, item } = await setup();
    await photos.attach(item.id, new Blob(['original']));
    expect(cached.size).toBe(1);

    await photos.clearCache();

    expect(cached.size).toBe(0);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:foto-1');
    expect(store.get(item.id)?.photoId).toBeTruthy(); // la foto sigue en Drive
  });
});

describe('fitWithin', () => {
  it('reduce al lado máximo conservando la proporción', () => {
    expect(fitWithin(4000, 3000, 1600)).toEqual({ width: 1600, height: 1200 });
    expect(fitWithin(3000, 4000, 1600)).toEqual({ width: 1200, height: 1600 });
  });

  it('no amplía las imágenes pequeñas', () => {
    expect(fitWithin(800, 600, 1600)).toEqual({ width: 800, height: 600 });
  });
});
