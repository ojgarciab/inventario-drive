import { TestBed } from '@angular/core/testing';
import { PhotoService } from '../core/photos/photo-service';
import { clickOn, setupApp } from '../testing';

/** Simula que el usuario elige un archivo en el selector indicado. */
function choose(el: HTMLElement, label: string, file: File): void {
  const input = el.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
  if (!input) throw new Error(`No existe el selector «${label}»`);
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new Event('change'));
}

const photo = new File(['imagen'], 'foto.jpg', { type: 'image/jpeg' });

describe('EntityPhoto', () => {
  async function setup() {
    const app = await setupApp();
    const photos = TestBed.inject(PhotoService);
    const urls = new Map<string, string>();
    vi.spyOn(photos, 'objectUrl').mockImplementation(async (id) => urls.get(id) ?? `blob:${id}`);
    // Como el servicio real: sube al repositorio y asocia la foto a la entidad.
    vi.spyOn(photos, 'attach').mockImplementation(async (entityId, image) => {
      const photoId = await app.repository.uploadPhoto(entityId, image);
      await app.store.update(entityId, { photoId });
    });
    vi.spyOn(photos, 'detach').mockImplementation(async (entityId) => {
      await app.store.update(entityId, { photoId: null });
    });
    return { ...app, photos };
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
      el
        .querySelector('input[aria-label="Elegir una foto de la galería"]')
        ?.hasAttribute('capture'),
    ).toBe(false);
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
    const { open, settle, store, repository } = await setup();
    const caja = await store.addContainer({ name: 'Caja', typeId: null });
    const photoId = await repository.uploadPhoto(caja.id, new Blob(['x']));
    await store.update(caja.id, { photoId });

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

    const photoId = await repository.uploadPhoto(item.id, new Blob(['x']));
    await repository.updateEntity(item.id, { photoId });
    await store.refresh();
    await settle();

    expect(el.querySelector('img')?.getAttribute('src')).toBe(`blob:${photoId}`);
  });

  it('quita la foto solo tras confirmar', async () => {
    const { open, settle, until, store, repository, photos } = await setup();
    const item = await store.addItem({ name: 'Taladro' });
    await store.update(item.id, {
      photoId: await repository.uploadPhoto(item.id, new Blob(['x'])),
    });
    const el = await open(`/o/${item.id}`);
    await settle();

    clickOn('app-entity-photo .remove');
    await settle();
    expect(document.querySelector('mat-dialog-content')?.textContent).toContain(
      'no se podrá recuperar',
    );
    clickOn('mat-dialog-actions button', 'Cancelar');
    await until(() => document.querySelector('mat-dialog-container') === null);
    expect(photos.detach).not.toHaveBeenCalled();

    clickOn('app-entity-photo .remove');
    await settle();
    clickOn('mat-dialog-actions .confirm');
    await until(() => el.querySelector('img') === null);

    expect(photos.detach).toHaveBeenCalledWith(item.id);
    expect(store.get(item.id)?.photoId).toBeNull();
  });

  it('avisa y deja reintentar si la foto no se puede cargar', async () => {
    const { open, settle, store, repository, photos } = await setup();
    const item = await store.addItem({ name: 'Taladro' });
    await store.update(item.id, {
      photoId: await repository.uploadPhoto(item.id, new Blob(['x'])),
    });
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

    choose(el, 'Elegir una foto de la galería', photo);
    await until(() => document.querySelector('mat-snack-bar-container') !== null);

    expect(document.querySelector('mat-snack-bar-container')?.textContent).toContain(
      'No se ha podido guardar',
    );
    expect(el.querySelector('img')).toBeNull();
  });
});
