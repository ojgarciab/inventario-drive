import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Connectivity } from './core/pwa/connectivity';
import { PhotoService } from './core/photos/photo-service';
import { setupApp } from './testing';

/** Sin conexión se puede navegar, pero todo lo que guarda cambios queda desactivado. */
describe('modo de solo consulta sin conexión', () => {
  const online = signal(true);
  const disabled = (el: HTMLElement, selector: string) =>
    [...el.querySelectorAll<HTMLButtonElement>(selector)].map((button) => button.disabled);

  async function setup() {
    online.set(true);
    TestBed.overrideProvider(Connectivity, { useValue: { online } });
    const app = await setupApp();
    vi.spyOn(TestBed.inject(PhotoService), 'objectUrl').mockImplementation(
      async (id) => `blob:${id}`,
    );
    const caja = await app.store.addContainer({ name: 'Caja', typeId: null });
    const item = await app.store.addItem({ name: 'Pilas', parentId: caja.id });
    app.store.photoAdded(await app.repository.uploadPhoto(item.id, new Blob(['x'])));
    const goOffline = async () => {
      online.set(false);
      await app.settle();
    };
    return { ...app, caja, item, goOffline };
  }

  afterEach(() => vi.restoreAllMocks());

  it('se sigue pudiendo navegar y buscar', async () => {
    const { open, caja, item, goOffline } = await setup();
    await goOffline();
    expect((await open(`/c/${caja.id}`)).querySelector('h1')?.textContent).toBe('Caja');
    expect((await open(`/o/${item.id}`)).querySelector('h1')?.textContent).toBe('Pilas');
    const results = await open('/buscar?q=pilas');
    expect(results.querySelectorAll('mat-nav-list a').length).toBe(1);
  });

  it('desactiva añadir y el menú de acciones de un contenedor', async () => {
    const { open, caja, goOffline } = await setup();
    const el = await open(`/c/${caja.id}`);
    expect(disabled(el, 'button.add, [aria-label="Acciones"]')).toEqual([false, false]);

    await goOffline();
    expect(disabled(el, 'button.add, [aria-label="Acciones"]')).toEqual([true, true]);
  });

  it('en las fotos desactiva añadir, quitar y girar, pero no la lupa', async () => {
    const { open, settle, item, goOffline } = await setup();
    const el = await open(`/o/${item.id}`);
    await settle();
    await goOffline();

    expect(disabled(el, 'app-entity-photo .actions button')).toEqual([true, true, true]);
    expect(disabled(el, '.tools .rotate-left, .tools .rotate-right')).toEqual([true, true]);
    expect(disabled(el, '.tools .zoom-in')).toEqual([false]);
  });

  it('desactiva guardar en el formulario y confirmar un traslado', async () => {
    const { open, item, goOffline } = await setup();
    await goOffline();
    const form = await open(`/o/${item.id}/editar`);
    expect(disabled(form, 'button[type="submit"]')).toEqual([true]);
    const move = await open(`/mover/${item.id}`);
    expect(disabled(move, 'button.confirm')).toEqual([true]);
  });

  it('desactiva la papelera y la gestión de tipos', async () => {
    const { open, store, item, goOffline } = await setup();
    await store.remove(item.id);
    await goOffline();
    const trash = await open('/papelera');
    expect(disabled(trash, 'mat-list-item button')).toEqual([true, true]);
    const settings = await open('/ajustes');
    expect(disabled(settings, '.add-type')).toEqual([true]);
    expect(disabled(settings, 'mat-list .row-actions button').every(Boolean)).toBe(true);
  });

  it('al volver la conexión se reactivan', async () => {
    const { open, settle, caja, goOffline } = await setup();
    const el = await open(`/c/${caja.id}`);
    await goOffline();
    online.set(true);
    await settle();
    expect(disabled(el, 'button.add, [aria-label="Acciones"]')).toEqual([false, false]);
  });
});
