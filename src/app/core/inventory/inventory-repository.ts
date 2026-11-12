import {
  Container,
  ContainerDraft,
  ContainerType,
  Entity,
  EntityChanges,
  EntityId,
  InventoryChanges,
  InventorySnapshot,
  Item,
  ItemDraft,
  TypeChanges,
  TypeDraft,
} from './models';

/**
 * Acceso al almacenamiento del inventario. Es la única capa que conoce dónde
 * y cómo se guardan los datos; el resto de la aplicación trabaja con el modelo.
 */
export abstract class InventoryRepository {
  abstract loadAll(): Promise<InventorySnapshot>;
  /** Cambios hechos desde cualquier dispositivo a partir de `token`. */
  abstract changesSince(token: string): Promise<InventoryChanges>;
  abstract createContainer(draft: ContainerDraft): Promise<Container>;
  abstract createItem(draft: ItemDraft): Promise<Item>;
  /** Aplica cambios parciales; mover es cambiar `parentId`. */
  abstract updateEntity(id: EntityId, changes: EntityChanges): Promise<Entity>;
  /** Elimina definitivamente una entidad. */
  abstract purgeEntity(id: EntityId): Promise<void>;
  abstract createType(draft: TypeDraft): Promise<ContainerType>;
  abstract updateType(id: EntityId, changes: TypeChanges): Promise<ContainerType>;
  abstract deleteType(id: EntityId): Promise<void>;
  /** Guarda una fotografía de la entidad y devuelve su id. */
  abstract uploadPhoto(entityId: EntityId, image: Blob): Promise<EntityId>;
  abstract downloadPhoto(photoId: EntityId): Promise<Blob>;
  abstract deletePhoto(photoId: EntityId): Promise<void>;
}
