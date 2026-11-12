import { setupApp, texts } from '../../testing';

describe('Browse', () => {
  it('invita a empezar cuando el inventario está vacío', async () => {
    const { open } = await setupApp();
    const el = await open('/');
    expect(el.querySelector('h1')?.textContent).toBe('Inicio');
    expect(el.querySelector('.empty')?.textContent).toContain('Empiece creando un contenedor');
    expect(el.querySelector('mat-nav-list')).toBeNull();
  });

  it('lista el contenido de un contenedor con su ruta', async () => {
    const { open, store, typeId } = await setupApp();
    const casa = await store.addContainer({ name: 'Casa', typeId: typeId('Casa') });
    const dormitorio = await store.addContainer({
      name: 'Dormitorio',
      typeId: typeId('Habitación'),
      parentId: casa.id,
      notes: 'Planta alta',
      tags: ['arriba'],
    });
    const armario = await store.addContainer({
      name: 'Armario',
      typeId: null,
      parentId: dormitorio.id,
    });
    await store.addItem({ name: 'Maleta', parentId: armario.id });
    await store.addItem({ name: 'Pilas', parentId: dormitorio.id, quantity: 4 });
    await store.addItem({ name: 'Lámpara', parentId: dormitorio.id });

    const el = await open(`/c/${dormitorio.id}`);

    expect(texts(el, 'app-breadcrumb li')).toEqual(['Inicio', 'Casa', 'Dormitorio']);
    expect(el.querySelector('app-breadcrumb [aria-current]')?.textContent).toBe('Dormitorio');
    expect(el.querySelector('h1')?.textContent).toBe('Dormitorio');
    expect(el.querySelector('.type')?.textContent).toBe('Habitación');
    expect(el.querySelector('.notes')?.textContent).toBe('Planta alta');
    expect(texts(el, '.tags li')).toEqual(['arriba']);
    expect(el.querySelector('.tags a')?.getAttribute('href')).toBe('/buscar?q=arriba');
    expect(texts(el, '[matListItemTitle]')).toEqual(['Armario', 'Lámpara', 'Pilas']);
    expect(texts(el, '[matListItemLine]')).toEqual(['1 elemento', 'Cantidad: 4']);
    expect(el.querySelector('mat-nav-list a')?.getAttribute('href')).toBe(`/c/${armario.id}`);
  });

  it('separa los contenedores y los objetos en dos grupos', async () => {
    const { open, store } = await setupApp();
    const casa = await store.addContainer({ name: 'Casa', typeId: null });
    for (const name of ['Salón', 'Cocina', 'Baño']) {
      await store.addContainer({ name, typeId: null, parentId: casa.id });
    }
    await store.addItem({ name: 'Llaves', parentId: casa.id });
    await store.addItem({ name: 'Paraguas', parentId: casa.id });

    const el = await open(`/c/${casa.id}`);

    const lists = [...el.querySelectorAll('mat-nav-list')];
    expect(lists.map((list) => list.getAttribute('aria-label'))).toEqual([
      'Contenedores',
      'Objetos',
    ]);
    expect(texts(lists[0] as HTMLElement, '[matListItemTitle]')).toEqual([
      'Baño',
      'Cocina',
      'Salón',
    ]);
    expect(texts(lists[1] as HTMLElement, '[matListItemTitle]')).toEqual(['Llaves', 'Paraguas']);
    expect(lists[0].querySelectorAll('.container-row').length).toBe(3);
    expect(lists[1].querySelectorAll('.container-row').length).toBe(0);
  });

  it('no muestra un grupo vacío', async () => {
    const { open, store } = await setupApp();
    const caja = await store.addContainer({ name: 'Caja', typeId: null });
    await store.addItem({ name: 'Pilas', parentId: caja.id });

    const el = await open(`/c/${caja.id}`);

    const lists = [...el.querySelectorAll('mat-nav-list')];
    expect(lists.map((list) => list.getAttribute('aria-label'))).toEqual(['Objetos']);
  });

  it('muestra los contenedores raíz en el inicio', async () => {
    const { open, store } = await setupApp();
    await store.addContainer({ name: 'Trastero', typeId: null });
    await store.addContainer({ name: 'Casa', typeId: null });
    const el = await open('/');
    expect(texts(el, '[matListItemTitle]')).toEqual(['Casa', 'Trastero']);
    expect(texts(el, '[matListItemLine]')).toEqual(['Vacío', 'Vacío']);
  });

  it('avisa en el inicio de los elementos sin ubicar', async () => {
    const { open, store } = await setupApp();
    const caja = await store.addContainer({ name: 'Caja', typeId: null });
    const item = await store.addItem({ name: 'Pilas', parentId: caja.id });
    expect((await open('/')).querySelector('.notice')).toBeNull();

    store.applyRemote({ removedIds: [caja.id] });
    const el = await open(`/o/${item.id}`).then(() => open('/'));

    expect(el.querySelector('.notice')?.textContent).toContain('Hay 1 elemento');
    expect(el.querySelector('.notice')?.getAttribute('href')).toBe('/sin-ubicar');
  });

  it('avisa si el contenedor no existe', async () => {
    const { open } = await setupApp();
    const el = await open('/c/no-existe');
    expect(el.querySelector('[role="alert"]')?.textContent).toContain('ya no existe');
    expect(el.querySelector('.add')).toBeNull();
  });
});
