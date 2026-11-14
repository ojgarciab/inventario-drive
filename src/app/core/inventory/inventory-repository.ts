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
  Photo,
  StorageUsage,
  TypeChanges,
  TypeDraft,
} from './models';

/**
 * Acceso al almacenamiento del inventario. Es la única capa que conoce dónde
 * y cómo se guardan los datos; el resto de la aplicación trabaja con el modelo.
 */
export abstract class InventoryRepository {
  abstract loadAll(): Promise<InventorySnapshot>;
  /** Espacio que ocupa el inventario en el almacenamiento. */
  abstract storageUsage(): Promise<StorageUsage>;
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
  /** Guarda una fotografía más en la galería de la entidad. */
  abstract uploadPhoto(entityId: EntityId, image: Blob, rotation?: number): Promise<Photo>;
  /** Cambia el giro con el que se muestra una foto, sin tocar el archivo de imagen. */
  abstract rotatePhoto(photoId: EntityId, rotation: number): Promise<Photo>;
  abstract downloadPhoto(photoId: EntityId): Promise<Blob>;
  abstract deletePhoto(photoId: EntityId): Promise<void>;
}
