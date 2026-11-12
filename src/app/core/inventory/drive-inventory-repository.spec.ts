import { TestBed } from '@angular/core/testing';
import { DriveApi, DriveFile } from '../drive/drive-api';
import { DriveInventoryRepository } from './drive-inventory-repository';

const file = (id: string, appProperties: Record<string, string>): DriveFile => ({
  id,
  name: id,
  appProperties,
  createdTime: '2026-11-01T00:00:00Z',
  modifiedTime: '2026-11-01T00:00:00Z',
});

describe('DriveInventoryRepository', () => {
  const api = {
    startPageToken: vi.fn(),
    listAll: vi.fn(),
    listChanges: vi.fn(),
    update: vi.fn(),
  };
  let repository: DriveInventoryRepository;

  beforeEach(() => {
    vi.resetAllMocks();
    TestBed.configureTestingModule({
      providers: [DriveInventoryRepository, { provide: DriveApi, useValue: api }],
    });
    repository = TestBed.inject(DriveInventoryRepository);
  });

  it('pide el punto de sincronización antes de listar y clasifica los archivos', async () => {
    const order: string[] = [];
    api.startPageToken.mockImplementation(async () => (order.push('token'), 't0'));
    api.listAll.mockImplementation(async () => {
      order.push('lista');
      return [
        file('caja', { k: 'c' }),
        file('pilas', { k: 'o', p: 'caja' }),
        file('tipo', { k: 't', i: 'home', o: '10' }),
        file('foto', { k: 'f', p: 'caja' }),
        file('foto-suelta', { k: 'f' }),
        file('ajeno', {}),
      ];
    });

    const snapshot = await repository.loadAll();

    expect(order).toEqual(['token', 'lista']);
    expect(snapshot.changeToken).toBe('t0');
    expect(snapshot.entities.map((e) => e.id)).toEqual(['caja', 'pilas']);
    expect(snapshot.types.map((t) => t.id)).toEqual(['tipo']);
    expect(snapshot.photos).toMatchObject([{ id: 'foto', entityId: 'caja' }]);
  });

  it('traduce los cambios de Drive, incluidos los borrados', async () => {
    api.listChanges.mockResolvedValue({
      nextToken: 't2',
      changes: [
        { fileId: 'caja', removed: false, file: file('caja', { k: 'c', p: 'armario' }) },
        { fileId: 'tipo', removed: false, file: file('tipo', { k: 't' }) },
        { fileId: 'foto', removed: false, file: file('foto', { k: 'f', p: 'caja' }) },
        { fileId: 'borrado', removed: true },
        { fileId: 'sin-archivo', removed: false },
      ],
    });

    const changes = await repository.changesSince('t1');

    expect(api.listChanges).toHaveBeenCalledWith('t1');
    expect(changes.nextToken).toBe('t2');
    expect(changes.entities).toMatchObject([{ id: 'caja', parentId: 'armario' }]);
    expect(changes.types.map((t) => t.id)).toEqual(['tipo']);
    expect(changes.photos).toMatchObject([{ id: 'foto', entityId: 'caja' }]);
    expect(changes.removedIds).toEqual(['borrado', 'sin-archivo']);
  });

  it('un movimiento es un PATCH con solo el contenedor padre', async () => {
    api.update.mockResolvedValue(file('caja', { k: 'c', p: 'aparador' }));
    const moved = await repository.updateEntity('caja', { parentId: 'aparador' });
    expect(api.update).toHaveBeenCalledWith('caja', { appProperties: { p: 'aparador' } });
    expect(moved.parentId).toBe('aparador');
  });
});
