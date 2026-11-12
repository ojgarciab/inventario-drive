import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { InMemoryInventoryRepository } from './in-memory-inventory-repository';
import { InventoryRepository } from './inventory-repository';
import { InventoryStore } from './inventory-store';
import { Connectivity } from '../pwa/connectivity';
import { Container } from './models';

function setup(repository = new InMemoryInventoryRepository()) {
  TestBed.configureTestingModule({
    providers: [{ provide: InventoryRepository, useValue: repository }],
  });
  return { store: TestBed.inject(InventoryStore), repository };
}

/** casa > dormitorio > armario > caja > adornos ; salón > aparador */
async function house(store: InventoryStore) {
  const typeId = store.types()[0].id;
  const casa = await store.addContainer({ name: 'Casa', typeId });
  const dormitorio = await store.addContainer({ name: 'Dormitorio', typeId, parentId: casa.id });
  const armario = await store.addContainer({ name: 'Armario', typeId, parentId: dormitorio.id });
  const caja = await store.addContainer({ name: 'Caja', typeId, parentId: armario.id });
  const adornos = await store.addItem({ name: 'Adornos', parentId: caja.id });
  const salon = await store.addContainer({ name: 'Salón', typeId, parentId: casa.id });
  const aparador = await store.addContainer({ name: 'Aparador', typeId, parentId: salon.id });
  return { casa, dormitorio, armario, caja, adornos, salon, aparador };
}

describe('InventoryStore', () => {
  it('crea los tipos por defecto la primera vez y no los repite', async () => {
    const { store, repository } = setup();
    expect(store.status()).toBe('idle');
    await store.load();
    expect(store.status()).toBe('ready');
    expect(store.types().map((t) => t.name)).toEqual(['Casa', 'Habitación', 'Armario', 'Caja']);

    await store.load();
    expect((await repository.loadAll()).types.length).toBe(4);
  });

  it('comparte una sola carga entre llamadas simultáneas', async () => {
    const { store, repository } = setup();
    const loadAll = vi.spyOn(repository, 'loadAll');
    await Promise.all([store.load(), store.load()]);
    expect(loadAll).toHaveBeenCalledTimes(1);
  });

  it('pasa a error si la carga falla', async () => {
    const { store, repository } = setup();
    vi.spyOn(repository, 'loadAll').mockRejectedValue(new Error('sin red'));
    await expect(store.load()).rejects.toThrow('sin red');
    expect(store.status()).toBe('error');
  });

  it('anida contenedores y objetos y calcula rutas y recuentos', async () => {
    const { store } = setup();
    await store.load();
    const h = await house(store);

    expect(store.children(null).map((e) => e.name)).toEqual(['Casa']);
    expect(store.children(h.casa.id).map((e) => e.name)).toEqual(['Dormitorio', 'Salón']);
    expect(store.path(h.adornos.id).map((e) => e.name)).toEqual([
      'Casa',
      'Dormitorio',
      'Armario',
      'Caja',
      'Adornos',
    ]);
    expect(store.counts()).toEqual({ containers: 6, items: 1 });
    expect(store.typeOf(h.casa as Container)?.name).toBe('Casa');
  });

  it('traslada una caja con su contenido a otro mueble de otra habitación', async () => {
    const { store } = setup();
    await store.load();
    const h = await house(store);

    await store.move(h.caja.id, h.aparador.id);

    expect(store.children(h.armario.id)).toEqual([]);
    expect(store.path(h.adornos.id).map((e) => e.name)).toEqual([
      'Casa',
      'Salón',
      'Aparador',
      'Caja',
      'Adornos',
    ]);
  });

  it('impide los movimientos imposibles sin llamar al almacenamiento', async () => {
    const { store, repository } = setup();
    await store.load();
    const h = await house(store);
    const update = vi.spyOn(repository, 'updateEntity');

    await expect(store.move(h.dormitorio.id, h.caja.id)).rejects.toThrow('cycle');
    await expect(store.move(h.caja.id, h.caja.id)).rejects.toThrow('cycle');
    await expect(store.move(h.caja.id, h.adornos.id)).rejects.toThrow('invalid_parent');
    await expect(store.move(h.caja.id, 'no-existe')).rejects.toThrow('invalid_parent');
    await expect(store.move('no-existe', null)).rejects.toThrow('not_found');
    await expect(store.addItem({ name: 'x', parentId: h.adornos.id })).rejects.toThrow(
      'invalid_parent',
    );
    expect(update).not.toHaveBeenCalled();
  });

  it('envía a la papelera, restaura y elimina definitivamente', async () => {
    const { store, repository } = setup();
    await store.load();
    const h = await house(store);

    await expect(store.remove(h.caja.id)).rejects.toThrow('not_empty');

    await store.remove(h.adornos.id);
    expect(store.get(h.adornos.id)).toBeUndefined();
    expect(store.trash().map((e) => e.name)).toEqual(['Adornos']);
    expect(store.search('adornos')).toEqual([]);

    await store.remove(h.caja.id); // ya está vacía
    await store.restore(h.adornos.id);
    expect(store.unplaced().map((e) => e.name)).toEqual(['Adornos']);

    await store.purge(h.caja.id);
    expect(store.trash()).toEqual([]);
    expect((await repository.loadAll()).entities.some((e) => e.id === h.caja.id)).toBe(false);
  });

  it('al borrar un contenedor con contenido lo pasa antes al contenedor superior', async () => {
    const { store } = setup();
    await store.load();
    const h = await house(store);
    const maleta = await store.addItem({ name: 'Maleta', parentId: h.armario.id });

    await store.remove(h.armario.id, { moveContents: true });

    expect(store.get(h.armario.id)).toBeUndefined();
    expect(store.children(h.dormitorio.id).map((e) => e.name)).toEqual(['Caja', 'Maleta']);
    expect(store.path(h.adornos.id).map((e) => e.name)).toEqual([
      'Casa',
      'Dormitorio',
      'Caja',
      'Adornos',
    ]);
    expect(store.path(maleta.id).length).toBe(3);
    expect(store.unplaced()).toEqual([]);
  });

  it('informa de las entidades sin ubicar y de los descendientes', async () => {
    const { store } = setup();
    await store.load();
    const h = await house(store);
    expect([...store.descendants(h.armario.id)].sort()).toEqual([h.caja.id, h.adornos.id].sort());

    store.applyRemote({ removedIds: [h.armario.id] });

    expect(store.isUnplaced(h.caja.id)).toBe(true);
    expect(store.isUnplaced(h.adornos.id)).toBe(false);
    expect(store.unplaced().map((e) => e.name)).toEqual(['Caja']);
  });

  it('purga de la papelera solo lo que supera el plazo, según la hora de Drive', async () => {
    const day = 24 * 60 * 60 * 1000;
    const at = (daysAgo: number) => new Date(Date.UTC(2026, 10, 1) - daysAgo * day).toISOString();
    const item = (id: string, modifiedDaysAgo: number, deleted: boolean) => ({
      kind: 'item' as const,
      id,
      name: id,
      notes: '',
      parentId: null,
      photoId: null,
      tags: [],
      quantity: 1,
      createdAt: at(100),
      modifiedAt: at(modifiedDaysAgo),
      deletedAt: deleted ? at(modifiedDaysAgo) : null,
    });
    const repository = new InMemoryInventoryRepository({
      entities: [item('viejo', 45, true), item('reciente', 10, true), item('activo', 0, false)],
    });
    const purge = vi.spyOn(repository, 'purgeEntity');
    const { store } = setup(repository);

    await store.load();
    await new Promise((resolve) => setTimeout(resolve));

    expect(purge.mock.calls).toEqual([['viejo']]);
    expect(store.trash().map((e) => e.id)).toEqual(['reciente']);
    expect(store.get('activo')).toBeDefined();
  });

  it('busca en todo el inventario', async () => {
    const { store } = setup();
    await store.load();
    await house(store);
    expect(store.search('ARMARIO').map((e) => e.name)).toEqual(['Armario']);
  });

  it('incorpora los cambios hechos desde otro dispositivo', async () => {
    const { store } = setup();
    await store.load();
    const h = await house(store);

    store.applyRemote({
      entities: [{ ...h.caja, parentId: h.aparador.id }],
      removedIds: [h.adornos.id],
    });

    expect(store.children(h.aparador.id).map((e) => e.name)).toEqual(['Caja']);
    expect(store.get(h.adornos.id)).toBeUndefined();
    expect(store.counts()).toEqual({ containers: 6, items: 0 });
  });

  describe('tipos de contenedor', () => {
    const names = (store: InventoryStore) => store.types().map((t) => t.name);

    it('añade un tipo al final, lo edita y lo elimina', async () => {
      const { store } = setup();
      await store.load();

      const type = await store.addType({ name: 'Estantería', icon: 'shelves' });
      expect(names(store)).toEqual(['Casa', 'Habitación', 'Armario', 'Caja', 'Estantería']);
      expect(type.order).toBe(50);

      await store.updateType(type.id, { name: 'Balda', icon: 'desk' });
      expect(store.types().at(-1)).toMatchObject({ name: 'Balda', icon: 'desk' });

      await store.removeType(type.id);
      expect(names(store)).toEqual(['Casa', 'Habitación', 'Armario', 'Caja']);
    });

    it('reordena guardando solo los tipos que cambian de posición', async () => {
      const { store, repository } = setup();
      await store.load();
      const update = vi.spyOn(repository, 'updateType');
      const caja = store.types()[3];

      await store.moveType(caja.id, -1);
      expect(names(store)).toEqual(['Casa', 'Habitación', 'Caja', 'Armario']);
      expect(update).toHaveBeenCalledTimes(2);

      await store.moveType(store.types()[0].id, -1); // ya es el primero
      await store.moveType(store.types()[3].id, 1); // ya es el último
      expect(update).toHaveBeenCalledTimes(2);

      // El orden se conserva al volver a cargar.
      await store.load();
      expect(names(store)).toEqual(['Casa', 'Habitación', 'Caja', 'Armario']);
    });

    it('los contenedores de un tipo eliminado quedan sin tipo', async () => {
      const { store } = setup();
      await store.load();
      const type = await store.addType({ name: 'Estantería', icon: 'shelves' });
      const mueble = await store.addContainer({ name: 'Mueble', typeId: type.id });

      await store.removeType(type.id);

      expect(store.typeOf(store.get(mueble.id) as Container)).toBeUndefined();
      expect(store.get(mueble.id)).toBeDefined();
    });

    it('recibe los cambios de tipos hechos en otro dispositivo', async () => {
      const { store, repository } = setup();
      await store.load();
      await repository.createType({ name: 'Remoto', icon: 'category', order: 5 });
      await store.refresh();
      expect(names(store)[0]).toBe('Remoto');
    });
  });

  describe('sincronización con otros dispositivos', () => {
    it('trae lo que otro dispositivo crea, mueve y elimina', async () => {
      const { store, repository } = setup();
      await store.load();
      const h = await house(store);

      // «Otro dispositivo» escribe directamente en el almacenamiento compartido.
      const nuevo = await repository.createItem({ name: 'Paraguas', parentId: h.salon.id });
      await repository.updateEntity(h.caja.id, { parentId: h.aparador.id });
      await repository.purgeEntity(h.adornos.id);
      expect(store.get(nuevo.id)).toBeUndefined();

      await store.refresh();

      expect(store.get(nuevo.id)?.name).toBe('Paraguas');
      expect(store.path(h.caja.id).map((e) => e.name)).toEqual([
        'Casa',
        'Salón',
        'Aparador',
        'Caja',
      ]);
      expect(store.get(h.adornos.id)).toBeUndefined();
    });

    it('solo pide los cambios posteriores a la última consulta', async () => {
      const { store, repository } = setup();
      await store.load();
      const changesSince = vi.spyOn(repository, 'changesSince');
      await repository.createItem({ name: 'Uno' });
      await store.refresh();
      await repository.createItem({ name: 'Dos' });
      await store.refresh();

      const sizes = await Promise.all(changesSince.mock.results.map((r) => r.value));
      expect(sizes.map((changes) => changes.entities.map((e: { name: string }) => e.name))).toEqual(
        [['Uno'], ['Dos']],
      );
    });

    it('no sustituye una versión propia por otra remota más antigua', async () => {
      const { store, repository } = setup();
      await store.load();
      const item = await store.addItem({ name: 'Original' });
      const stale = { ...item };
      await store.update(item.id, { name: 'Recién editado' });

      // Respuesta pedida antes de la escritura propia que llega después.
      vi.spyOn(repository, 'changesSince').mockResolvedValueOnce({
        entities: [stale],
        types: [],
        removedIds: [],
        nextToken: '0',
      });
      await store.refresh();

      expect(store.get(item.id)?.name).toBe('Recién editado');
    });

    it('comparte una sola consulta entre llamadas simultáneas y no consulta sin cargar', async () => {
      const { store, repository } = setup();
      const changesSince = vi.spyOn(repository, 'changesSince');
      await store.refresh();
      expect(changesSince).not.toHaveBeenCalled();

      await store.load();
      await Promise.all([store.refresh(), store.refresh()]);
      expect(changesSince).toHaveBeenCalledTimes(1);
    });

    it('tolera fallos sueltos y recarga todo el inventario si se repiten', async () => {
      const { store, repository } = setup();
      await store.load();
      const loadAll = vi.spyOn(repository, 'loadAll');
      const changesSince = vi.spyOn(repository, 'changesSince').mockRejectedValue(new Error('410'));
      await repository.createItem({ name: 'Paraguas' });

      await store.refresh();
      await store.refresh();
      expect(loadAll).not.toHaveBeenCalled();
      expect(store.status()).toBe('ready');

      await store.refresh();
      expect(loadAll).toHaveBeenCalledTimes(1);
      expect(store.search('paraguas').length).toBe(1);

      changesSince.mockRestore();
      await store.refresh();
      expect(store.status()).toBe('ready');
    });
  });

  it('sin conexión rechaza las escrituras al momento, sin llamar al almacenamiento', async () => {
    const online = signal(true);
    const repository = new InMemoryInventoryRepository();
    TestBed.configureTestingModule({
      providers: [
        { provide: InventoryRepository, useValue: repository },
        { provide: Connectivity, useValue: { online } },
      ],
    });
    const store = TestBed.inject(InventoryStore);
    await store.load();
    const item = await store.addItem({ name: 'Pilas' });
    const create = vi.spyOn(repository, 'createItem');
    const update = vi.spyOn(repository, 'updateEntity');

    online.set(false);

    await expect(store.addItem({ name: 'x' })).rejects.toThrow('offline');
    await expect(store.addContainer({ name: 'x', typeId: null })).rejects.toThrow('offline');
    await expect(store.move(item.id, null)).rejects.toThrow('offline');
    await expect(store.remove(item.id)).rejects.toThrow('offline');
    expect(create).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });
});
