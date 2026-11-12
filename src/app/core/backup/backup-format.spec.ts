import { BackupError, parseBackup, toBackup } from './backup-format';

const valid = () => ({
  format: 'inventario-hogar',
  version: 1,
  exportedAt: '2026-11-12T08:00:00.000Z',
  types: [{ id: 't1', name: 'Caja', icon: 'package_2', order: 40, slug: 'caja' }],
  entities: [
    { id: 'c1', kind: 'container', name: 'Caja', parentId: null, typeId: 't1' },
    { id: 'o1', kind: 'item', name: 'Pilas', parentId: 'c1', quantity: 4, tags: ['aa', 3] },
  ],
});

describe('formato de la copia de seguridad', () => {
  it('conserva los datos al exportar y volver a leer', () => {
    const entity = {
      kind: 'item' as const,
      id: 'o1',
      name: 'Pilas',
      notes: 'Notas',
      parentId: 'c1',
      photoId: 'f1',
      photoIds: ['f0', 'f1'],
      tags: ['aa'],
      quantity: 4,
      createdAt: '2026-01-01T00:00:00Z',
      modifiedAt: '2026-01-02T00:00:00Z',
      deletedAt: null,
    };
    const type = { id: 't1', name: 'Caja', icon: 'package_2', order: 40, slug: 'caja' };
    const backup = toBackup([type], [entity], new Date('2026-11-12T08:00:00Z'));

    expect(parseBackup(JSON.stringify(backup))).toEqual(backup);
    expect(backup.exportedAt).toBe('2026-11-12T08:00:00.000Z');
  });

  it('completa con valores por defecto los campos que falten', () => {
    const { entities } = parseBackup(JSON.stringify(valid()));
    expect(entities[0]).toEqual({
      kind: 'container',
      id: 'c1',
      name: 'Caja',
      notes: '',
      parentId: null,
      photoId: null,
      photoIds: [],
      tags: [],
      typeId: 't1',
      createdAt: '',
      modifiedAt: '',
      deletedAt: null,
    });
    expect(entities[1]).toMatchObject({ kind: 'item', quantity: 4, tags: ['aa'] });
  });

  it('lee las copias anteriores a las galerías: la única foto es la destacada', () => {
    const old = valid();
    Object.assign(old.entities[0], { photoId: 'f1' });
    expect(parseBackup(JSON.stringify(old)).entities[0]).toMatchObject({
      photoId: 'f1',
      photoIds: ['f1'],
    });
  });

  it('rechaza lo que no es una copia del inventario', () => {
    expect(() => parseBackup('no es json')).toThrow(BackupError);
    expect(() => parseBackup('[1, 2]')).toThrow('no contiene una copia');
    expect(() => parseBackup('{"format":"otra-cosa","version":1}')).toThrow(
      'no contiene una copia',
    );
  });

  it('rechaza las copias de otra versión, incompletas o con elementos inválidos', () => {
    expect(() => parseBackup(JSON.stringify({ ...valid(), version: 2 }))).toThrow('versión');
    expect(() => parseBackup(JSON.stringify({ ...valid(), entities: undefined }))).toThrow(
      'incompleta',
    );
    const broken = valid();
    broken.entities[0].kind = 'otra';
    expect(() => parseBackup(JSON.stringify(broken))).toThrow('elemento no válido');
    const unnamed = valid();
    unnamed.entities[1].name = '';
    expect(() => parseBackup(JSON.stringify(unnamed))).toThrow('elemento no válido');
  });
});
