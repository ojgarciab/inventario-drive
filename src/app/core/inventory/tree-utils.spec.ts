import { Container, ContainerType, Entity, Item } from './models';
import {
  canonicalTypes,
  descendantIds,
  findUnplaced,
  indexChildren,
  pathTo,
  searchEntities,
  wouldCreateCycle,
} from './tree-utils';

const base = { notes: '', photoId: null, tags: [], createdAt: '', modifiedAt: '', deletedAt: null };
const box = (id: string, parentId: string | null, name = id): Container => ({
  ...base,
  kind: 'container',
  id,
  name,
  parentId,
  typeId: null,
});
const thing = (id: string, parentId: string | null, extra: Partial<Item> = {}): Item => ({
  ...base,
  kind: 'item',
  id,
  name: id,
  parentId,
  quantity: 1,
  ...extra,
});
const mapOf = (...entities: Entity[]) => new Map(entities.map((e) => [e.id, e]));

// casa > dormitorio > armario > caja > adornos ; armario > maleta
const tree = mapOf(
  box('casa', null),
  box('dormitorio', 'casa'),
  box('armario', 'dormitorio'),
  box('caja', 'armario'),
  thing('adornos', 'caja'),
  thing('maleta', 'armario'),
);

describe('utilidades de árbol', () => {
  it('no marca nada como sin ubicar en un árbol correcto', () => {
    expect(findUnplaced(tree).size).toBe(0);
  });

  it('marca como sin ubicar lo que cuelga de un padre inexistente o de un objeto', () => {
    const entities = mapOf(box('a', 'fantasma'), thing('o', null), thing('x', 'o'), box('b', 'a'));
    expect([...findUnplaced(entities)].sort()).toEqual(['a', 'x']);
  });

  it('marca como sin ubicar a los miembros de un ciclo, no a lo que contienen', () => {
    const entities = mapOf(box('a', 'b'), box('b', 'a'), thing('dentro', 'a'));
    expect([...findUnplaced(entities)].sort()).toEqual(['a', 'b']);
  });

  it('indexa los hijos con los contenedores primero y por nombre', () => {
    const entities = mapOf(
      box('r', null),
      thing('zapato', 'r'),
      box('c2', 'r', 'Caja 10'),
      box('c1', 'r', 'caja 2'),
      thing('Álbum', 'r'),
    );
    const children = indexChildren(entities, new Set());
    expect(children.get('r')?.map((e) => e.name)).toEqual(['caja 2', 'Caja 10', 'Álbum', 'zapato']);
    expect(children.get(null)?.map((e) => e.id)).toEqual(['r']);
  });

  it('calcula la ruta completa hasta un objeto', () => {
    const path = pathTo('adornos', tree, new Set());
    expect(path.map((e) => e.id)).toEqual(['casa', 'dormitorio', 'armario', 'caja', 'adornos']);
  });

  it('corta la ruta en una entidad sin ubicar y no se cuelga con ciclos', () => {
    const entities = mapOf(box('a', 'b'), box('b', 'a'), thing('dentro', 'a'));
    const path = pathTo('dentro', entities, findUnplaced(entities));
    expect(path.map((e) => e.id)).toEqual(['a', 'dentro']);
  });

  it('obtiene todos los descendientes de un contenedor', () => {
    const children = indexChildren(tree, new Set());
    expect([...descendantIds('dormitorio', children)].sort()).toEqual([
      'adornos',
      'armario',
      'caja',
      'maleta',
    ]);
    expect(descendantIds('adornos', children).size).toBe(0);
  });

  it('detecta los movimientos que meterían un contenedor dentro de sí mismo', () => {
    expect(wouldCreateCycle('dormitorio', 'dormitorio', tree)).toBe(true);
    expect(wouldCreateCycle('dormitorio', 'caja', tree)).toBe(true);
    expect(wouldCreateCycle('caja', 'dormitorio', tree)).toBe(false);
    expect(wouldCreateCycle('caja', null, tree)).toBe(false);
  });

  it('busca sin distinguir mayúsculas ni acentos, en nombre, notas y etiquetas', () => {
    const entities = [
      thing('1', null, { name: 'Árbol de Navidad' }),
      thing('2', null, { name: 'Bolas', notes: 'para el arbol' }),
      thing('3', null, { name: 'Luces', tags: ['navidad'] }),
      thing('4', null, { name: 'Taladro' }),
    ];
    expect(searchEntities('ARBOL', entities).map((e) => e.id)).toEqual(['1', '2']);
    expect(searchEntities('navidad', entities).map((e) => e.id)).toEqual(['1', '3']);
    expect(searchEntities('arbol navidad', entities).map((e) => e.id)).toEqual(['1']);
    expect(searchEntities('   ', entities)).toEqual([]);
  });

  it('ordena los tipos y funde los tipos por defecto duplicados', () => {
    const type = (id: string, order: number, slug: string | null): ContainerType => ({
      id,
      name: id,
      icon: 'x',
      order,
      slug,
    });
    const { types, aliases } = canonicalTypes([
      type('z-caja', 40, 'caja'),
      type('b-casa', 10, 'casa'),
      type('a-caja', 40, 'caja'),
      type('propio', 5, null),
      type('otro', 5, null),
    ]);
    expect(types.map((t) => t.id)).toEqual(['otro', 'propio', 'b-casa', 'a-caja']);
    expect([...aliases]).toEqual([['z-caja', 'a-caja']]);
  });
});
