import { TestBed } from '@angular/core/testing';
import { PhotoService } from '../core/photos/photo-service';
import { setupApp } from '../testing';

describe('EntityThumb', () => {
  async function setup() {
    const app = await setupApp();
    const photos = TestBed.inject(PhotoService);
    const objectUrl = vi
      .spyOn(photos, 'objectUrl')
      .mockImplementation(async (id, rotation = 0) => `blob:${id}@${rotation}`);
    /** Añade una foto a la galería de una entidad, como si ya la tuviera. */
    const addPhoto = async (entityId: string) => {
      const photo = await app.repository.uploadPhoto(entityId, new Blob(['x']));
      app.store.photoAdded(photo);
      return photo;
    };
    const thumbs = (el: HTMLElement) =>
      [...el.querySelectorAll('.entity-row')].map(
        (row) => row.querySelector('app-entity-thumb img')?.getAttribute('src') ?? null,
      );
    return { ...app, objectUrl, addPhoto, thumbs };
  }

  afterEach(() => vi.restoreAllMocks());

  it('muestra en cada fila la foto destacada, y nada en las que no tienen', async () => {
    const { open, settle, store, addPhoto, thumbs, objectUrl } = await setup();
    const caja = await store.addContainer({ name: 'Caja', typeId: null });
    await store.addItem({ name: 'Sin foto' });
    await addPhoto(caja.id);
    const destacada = await addPhoto(caja.id);
    await store.update(caja.id, { photoId: destacada.id });

    const el = await open('/');
    await settle();

    expect(thumbs(el)).toEqual([`blob:${destacada.id}@0`, null]);
    expect(objectUrl).toHaveBeenCalledTimes(1); // solo se descarga la destacada
    const empty = el.querySelectorAll('app-entity-thumb')[1];
    expect(empty.classList.contains('empty')).toBe(true);
  });

  it('cambia cuando se destaca otra foto o se quita', async () => {
    const { open, settle, store, addPhoto, thumbs } = await setup();
    const item = await store.addItem({ name: 'Taladro' });
    const first = await addPhoto(item.id);
    const second = await addPhoto(item.id);
    const el = await open('/');
    await settle();
    expect(thumbs(el)).toEqual([`blob:${first.id}@0`]);

    await store.update(item.id, { photoId: second.id });
    await settle();
    expect(thumbs(el)).toEqual([`blob:${second.id}@0`]);

    store.photoRemoved(first.id);
    store.photoRemoved(second.id);
    await settle();
    expect(thumbs(el)).toEqual([null]);
  });

  it('aparece también en los resultados de la búsqueda', async () => {
    const { open, settle, store, addPhoto, thumbs } = await setup();
    const item = await store.addItem({ name: 'Taladro' });
    const photo = await addPhoto(item.id);

    const el = await open('/buscar?q=taladro');
    await settle();

    expect(thumbs(el)).toEqual([`blob:${photo.id}@0`]);
  });

  it('si la foto no se puede cargar la fila se queda sin miniatura', async () => {
    const { open, settle, store, addPhoto, thumbs, objectUrl } = await setup();
    const item = await store.addItem({ name: 'Taladro' });
    await addPhoto(item.id);
    objectUrl.mockRejectedValue(new Error('sin red'));

    const el = await open('/');
    await settle();

    expect(thumbs(el)).toEqual([null]);
  });
});
