import { DriveFile } from '../drive/drive-api';
import {
  changesToPatch,
  containerToFile,
  fileToEntity,
  fileToType,
  itemToFile,
  typeToFile,
} from './drive-mapping';

const file = (overrides: Partial<DriveFile>): DriveFile => ({
  id: 'f1',
  name: 'Caja azul',
  createdTime: '2026-11-01T10:00:00Z',
  modifiedTime: '2026-11-02T10:00:00Z',
  ...overrides,
});

describe('mapeo entre entidades y metadatos de Drive', () => {
  it('lee un contenedor', () => {
    const entity = fileToEntity(
      file({
        description: 'Notas',
        appProperties: { k: 'c', p: 'padre', t: 'tipo', g: 'navidad,frágil', v: '1' },
      }),
    );
    expect(entity).toEqual({
      kind: 'container',
      id: 'f1',
      name: 'Caja azul',
      notes: 'Notas',
      parentId: 'padre',
      typeId: 'tipo',
      photoId: null,
      tags: ['navidad', 'frágil'],
      createdAt: '2026-11-01T10:00:00Z',
      modifiedAt: '2026-11-02T10:00:00Z',
      deletedAt: null,
    });
  });

  it('lee un objeto en la raíz, borrado y con cantidad', () => {
    const entity = fileToEntity(
      file({ appProperties: { k: 'o', q: '3', d: '2026-11-03T00:00:00Z' } }),
    );
    expect(entity).toMatchObject({
      kind: 'item',
      parentId: null,
      quantity: 3,
      notes: '',
      deletedAt: '2026-11-03T00:00:00Z',
    });
  });

  it('usa cantidad 1 si el valor guardado no es válido', () => {
    expect(fileToEntity(file({ appProperties: { k: 'o', q: 'x' } }))).toMatchObject({
      quantity: 1,
    });
  });

  it('ignora los archivos que no son entidades', () => {
    expect(fileToEntity(file({ appProperties: { k: 'f' } }))).toBeNull();
    expect(fileToEntity(file({}))).toBeNull();
    expect(fileToType(file({ appProperties: { k: 'c' } }))).toBeNull();
  });

  it('lee un tipo de contenedor', () => {
    const type = fileToType(
      file({ name: 'Caja', appProperties: { k: 't', i: 'package_2', o: '40', s: 'caja' } }),
    );
    expect(type).toEqual({ id: 'f1', name: 'Caja', icon: 'package_2', order: 40, slug: 'caja' });
  });

  it('escribe un contenedor omitiendo las propiedades vacías', () => {
    expect(containerToFile({ name: '  Armario  ', typeId: 't1', parentId: null })).toEqual({
      name: 'Armario',
      description: '',
      appProperties: { k: 'c', v: '1', t: 't1' },
    });
  });

  it('escribe un objeto con sus etiquetas normalizadas', () => {
    const result = itemToFile({
      name: 'Taladro',
      parentId: 'c1',
      quantity: 2,
      tags: [' bricolaje ', 'bricolaje', 'a,b', ''],
    });
    expect(result.appProperties).toEqual({ k: 'o', v: '1', q: '2', p: 'c1', g: 'bricolaje,a b' });
  });

  it('escribe un tipo', () => {
    expect(typeToFile({ name: 'Estantería', icon: 'shelves', order: 50 })).toEqual({
      name: 'Estantería',
      appProperties: { k: 't', v: '1', i: 'shelves', o: '50' },
    });
  });

  it('un movimiento solo envía el contenedor padre', () => {
    expect(changesToPatch({ parentId: 'c2' })).toEqual({ appProperties: { p: 'c2' } });
    expect(changesToPatch({ parentId: null })).toEqual({ appProperties: { p: null } });
  });

  it('traduce los demás cambios y elimina las etiquetas vacías', () => {
    expect(
      changesToPatch({ name: ' Nuevo ', notes: 'n', quantity: 4, tags: [], deletedAt: null }),
    ).toEqual({
      name: 'Nuevo',
      description: 'n',
      appProperties: { q: '4', g: null, d: null },
    });
  });

  it('rechaza los datos que Drive no admitiría', () => {
    expect(() => containerToFile({ name: '   ', typeId: null })).toThrow('name_required');
    expect(() => containerToFile({ name: 'x'.repeat(201), typeId: null })).toThrow('name_too_long');
    expect(() => itemToFile({ name: 'a', notes: 'x'.repeat(8001) })).toThrow('notes_too_long');
    expect(() => itemToFile({ name: 'a', quantity: 0 })).toThrow('invalid_quantity');
    // 62 «ñ» son 124 bytes: con la clave ya no caben en una propiedad.
    expect(() => itemToFile({ name: 'a', tags: ['ñ'.repeat(62)] })).toThrow('tags_too_long');
    expect(() => itemToFile({ name: 'a', tags: ['ñ'.repeat(61)] })).not.toThrow();
  });
});
