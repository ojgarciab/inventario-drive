import { TestBed } from '@angular/core/testing';
import { PhotoService } from '../core/photos/photo-service';
import { clickOn, setupApp } from '../testing';

/** Simula que el usuario elige archivos en el selector indicado. */
function choose(el: HTMLElement, label: string, ...files: File[]): void {
  const input = el.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
  if (!input) throw new Error(`No existe el selector «${label}»`);
  Object.defineProperty(input, 'files', { value: files, configurable: true });
  input.dispatchEvent(new Event('change'));
}

const photo = new File(['imagen'], 'foto.jpg', { type: 'image/jpeg' });
const other = new File(['otra'], 'otra.jpg', { type: 'image/jpeg' });

const thumbs = (el: HTMLElement) => [...el.querySelectorAll<HTMLButtonElement>('.gallery .thumb')];
const mainSrc = (el: HTMLElement) => el.querySelector('.frame img')?.getAttribute('src');

describe('EntityPhoto', () => {
  async function setup() {
    const app = await setupApp();
    const photos = TestBed.inject(PhotoService);
    vi.spyOn(photos, 'objectUrl').mockImplementation(async (id) => `blob:${id}`);
    // Como el servicio real, pero sin reducir la imagen ni tocar la caché.
    vi.spyOn(photos, 'attach').mockImplementation(async (entityId, image) => {
      const added = await app.repository.uploadPhoto(entityId, image);
      if (!app.store.featuredPhotoId(entityId)) {
        await app.store.update(entityId, { photoId: added.id });
      }
      app.store.photoAdded(added);
      return added;
    });
    vi.spyOn(photos, 'remove');
    vi.spyOn(photos, 'feature');
    /** Añade fotos a la galería de una entidad, como si ya las tuviera. */
    const addPhotos = async (entityId: string, count: number) => {
      const added = [];
      for (let i = 0; i < count; i++) added.push(await photos.attach(entityId, new Blob(['x'])));
      vi.mocked(photos.attach).mockClear();
      return added.map((p) => p.id);
    };
    return { ...app, photos, addPhotos };
  }

  afterEach(() => {
    vi.restoreAllMocks();
    document.querySelectorAll('.cdk-overlay-container').forEach((el) => el.replaceChildren());
  });

  it('sin foto ofrece hacerla o elegirla de la galería', async () => {
    const { open, store } = await setup();
    const item = await store.addItem({ name: 'Taladro' });
    const el = await open(`/o/${item.id}`);

    expect(el.querySelector('img')).toBeNull();
    const labels = [...el.querySelectorAll('app-entity-photo .actions button')].map((b) =>
      b.textContent?.replace(/\s+/g, ' ').trim(),
    );
    expect(labels).toEqual(['photo_camera Hacer foto', 'image Galería']);
    const camera = el.querySelector('input[aria-label="Hacer una foto"]');
    expect(camera?.getAttribute('capture')).toBe('environment');
    expect(camera?.getAttribute('accept')).toBe('image/*');
    expect(
      el.querySelector('input[aria-label="Elegir fotos de la galería"]')?.hasAttribute('capture'),
    ).toBe(false);
    expect(
      el.querySelector('input[aria-label="Elegir fotos de la galería"]')?.hasAttribute('multiple'),
    ).toBe(true);
  });

  it('pone la foto elegida y la muestra', async () => {
    const { open, until, store, photos } = await setup();
    const item = await store.addItem({ name: 'Taladro' });
    const el = await open(`/o/${item.id}`);

    choose(el, 'Hacer una foto', photo);
    await until(() => el.querySelector('img') !== null);

    expect(photos.attach).toHaveBeenCalledWith(item.id, photo);
    const img = el.querySelector('img');
    expect(img?.getAttribute('src')).toBe(`blob:${store.get(item.id)?.photoId}`);
    expect(img?.getAttribute('alt')).toBe('Foto de Taladro');
    expect(el.querySelector('.remove')).not.toBeNull();
  });

  it('muestra también la foto de un contenedor y permite ampliarla', async () => {
    const { open, settle, store, addPhotos } = await setup();
    const caja = await store.addContainer({ name: 'Caja', typeId: null });
    await addPhotos(caja.id, 1);

    const el = await open(`/c/${caja.id}`);
    await settle();
    const frame = el.querySelector<HTMLButtonElement>('button.frame');
    expect(frame?.getAttribute('aria-label')).toBe('Ampliar la foto');

    frame?.click();
    await settle();
    expect(frame?.classList.contains('expanded')).toBe(true);
    expect(frame?.getAttribute('aria-label')).toBe('Reducir la foto');
  });

  it('actualiza la foto si la cambia otro dispositivo', async () => {
    const { open, settle, store, repository } = await setup();
    const item = await store.addItem({ name: 'Taladro' });
    const el = await open(`/o/${item.id}`);
    expect(el.querySelector('img')).toBeNull();

    const first = await repository.uploadPhoto(item.id, new Blob(['x']));
    await repository.updateEntity(item.id, { photoId: first.id });
    await store.refresh();
    await settle();
    expect(mainSrc(el)).toBe(`blob:${first.id}`);

    // Otro dispositivo añade una segunda foto y la destaca.
    const second = await repository.uploadPhoto(item.id, new Blob(['y']));
    await repository.updateEntity(item.id, { photoId: second.id });
    await store.refresh();
    await settle();
    expect(mainSrc(el)).toBe(`blob:${second.id}`);
    expect(thumbs(el).length).toBe(2);
  });

  it('con una sola foto no hay galería ni opción de destacar', async () => {
    const { open, settle, store, addPhotos } = await setup();
    const item = await store.addItem({ name: 'Taladro' });
    await addPhotos(item.id, 1);
    const el = await open(`/o/${item.id}`);
    await settle();

    expect(el.querySelector('.gallery')).toBeNull();
    expect(el.querySelector('.feature')).toBeNull();
  });

  it('muestra primero la foto destacada y debajo la galería; al pulsar una se ve en grande', async () => {
    const { open, settle, store, addPhotos } = await setup();
    const caja = await store.addContainer({ name: 'Caja', typeId: null });
    const [a, b, c] = await addPhotos(caja.id, 3);
    await store.update(caja.id, { photoId: b });

    const el = await open(`/c/${caja.id}`);
    await settle();

    expect(mainSrc(el)).toBe(`blob:${b}`);
    expect(thumbs(el).map((t) => t.querySelector('img')?.getAttribute('src'))).toEqual([
      `blob:${a}`,
      `blob:${b}`,
      `blob:${c}`,
    ]);
    expect(thumbs(el).map((t) => t.getAttribute('aria-label'))).toEqual([
      'Ver la foto 1',
      'Ver la foto 2 (destacada)',
      'Ver la foto 3',
    ]);
    expect(thumbs(el)[1].getAttribute('aria-current')).toBe('true');

    thumbs(el)[2].click();
    await settle();

    expect(mainSrc(el)).toBe(`blob:${c}`);
    expect(thumbs(el)[2].getAttribute('aria-current')).toBe('true');
    expect(thumbs(el)[1].hasAttribute('aria-current')).toBe(false);
    // La destacada no cambia por mirar otra.
    expect(store.featuredPhotoId(caja.id)).toBe(b);
  });

  it('destaca la foto que se está viendo', async () => {
    const { open, settle, store, photos, addPhotos } = await setup();
    const caja = await store.addContainer({ name: 'Caja', typeId: null });
    const [a, b] = await addPhotos(caja.id, 2);
    const el = await open(`/c/${caja.id}`);
    await settle();
    expect(el.querySelector('.feature')).toBeNull(); // se está viendo la destacada

    thumbs(el)[1].click();
    await settle();
    clickOn('app-entity-photo .feature');
    await settle();

    expect(photos.feature).toHaveBeenCalledWith(caja.id, b);
    expect(store.get(caja.id)?.photoId).toBe(b);
    expect(a).not.toBe(b);
    expect(thumbs(el)[1].querySelector('.featured')).not.toBeNull();
    expect(thumbs(el)[0].querySelector('.featured')).toBeNull();
    expect(el.querySelector('.feature')).toBeNull();
  });

  it('sube varias fotos elegidas a la vez; la primera queda como destacada', async () => {
    const { open, until, store, photos } = await setup();
    const item = await store.addItem({ name: 'Taladro' });
    const el = await open(`/o/${item.id}`);

    choose(el, 'Elegir fotos de la galería', photo, other);
    await until(() => thumbs(el).length === 2);

    expect(vi.mocked(photos.attach).mock.calls).toEqual([
      [item.id, photo],
      [item.id, other],
    ]);
    const [first, second] = store.photosOf(item.id).map((p) => p.id);
    expect(store.featuredPhotoId(item.id)).toBe(first);
    expect(mainSrc(el)).toBe(`blob:${second}`); // se enseña la última añadida
  });

  it('al entrar en otra entidad vuelve a empezar por su foto destacada', async () => {
    const { open, settle, store, addPhotos } = await setup();
    const caja = await store.addContainer({ name: 'Caja', typeId: null });
    const otra = await store.addContainer({ name: 'Otra', typeId: null });
    await addPhotos(caja.id, 2);
    const [destacada] = await addPhotos(otra.id, 2);
    let el = await open(`/c/${caja.id}`);
    await settle();
    thumbs(el)[1].click();
    await settle();

    el = await open(`/c/${otra.id}`);
    await settle();

    expect(mainSrc(el)).toBe(`blob:${destacada}`);
  });

  it('quita la foto solo tras confirmar', async () => {
    const { open, settle, until, store, photos, addPhotos } = await setup();
    const item = await store.addItem({ name: 'Taladro' });
    const [photoId] = await addPhotos(item.id, 1);
    const el = await open(`/o/${item.id}`);
    await settle();

    clickOn('app-entity-photo .remove');
    await settle();
    expect(document.querySelector('mat-dialog-content')?.textContent).toContain(
      'no se podrá recuperar',
    );
    clickOn('mat-dialog-actions button', 'Cancelar');
    await until(() => document.querySelector('mat-dialog-container') === null);
    expect(photos.remove).not.toHaveBeenCalled();

    clickOn('app-entity-photo .remove');
    await settle();
    clickOn('mat-dialog-actions .confirm');
    await until(() => el.querySelector('img') === null);

    expect(photos.remove).toHaveBeenCalledWith(item.id, photoId);
    expect(store.get(item.id)?.photoId).toBeNull();
  });

  it('quita la foto que se está viendo y pasa a mostrar la destacada', async () => {
    const { open, settle, until, store, photos, addPhotos } = await setup();
    const item = await store.addItem({ name: 'Taladro' });
    const [a, b, c] = await addPhotos(item.id, 3);
    const el = await open(`/o/${item.id}`);
    await settle();
    thumbs(el)[2].click();
    await settle();

    clickOn('app-entity-photo .remove');
    await settle();
    clickOn('mat-dialog-actions .confirm');
    await until(() => thumbs(el).length === 2);

    expect(photos.remove).toHaveBeenCalledWith(item.id, c);
    expect(store.photosOf(item.id).map((p) => p.id)).toEqual([a, b]);
    expect(mainSrc(el)).toBe(`blob:${a}`);
  });

  it('avisa y deja reintentar si la foto no se puede cargar', async () => {
    const { open, settle, store, photos, addPhotos } = await setup();
    const item = await store.addItem({ name: 'Taladro' });
    await addPhotos(item.id, 1);
    vi.mocked(photos.objectUrl).mockRejectedValueOnce(new Error('sin red'));

    const el = await open(`/o/${item.id}`);
    await settle();
    expect(el.querySelector('[role="alert"]')?.textContent).toContain('No se ha podido cargar');

    clickOn('app-entity-photo [role="alert"] button');
    await settle();
    expect(el.querySelector('img')).not.toBeNull();
  });

  it('informa del error si no se puede guardar la foto', async () => {
    const { open, until, store, photos } = await setup();
    const item = await store.addItem({ name: 'Taladro' });
    vi.mocked(photos.attach).mockRejectedValueOnce(new Error('sin red'));
    const el = await open(`/o/${item.id}`);

    choose(el, 'Elegir fotos de la galería', photo);
    await until(() => document.querySelector('mat-snack-bar-container') !== null);

    expect(document.querySelector('mat-snack-bar-container')?.textContent).toContain(
      'No se ha podido guardar',
    );
    expect(el.querySelector('img')).toBeNull();
  });
});
