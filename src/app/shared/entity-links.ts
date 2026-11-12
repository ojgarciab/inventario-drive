import { Entity, EntityId } from '../core/inventory/models';

/** Ruta de la pantalla de una entidad. */
export function entityLink(entity: Entity): string[] {
  return [entity.kind === 'container' ? '/c' : '/o', entity.id];
}

/** Ruta de la pantalla de un contenedor; `null` es la raíz. */
export function containerLink(id: EntityId | null): string[] {
  return id ? ['/c', id] : ['/'];
}
