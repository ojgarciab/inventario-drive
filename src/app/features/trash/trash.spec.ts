import { clickOn, setupApp, texts } from '../../testing';

describe('Trash', () => {
  afterEach(() => {
    document.querySelectorAll('.cdk-overlay-container').forEach((el) => el.replaceChildren());
  });

  it('indica cuando está vacía', async () => {
    const { open } = await setupApp();
    const el = await open('/papelera');
    expect(el.querySelector('.empty')?.textContent).toContain('vacía');
    expect(el.querySelector('.hint')?.textContent).toContain('30 días');
  });

  it('lista lo borrado con el sitio en el que estaba', async () => {
    const { open, store } = await setupApp();
    const casa = await store.addContainer({ name: 'Casa', typeId: null });
    const caja = await store.addContainer({ name: 'Caja', typeId: null, parentId: casa.id });
    const pilas = await store.addItem({ name: 'Pilas', parentId: caja.id });
    const suelto = await store.addItem({ name: 'Suelto' });
    await store.remove(pilas.id);
    await store.remove(suelto.id);

    const el = await open('/papelera');

    expect(texts(el, '[matListItemTitle]').sort()).toEqual(['Pilas', 'Suelto']);
    const lines = texts(el, '[matListItemLine]').join('\n');
    expect(lines).toContain('estaba en Casa › Caja');
    expect(lines).toContain('estaba en el inicio');
    expect(lines).toMatch(/Borrado el \d/);
  });

  it('restaura una entidad', async () => {
    const { open, settle, store } = await setupApp();
    const item = await store.addItem({ name: 'Pilas' });
    await store.remove(item.id);
    await open('/papelera');

    clickOn('[aria-label="Restaurar Pilas"]');
    const el = await settle();

    expect(store.get(item.id)).toBeDefined();
    expect(el.querySelector('.empty')).not.toBeNull();
  });

  it('elimina definitivamente solo tras confirmar', async () => {
    const { open, settle, until, store, repository } = await setupApp();
    const item = await store.addItem({ name: 'Pilas' });
    await store.remove(item.id);
    await open('/papelera');

    clickOn('[aria-label="Eliminar definitivamente Pilas"]');
    await settle();
    expect(document.querySelector('mat-dialog-content')?.textContent).toContain(
      'no se podrá recuperar',
    );
    clickOn('mat-dialog-actions button', 'Cancelar');
    await until(() => document.querySelector('mat-dialog-container') === null);
    expect(store.trash().length).toBe(1);

    clickOn('[aria-label="Eliminar definitivamente Pilas"]');
    await settle();
    clickOn('mat-dialog-actions .confirm');
    await until(() => store.trash().length === 0);

    expect(store.trash()).toEqual([]);
    expect((await repository.loadAll()).entities).toEqual([]);
  });
});
