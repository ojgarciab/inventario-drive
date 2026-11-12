import { containerToFile, itemToFile, typeToFile } from './drive-mapping';
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
  TypeChanges,
  TypeDraft,
} from './models';

/** Repositorio en memoria, para pruebas y para desarrollar sin cuenta de Google. */
export class InMemoryInventoryRepository extends InventoryRepository {
  private readonly entities = new Map<EntityId, Entity>();
  private readonly types = new Map<EntityId, ContainerType>();
  private readonly photos = new Map<EntityId, Blob>();
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
      changeToken: String(this.log.length),
    };
  }

  async changesSince(token: string): Promise<InventoryChanges> {
    const changes: InventoryChanges = {
      types: [],
      entities: [],
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
      if (entity) changes.entities.push(entity);
      else if (type) changes.types.push(type);
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

  async uploadPhoto(_entityId: EntityId, image: Blob): Promise<EntityId> {
    const id = `mem-${this.nextId++}`;
    this.photos.set(id, image);
    return id;
  }

  async downloadPhoto(photoId: EntityId): Promise<Blob> {
    const image = this.photos.get(photoId);
    if (!image) throw new InventoryError('not_found');
    return image;
  }

  async deletePhoto(photoId: EntityId): Promise<void> {
    this.photos.delete(photoId);
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
