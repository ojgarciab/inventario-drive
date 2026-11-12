import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { clickOn, setupApp, texts } from '../testing';

const dialogText = () => document.querySelector('mat-dialog-content')?.textContent ?? '';

async function openDeleteDialog(settle: () => Promise<HTMLElement>) {
  clickOn('[aria-label="Acciones"]');
  await settle();
  clickOn('.mat-mdc-menu-panel button', 'Eliminar');
  await settle();
}

describe('EntityActions', () => {
  afterEach(() => {
    // Las capas superpuestas viven fuera del componente bajo prueba.
    document.querySelectorAll('.cdk-overlay-container').forEach((el) => el.replaceChildren());
  });

  it('enlaza con editar y mover', async () => {
    const { open, settle, store } = await setupApp();
    const item = await store.addItem({ name: 'Pilas' });
    await open(`/o/${item.id}`);

    clickOn('[aria-label="Acciones"]');
    await settle();

    const links = [...document.querySelectorAll('.mat-mdc-menu-panel a')];
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      `/o/${item.id}/editar`,
      `/mover/${item.id}`,
    ]);
  });

  it('envía un objeto a la papelera tras confirmar y vuelve a su contenedor', async () => {
    const { open, settle, until, store } = await setupApp();
    const caja = await store.addContainer({ name: 'Caja', typeId: null });
    const item = await store.addItem({ name: 'Pilas', parentId: caja.id });
    await open(`/o/${item.id}`);

    await openDeleteDialog(settle);
    expect(dialogText()).toContain('«Pilas» irá a la papelera');
    clickOn('mat-dialog-actions .confirm');
    await until(() => store.trash().length === 1);

    expect(store.get(item.id)).toBeUndefined();
    expect(store.trash().map((e) => e.name)).toEqual(['Pilas']);
    expect(TestBed.inject(Router).url).toBe(`/c/${caja.id}`);
  });

  it('no borra nada si se cancela', async () => {
    const { open, settle, until, store } = await setupApp();
    const item = await store.addItem({ name: 'Pilas' });
    await open(`/o/${item.id}`);

    await openDeleteDialog(settle);
    clickOn('mat-dialog-actions button', 'Cancelar');
    await until(() => document.querySelector('mat-dialog-container') === null);

    expect(store.get(item.id)).toBeDefined();
    expect(TestBed.inject(Router).url).toBe(`/o/${item.id}`);
  });

  it('al eliminar un contenedor con contenido avisa de adónde irá y lo conserva', async () => {
    const { open, settle, until, store } = await setupApp();
    const armario = await store.addContainer({ name: 'Armario', typeId: null });
    const caja = await store.addContainer({ name: 'Caja', typeId: null, parentId: armario.id });
    await store.addItem({ name: 'Pilas', parentId: caja.id });
    await store.addItem({ name: 'Cables', parentId: caja.id });
    await open(`/c/${caja.id}`);

    await openDeleteDialog(settle);
    expect(dialogText()).toContain('contiene 2 elementos, que pasarán a «Armario»');
    clickOn('mat-dialog-actions .confirm');
    const el = await until(() => store.trash().length === 1);

    expect(store.trash().map((e) => e.name)).toEqual(['Caja']);
    expect(TestBed.inject(Router).url).toBe(`/c/${armario.id}`);
    expect(texts(el, '[matListItemTitle]')).toEqual(['Cables', 'Pilas']);
  });

  it('permite deshacer el borrado desde el aviso', async () => {
    const { open, settle, until, store } = await setupApp();
    const item = await store.addItem({ name: 'Pilas' });
    await open(`/o/${item.id}`);
    await openDeleteDialog(settle);
    clickOn('mat-dialog-actions .confirm');
    await until(() => document.querySelector('mat-snack-bar-container button') !== null);

    clickOn('mat-snack-bar-container button', 'Deshacer');
    await until(() => store.trash().length === 0);

    expect(store.get(item.id)).toBeDefined();
    expect(store.trash()).toEqual([]);
  });
});
