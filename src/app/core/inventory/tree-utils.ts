import { ContainerType, Entity, EntityId } from './models';

export type EntityMap = ReadonlyMap<EntityId, Entity>;

const collator = new Intl.Collator('es', { sensitivity: 'base', numeric: true });

/** Contenedores primero y, dentro de cada grupo, por nombre. */
export function compareEntities(a: Entity, b: Entity): number {
  if (a.kind !== b.kind) return a.kind === 'container' ? -1 : 1;
  return collator.compare(a.name, b.name) || a.id.localeCompare(b.id);
}

/**
 * Entidades que no se pueden colocar en el árbol: su padre no existe, no es
 * un contenedor, o forman parte de un ciclo (posible si dos dispositivos
 * mueven a la vez un contenedor dentro del otro).
 */
export function findUnplaced(entities: EntityMap): Set<EntityId> {
  const unplaced = new Set<EntityId>();
  for (const entity of entities.values()) {
    if (entity.parentId === null) continue;
    const parent = entities.get(entity.parentId);
    if (!parent || parent.kind !== 'container' || isInCycle(entity, entities)) {
      unplaced.add(entity.id);
    }
  }
  return unplaced;
}

function isInCycle(entity: Entity, entities: EntityMap): boolean {
  let current = entity.parentId;
  for (let steps = 0; current !== null && steps <= entities.size; steps++) {
    if (current === entity.id) return true;
    current = entities.get(current)?.parentId ?? null;
  }
  return false;
}

/** Índice de hijos por contenedor; la clave `null` reúne los de la raíz. */
export function indexChildren(
  entities: EntityMap,
  unplaced: ReadonlySet<EntityId>,
): Map<EntityId | null, Entity[]> {
  const index = new Map<EntityId | null, Entity[]>();
  for (const entity of entities.values()) {
    if (unplaced.has(entity.id)) continue;
    const siblings = index.get(entity.parentId);
    if (siblings) siblings.push(entity);
    else index.set(entity.parentId, [entity]);
  }
  for (const siblings of index.values()) siblings.sort(compareEntities);
  return index;
}

/** Ruta desde la raíz hasta la entidad, ambas incluidas. */
export function pathTo(
  id: EntityId,
  entities: EntityMap,
  unplaced: ReadonlySet<EntityId>,
): Entity[] {
  const path: Entity[] = [];
  let current = entities.get(id);
  while (current && path.length <= entities.size) {
    path.unshift(current);
    if (current.parentId === null || unplaced.has(current.id)) break;
    current = entities.get(current.parentId);
  }
  return path;
}

/** Ids de todo lo que hay dentro de un contenedor, a cualquier profundidad. */
export function descendantIds(
  id: EntityId,
  children: ReadonlyMap<EntityId | null, Entity[]>,
): Set<EntityId> {
  const found = new Set<EntityId>();
  const pending = [id];
  while (pending.length > 0) {
    for (const child of children.get(pending.pop() as EntityId) ?? []) {
      if (!found.has(child.id)) {
        found.add(child.id);
        pending.push(child.id);
      }
    }
  }
  return found;
}

/** Indica si mover `id` dentro de `targetId` lo metería dentro de sí mismo. */
export function wouldCreateCycle(
  id: EntityId,
  targetId: EntityId | null,
  entities: EntityMap,
): boolean {
  let current = targetId;
  for (let steps = 0; current !== null && steps <= entities.size; steps++) {
    if (current === id) return true;
    current = entities.get(current)?.parentId ?? null;
  }
  return false;
}

/** Texto en minúsculas y sin acentos, para comparar en las búsquedas. */
export function normalizeText(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/**
 * Devuelve las entidades cuyo nombre, notas o etiquetas contienen todas las
 * palabras. Primero las que coinciden por el nombre, que es lo que se suele buscar.
 */
export function searchEntities(query: string, entities: Iterable<Entity>): Entity[] {
  const words = normalizeText(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const byName: Entity[] = [];
  const byRest: Entity[] = [];
  for (const entity of entities) {
    const name = normalizeText(entity.name);
    if (words.every((word) => name.includes(word))) {
      byName.push(entity);
      continue;
    }
    const haystack = `${name}\n${normalizeText(`${entity.notes}\n${entity.tags.join('\n')}`)}`;
    if (words.every((word) => haystack.includes(word))) byRest.push(entity);
  }
  return [...byName.sort(compareEntities), ...byRest.sort(compareEntities)];
}

/** Etiqueta en uso y cuántos contenedores y objetos la llevan. */
export interface TagCount {
  tag: string;
  count: number;
}

/**
 * Etiquetas en uso, de la más usada a la menos (a igualdad, por orden
 * alfabético). Las que solo difieren en mayúsculas o acentos cuentan como
 * una, igual que en la búsqueda; se muestra la grafía más frecuente.
 */
export function countTags(entities: Iterable<Entity>): TagCount[] {
  const groups = new Map<string, { count: number; spellings: Map<string, number> }>();
  for (const entity of entities) {
    const seen = new Set<string>();
    for (const tag of entity.tags) {
      const key = normalizeText(tag);
      if (!key) continue;
      let group = groups.get(key);
      if (!group) groups.set(key, (group = { count: 0, spellings: new Map() }));
      group.spellings.set(tag, (group.spellings.get(tag) ?? 0) + 1);
      // Un elemento cuenta una vez aunque repita la etiqueta con otra grafía.
      if (!seen.has(key)) group.count++;
      seen.add(key);
    }
  }
  return [...groups.values()]
    .map(({ count, spellings }) => ({
      tag: [...spellings].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'es'))[0][0],
      count,
    }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, 'es'));
}

/**
 * Ordena los tipos y funde los tipos por defecto duplicados (dos dispositivos
 * pueden crearlos a la vez en el primer arranque). Gana siempre el mismo en
 * todos los dispositivos; `aliases` traduce los ids descartados.
 */
export function canonicalTypes(types: readonly ContainerType[]): {
  types: ContainerType[];
  aliases: Map<EntityId, EntityId>;
} {
  const bySlug = new Map<string, ContainerType>();
  const aliases = new Map<EntityId, EntityId>();
  const kept: ContainerType[] = [];
  for (const type of [...types].sort((a, b) => a.id.localeCompare(b.id))) {
    const winner = type.slug ? bySlug.get(type.slug) : undefined;
    if (winner) {
      aliases.set(type.id, winner.id);
    } else {
      if (type.slug) bySlug.set(type.slug, type);
      kept.push(type);
    }
  }
  kept.sort((a, b) => a.order - b.order || collator.compare(a.name, b.name));
  return { types: kept, aliases };
}
