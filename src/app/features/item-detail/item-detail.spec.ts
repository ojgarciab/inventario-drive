import { setupApp, texts } from '../../testing';

describe('ItemDetail', () => {
  it('muestra la ficha del objeto con su ubicación', async () => {
    const { open, store } = await setupApp();
    const caja = await store.addContainer({ name: 'Caja', typeId: null });
    const item = await store.addItem({
      name: 'Adornos',
      parentId: caja.id,
      quantity: 12,
      notes: 'Frágiles',
      tags: ['navidad'],
    });

    const el = await open(`/o/${item.id}`);

    expect(texts(el, 'app-breadcrumb li')).toEqual(['Inicio', 'Caja', 'Adornos']);
    expect(el.querySelector('h1')?.textContent).toBe('Adornos');
    expect(el.querySelector('.type')?.textContent).toBe('Cantidad: 12');
    expect(el.querySelector('.notes')?.textContent).toBe('Frágiles');
    expect(texts(el, '.tags li')).toEqual(['navidad']);
    expect(el.querySelector('app-entity-actions')).not.toBeNull();
  });

  it('avisa si el objeto no existe', async () => {
    const { open } = await setupApp();
    const el = await open('/o/no-existe');
    expect(el.querySelector('[role="alert"]')?.textContent).toContain('ya no existe');
  });
});
