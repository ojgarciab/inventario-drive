import { cleanRotation, containerToFile, itemToFile, typeToFile } from './drive-mapping';
import { InventoryRepository } from './inventory-repository';
import {
  Container,
  ContainerDraft,
  ContainerType,
  Entity,
  EntityChanges,
  EntityId,
  InventoryChanges,
  InventoryError,
  InventorySnapshot,
  Item,
  ItemDraft,
  Photo,
  StorageUsage,
  TypeChanges,
  TypeDraft,
} from './models';

/** Repositorio en memoria, para pruebas y para desarrollar sin cuenta de Google. */
export class InMemoryInventoryRepository extends InventoryRepository {
  private readonly entities = new Map<EntityId, Entity>();
  private readonly types = new Map<EntityId, ContainerType>();
  private readonly photos = new Map<EntityId, { photo: Photo; image: Blob }>();
  private nextId = 1;
  /** Registro de cambios: el token es la posición en esta lista. */
  private readonly log: { id: EntityId }[] = [];

  constructor(initial: Partial<InventorySnapshot> = {}) {
    super();
    for (const entity of initial.entities ?? []) this.entities.set(entity.id, entity);
    for (const type of initial.types ?? []) this.types.set(type.id, type);
  }

  async loadAll(): Promise<InventorySnapshot> {
    return {
      types: [...this.types.values()],
      entities: [...this.entities.values()],
      photos: [...this.photos.values()].map(({ photo }) => photo),
      changeToken: String(this.log.length),
    };
  }

  async storageUsage(): Promise<StorageUsage> {
    let photoBytes = 0;
    for (const { image } of this.photos.values()) photoBytes += image.size;
    return {
      // Como en Drive, lo que solo tiene metadatos no ocupa espacio.
      dataBytes: 0,
      dataFiles: this.entities.size + this.types.size,
      photoBytes,
      photoFiles: this.photos.size,
      account: null,
    };
  }

  async changesSince(token: string): Promise<InventoryChanges> {
    const changes: InventoryChanges = {
      types: [],
      entities: [],
      photos: [],
      removedIds: [],
      nextToken: String(this.log.length),
    };
    // Como en Drive, cada entidad aparece una vez y con su estado actual.
    const seen = new Set<EntityId>();
    for (const { id } of this.log.slice(Number(token)).reverse()) {
      if (seen.has(id)) continue;
      seen.add(id);
      const entity = this.entities.get(id);
      const type = this.types.get(id);
      const photo = this.photos.get(id)?.photo;
      if (entity) changes.entities.push(entity);
      else if (type) changes.types.push(type);
      else if (photo) changes.photos.push(photo);
      else changes.removedIds.push(id);
    }
    return changes;
  }

  async createContainer(draft: ContainerDraft): Promise<Container> {
    const file = containerToFile(draft); // valida igual que el repositorio real
    const container: Container = {
      ...this.base(file.name, file.description, draft),
      kind: 'container',
      typeId: draft.typeId,
    };
    this.entities.set(container.id, container);
    this.record(container.id);
    return container;
  }

  async createItem(draft: ItemDraft): Promise<Item> {
    const file = itemToFile(draft);
    const item: Item = {
      ...this.base(file.name, file.description, draft),
      kind: 'item',
      quantity: draft.quantity ?? 1,
    };
    this.entities.set(item.id, item);
    this.record(item.id);
    return item;
  }

  async updateEntity(id: EntityId, changes: EntityChanges): Promise<Entity> {
    const current = this.entities.get(id);
    if (!current) throw new InventoryError('not_found');
    const updated = {
      ...current,
      ...changes,
      modifiedAt: this.laterThan(current.modifiedAt),
    } as Entity;
    this.entities.set(id, updated);
    this.record(id);
    return updated;
  }

  async purgeEntity(id: EntityId): Promise<void> {
    this.entities.delete(id);
    this.record(id);
  }

  async createType(draft: TypeDraft): Promise<ContainerType> {
    const file = typeToFile(draft);
    const type: ContainerType = {
      id: `mem-${this.nextId++}`,
      name: file.name,
      icon: draft.icon,
      order: draft.order,
      slug: draft.slug ?? null,
    };
    this.types.set(type.id, type);
    this.record(type.id);
    return type;
  }

  async updateType(id: EntityId, changes: TypeChanges): Promise<ContainerType> {
    const current = this.types.get(id);
    if (!current) throw new InventoryError('not_found');
    const updated = { ...current, ...changes };
    this.types.set(id, updated);
    this.record(id);
    return updated;
  }

  async deleteType(id: EntityId): Promise<void> {
    this.types.delete(id);
    this.record(id);
  }

  async uploadPhoto(entityId: EntityId, image: Blob, rotation = 0): Promise<Photo> {
    const photo: Photo = {
      id: `mem-${this.nextId++}`,
      entityId,
      createdAt: new Date().toISOString(),
      rotation: cleanRotation(rotation),
    };
    this.photos.set(photo.id, { photo, image });
    this.record(photo.id);
    return photo;
  }

  async rotatePhoto(photoId: EntityId, rotation: number): Promise<Photo> {
    const stored = this.photos.get(photoId);
    if (!stored) throw new InventoryError('not_found');
    const photo = { ...stored.photo, rotation: cleanRotation(rotation) };
    this.photos.set(photoId, { ...stored, photo });
    this.record(photoId);
    return photo;
  }

  async downloadPhoto(photoId: EntityId): Promise<Blob> {
    const image = this.photos.get(photoId)?.image;
    if (!image) throw new InventoryError('not_found');
    return image;
  }

  async deletePhoto(photoId: EntityId): Promise<void> {
    if (this.photos.delete(photoId)) this.record(photoId);
  }

  /** Marca de tiempo posterior a la dada, aunque el reloj no haya avanzado. */
  private laterThan(previous: string): string {
    return new Date(Math.max(Date.now(), Date.parse(previous) + 1)).toISOString();
  }

  private record(id: EntityId): void {
    this.log.push({ id });
  }

  private base(name: string, notes: string, draft: ContainerDraft | ItemDraft) {
    const now = new Date().toISOString();
    return {
      id: `mem-${this.nextId++}`,
      name,
      notes,
      parentId: draft.parentId ?? null,
      photoId: null,
      tags: draft.tags ?? [],
      createdAt: now,
      modifiedAt: now,
      deletedAt: null,
    };
  }
}
