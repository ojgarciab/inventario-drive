import { setupApp, texts } from '../../testing';

describe('Tags', () => {
  it('avisa cuando todavía no hay etiquetas', async () => {
    const { open, store } = await setupApp();
    await store.addItem({ name: 'Taladro' });
    const el = await open('/etiquetas');
    expect(el.querySelector('h1')?.textContent).toBe('Etiquetas');
    expect(el.querySelector('.empty')?.textContent).toContain('Todavía no hay etiquetas');
    expect(el.querySelector('mat-nav-list')).toBeNull();
  });

  it('lista las etiquetas de la más usada a la menos con el número de elementos', async () => {
    const { open, store } = await setupApp();
    const caja = await store.addContainer({ name: 'Caja', typeId: null, tags: ['navidad'] });
    await store.addItem({ name: 'Bolas', parentId: caja.id, tags: ['navidad', 'frágil'] });
    await store.addItem({ name: 'Luces', tags: ['Navidad', 'cables'] });
    await store.addItem({ name: 'Jarrón', tags: ['frágil'] });
    // Lo que está en la papelera no cuenta.
    const borrado = await store.addItem({ name: 'Roto', tags: ['cables', 'cables viejos'] });
    await store.remove(borrado.id);

    const el = await open('/etiquetas');

    expect(texts(el, '[matListItemTitle]')).toEqual(['navidad', 'frágil', 'cables']);
    expect(texts(el, '.count')).toEqual(['3 elementos', '2 elementos', '1 elemento']);
    expect(el.querySelector('mat-nav-list a')?.getAttribute('href')).toBe('/buscar?q=navidad');
  });
});
