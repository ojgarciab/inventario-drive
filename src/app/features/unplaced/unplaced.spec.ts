import { setupApp, texts } from '../../testing';

describe('Unplaced', () => {
  it('indica cuando no hay nada sin ubicar', async () => {
    const { open } = await setupApp();
    const el = await open('/sin-ubicar');
    expect(el.querySelector('.empty')?.textContent).toContain('No hay nada sin ubicar');
  });

  it('lista lo que ha perdido su contenedor y ofrece moverlo', async () => {
    const { open, store } = await setupApp();
    const caja = await store.addContainer({ name: 'Caja', typeId: null });
    const item = await store.addItem({ name: 'Pilas', parentId: caja.id });
    store.applyRemote({ removedIds: [caja.id] });

    const el = await open('/sin-ubicar');

    expect(texts(el, '.name')).toEqual(['Pilas']);
    expect(el.querySelector('.name')?.getAttribute('href')).toBe(`/o/${item.id}`);
    expect(el.querySelector('[aria-label="Mover Pilas"]')?.getAttribute('href')).toBe(
      `/mover/${item.id}`,
    );
  });
});
