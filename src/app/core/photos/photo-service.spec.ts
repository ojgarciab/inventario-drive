import { TestBed } from '@angular/core/testing';
import { InMemoryInventoryRepository } from '../inventory/in-memory-inventory-repository';
import { InventoryRepository } from '../inventory/inventory-repository';
import { InventoryStore } from '../inventory/inventory-store';
import { IMAGE_RESIZER, IMAGE_ROTATOR, fitWithin } from './image-resizer';
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
  const rotate = vi.fn(
    async (image: Blob, turns: number) => new Blob([`girada${turns}:${await image.text()}`]),
  );
  TestBed.configureTestingModule({
    providers: [
      { provide: InventoryRepository, useValue: repository },
      { provide: IMAGE_RESIZER, useValue: resize },
      { provide: IMAGE_ROTATOR, useValue: rotate },
    ],
  });
  const store = TestBed.inject(InventoryStore);
  await store.load();
  const item = await store.addItem({ name: 'Taladro' });
  return { photos: TestBed.inject(PhotoService), store, repository, resize, rotate, item };
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
    const { id: photoId } = await first.repository.uploadPhoto(
      first.item.id,
      new Blob(['de otro móvil']),
    );
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

  it('añade más fotos a la galería sin cambiar la destacada', async () => {
    const { photos, store, repository, item } = await setup();
    const first = await photos.attach(item.id, new Blob(['primera']));

    const second = await photos.attach(item.id, new Blob(['segunda']));

    expect(store.photosOf(item.id).map((photo) => photo.id)).toEqual([first.id, second.id]);
    expect(store.get(item.id)?.photoId).toBe(first.id);
    expect(store.featuredPhotoId(item.id)).toBe(first.id);
    expect(await (await repository.downloadPhoto(first.id)).text()).toBe('reducida:primera');
    expect(cached.size).toBe(2);
  });

  it('permite elegir otra foto de la galería como destacada', async () => {
    const { photos, store, item } = await setup();
    await photos.attach(item.id, new Blob(['primera']));
    const second = await photos.attach(item.id, new Blob(['segunda']));

    await photos.feature(item.id, second.id);

    expect(store.featuredPhotoId(item.id)).toBe(second.id);
    await expect(photos.feature(item.id, 'de-otra-entidad')).rejects.toThrow('not_found');
  });

  it('ve la galería que otro dispositivo ha ido llenando', async () => {
    const { store, repository, item } = await setup();
    const remote = await repository.uploadPhoto(item.id, new Blob(['x']));
    await store.refresh();
    expect(store.photosOf(item.id)).toEqual([remote]);
    // Sin destacada elegida lo es la primera de la galería.
    expect(store.featuredPhotoId(item.id)).toBe(remote.id);

    await repository.deletePhoto(remote.id);
    await store.refresh();
    expect(store.photosOf(item.id)).toEqual([]);
    expect(store.featuredPhotoId(item.id)).toBeNull();
  });

  it('al quitar la foto destacada pasa a serlo la siguiente', async () => {
    const { photos, store, repository, item } = await setup();
    const first = await photos.attach(item.id, new Blob(['primera']));
    const second = await photos.attach(item.id, new Blob(['segunda']));

    await photos.remove(item.id, first.id);

    expect(store.get(item.id)?.photoId).toBe(second.id);
    expect(store.photosOf(item.id)).toEqual([second]);
    await expect(repository.downloadPhoto(first.id)).rejects.toThrow('not_found');
    expect([...cached.keys()]).toEqual([`/__fotos__/${second.id}`]);
  });

  it('al quitar una foto que no es la destacada no toca la entidad', async () => {
    const { photos, store, repository, item } = await setup();
    const first = await photos.attach(item.id, new Blob(['primera']));
    const second = await photos.attach(item.id, new Blob(['segunda']));
    const update = vi.spyOn(repository, 'updateEntity');

    await photos.remove(item.id, second.id);

    expect(update).not.toHaveBeenCalled();
    expect(store.featuredPhotoId(item.id)).toBe(first.id);
    expect(store.photosOf(item.id)).toEqual([first]);
  });

  it('al quitar la única foto la entidad se queda sin ninguna', async () => {
    const { photos, store, repository, item } = await setup();
    const photo = await photos.attach(item.id, new Blob(['original']));

    await photos.remove(item.id, photo.id);

    expect(store.get(item.id)?.photoId).toBeNull();
    expect(store.photosOf(item.id)).toEqual([]);
    await expect(repository.downloadPhoto(photo.id)).rejects.toThrow('not_found');
    expect(cached.size).toBe(0);
  });

  it('no deja el archivo suelto si no se puede asociar a la entidad', async () => {
    const { photos, store, repository, item } = await setup();
    const remove = vi.spyOn(repository, 'deletePhoto');
    vi.spyOn(repository, 'updateEntity').mockRejectedValueOnce(new Error('sin red'));

    await expect(photos.attach(item.id, new Blob(['original']))).rejects.toThrow('sin red');

    expect(store.get(item.id)?.photoId).toBeNull();
    expect(store.photosOf(item.id)).toEqual([]);
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
    const { id: photoId } = await repository.uploadPhoto(item.id, new Blob(['x']));
    expect(await photos.objectUrl(photoId)).toBe('blob:foto-1');
  });

  it('permite reintentar una descarga fallida', async () => {
    const { photos, repository, item } = await setup();
    const { id: photoId } = await repository.uploadPhoto(item.id, new Blob(['x']));
    vi.spyOn(repository, 'downloadPhoto').mockRejectedValueOnce(new Error('sin red'));

    await expect(photos.objectUrl(photoId)).rejects.toThrow('sin red');
    expect(await photos.objectUrl(photoId)).toBe('blob:foto-1');
  });

  it('al eliminar definitivamente una entidad se borran también sus fotos', async () => {
    const { photos, store, repository, item } = await setup();
    const first = await photos.attach(item.id, new Blob(['primera']));
    const second = await photos.attach(item.id, new Blob(['segunda']));
    await store.remove(item.id);

    await store.purge(item.id);

    await expect(repository.downloadPhoto(first.id)).rejects.toThrow('not_found');
    await expect(repository.downloadPhoto(second.id)).rejects.toThrow('not_found');
  });

  describe('girar', () => {
    it('anota el giro en los metadatos sin volver a subir ni borrar la imagen', async () => {
      const { photos, store, repository, item } = await setup();
      const original = await photos.attach(item.id, new Blob(['foto']));
      const upload = vi.spyOn(repository, 'uploadPhoto');
      const remove = vi.spyOn(repository, 'deletePhoto');

      const rotated = await photos.rotate(item.id, original.id, 1);

      expect(rotated).toEqual({ ...original, rotation: 1 });
      expect(store.photosOf(item.id)).toEqual([rotated]);
      expect(upload).not.toHaveBeenCalled();
      expect(remove).not.toHaveBeenCalled();
      // El archivo guardado sigue siendo el original, sin recomprimir.
      expect(await (await repository.downloadPhoto(original.id)).text()).toBe('reducida:foto');
    });

    it('acumula los giros y da la vuelta completa', async () => {
      const { photos, store, item } = await setup();
      const { id } = await photos.attach(item.id, new Blob(['foto']));
      const rotation = () => store.photosOf(item.id)[0].rotation;

      await photos.rotate(item.id, id, -1);
      expect(rotation()).toBe(3);
      await photos.rotate(item.id, id, -1);
      expect(rotation()).toBe(2);
      await photos.rotate(item.id, id, 1);
      await photos.rotate(item.id, id, 1);
      await photos.rotate(item.id, id, 1);
      expect(rotation()).toBe(1);
      await photos.rotate(item.id, id, -1);
      expect(rotation()).toBe(0);
    });

    it('la foto conserva su sitio en la galería y la destacada no cambia', async () => {
      const { photos, store, repository, item } = await setup();
      const first = await photos.attach(item.id, new Blob(['a']));
      const second = await photos.attach(item.id, new Blob(['b']));
      const third = await photos.attach(item.id, new Blob(['c']));
      const update = vi.spyOn(repository, 'updateEntity');

      await photos.rotate(item.id, second.id, 1);

      expect(store.photosOf(item.id).map((p) => p.id)).toEqual([first.id, second.id, third.id]);
      expect(store.featuredPhotoId(item.id)).toBe(first.id);
      expect(update).not.toHaveBeenCalled();
    });

    it('muestra la foto girada a partir de la original, sin descargarla otra vez', async () => {
      const { photos, repository, rotate, item } = await setup();
      const { id } = await photos.attach(item.id, new Blob(['foto']));
      const download = vi.spyOn(repository, 'downloadPhoto');
      await photos.rotate(item.id, id, 1);

      const normal = await photos.objectUrl(id);
      const turned = await photos.objectUrl(id, 1);
      const again = await photos.objectUrl(id, 1);

      expect(turned).not.toBe(normal);
      expect(again).toBe(turned);
      expect(await created.at(-1)?.text()).toBe('girada1:reducida:foto');
      expect(rotate).toHaveBeenCalledTimes(1); // se gira una vez y se recuerda
      expect(download).not.toHaveBeenCalled();
    });

    it('sin giro entrega el archivo tal cual, sin procesarlo', async () => {
      const { photos, rotate, item } = await setup();
      const { id } = await photos.attach(item.id, new Blob(['foto']));
      expect(await (await photos.blob(id)).text()).toBe('reducida:foto');
      expect(await (await photos.blob(id, 4)).text()).toBe('reducida:foto');
      expect(await (await photos.blob(id, 2)).text()).toBe('girada2:reducida:foto');
      expect(rotate).toHaveBeenCalledTimes(1);
    });

    it('ve el giro que ha hecho otro dispositivo', async () => {
      const { photos, store, repository, item } = await setup();
      const { id } = await photos.attach(item.id, new Blob(['foto']));

      await repository.rotatePhoto(id, 3);
      await store.refresh();

      expect(store.photosOf(item.id)[0].rotation).toBe(3);
    });

    it('si no se puede guardar el giro, la foto queda como estaba', async () => {
      const { photos, store, repository, item } = await setup();
      const { id } = await photos.attach(item.id, new Blob(['foto']));
      vi.spyOn(repository, 'rotatePhoto').mockRejectedValueOnce(new Error('sin red'));

      await expect(photos.rotate(item.id, id, 1)).rejects.toThrow('sin red');
      expect(store.photosOf(item.id)[0].rotation).toBe(0);
    });

    it('una vuelta completa no guarda nada, y no se gira una foto ajena', async () => {
      const { photos, repository, item } = await setup();
      const original = await photos.attach(item.id, new Blob(['foto']));
      const save = vi.spyOn(repository, 'rotatePhoto');

      expect(await photos.rotate(item.id, original.id, 4)).toEqual(original);
      await expect(photos.rotate(item.id, 'no-existe', 1)).rejects.toThrow('not_found');
      expect(save).not.toHaveBeenCalled();
    });

    it('al quitar una foto girada libera también sus versiones giradas', async () => {
      const { photos, item } = await setup();
      const { id } = await photos.attach(item.id, new Blob(['foto']));
      await photos.rotate(item.id, id, 1);
      const turned = await photos.objectUrl(id, 1);

      await photos.remove(item.id, id);

      expect(URL.revokeObjectURL).toHaveBeenCalledWith(turned);
    });
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
