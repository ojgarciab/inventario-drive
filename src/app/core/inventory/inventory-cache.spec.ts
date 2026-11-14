import { CachedInventory, InventoryCache } from './inventory-cache';

/** Caché del navegador simulada, con respuestas que conservan su texto. */
function fakeCaches() {
  const stores = new Map<string, Map<string, string>>();
  vi.stubGlobal(
    'Response',
    class {
      constructor(private readonly body: string) {}
      json = async () => JSON.parse(this.body);
      blob = async () => new Blob([this.body]);
    },
  );
  vi.stubGlobal('caches', {
    open: async (name: string) => {
      const entries = stores.get(name) ?? new Map<string, string>();
      stores.set(name, entries);
      return {
        match: async (key: string) =>
          entries.has(key) ? new Response(entries.get(key) as string) : undefined,
        put: async (key: string, response: { body: string }) =>
          void entries.set(key, response.body),
      };
    },
    delete: async (name: string) => stores.delete(name),
  });
  return stores;
}

const copy: CachedInventory = {
  syncedAt: '2026-11-14T15:00:00.000Z',
  changeToken: 't42',
  types: [{ id: 't', name: 'Caja', icon: 'package_2', order: 10, slug: 'caja' }],
  entities: [
    {
      kind: 'item',
      id: 'o1',
      name: 'Pilas',
      notes: '',
      parentId: null,
      photoId: null,
      tags: [],
      quantity: 2,
      createdAt: '',
      modifiedAt: '',
      deletedAt: null,
    },
  ],
  photos: [{ id: 'f1', entityId: 'o1', createdAt: '', rotation: 1 }],
};

describe('InventoryCache', () => {
  let stores: Map<string, Map<string, string>>;
  const cache = new InventoryCache();

  beforeEach(() => {
    stores = fakeCaches();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('sin copia guardada no devuelve nada', async () => {
    expect(await cache.load()).toBeNull();
    expect(await cache.size()).toBeNull();
  });

  it('guarda el inventario y lo recupera igual', async () => {
    await cache.save(copy);
    expect(await cache.load()).toEqual(copy);
    expect(await cache.size()).toBeGreaterThan(100);
  });

  it('la copia más reciente sustituye a la anterior', async () => {
    await cache.save(copy);
    await cache.save({ ...copy, changeToken: 't43', entities: [] });
    expect(await cache.load()).toMatchObject({ changeToken: 't43', entities: [] });
  });

  it('al borrarla no queda nada en el dispositivo', async () => {
    await cache.save(copy);
    await cache.clear();
    expect(stores.size).toBe(0);
    expect(await cache.load()).toBeNull();
  });

  it('ignora una copia dañada o de otro formato', async () => {
    const entries = new Map([['/__inventario__/datos.json', '{"version":99,"entities":[]}']]);
    stores.set('inventario-datos', entries);
    expect(await cache.load()).toBeNull();
    entries.set('/__inventario__/datos.json', 'no es json');
    expect(await cache.load()).toBeNull();
  });

  it('sin caché en el navegador no falla: simplemente no hay copia', async () => {
    vi.stubGlobal('caches', undefined);
    await expect(cache.save(copy)).resolves.toBeUndefined();
    expect(await cache.load()).toBeNull();
    await expect(cache.clear()).resolves.toBeUndefined();
  });
});
