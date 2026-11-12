import { Injectable, computed, inject, signal } from '@angular/core';
import { Connectivity } from '../pwa/connectivity';
import { InventoryRepository } from './inventory-repository';
import {
  Container,
  ContainerDraft,
  ContainerType,
  DEFAULT_TYPES,
  Entity,
  EntityChanges,
  EntityId,
  InventoryError,
  Item,
  ItemDraft,
  Photo,
  TypeChanges,
} from './models';
import {
  canonicalTypes,
  compareEntities,
  descendantIds,
  findUnplaced,
  indexChildren,
  pathTo,
  searchEntities,
  wouldCreateCycle,
} from './tree-utils';

export type StoreStatus = 'idle' | 'loading' | 'ready' | 'error';

const NO_CHILDREN: readonly Entity[] = [];
const NO_PHOTOS: readonly Photo[] = [];
/** Tiempo que una entidad permanece en la papelera antes de eliminarse del todo. */
export const TRASH_RETENTION_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Consultas de cambios fallidas seguidas tras las que se recarga todo el inventario. */
const MAX_SYNC_FAILURES = 3;

/**
 * Estado del inventario. Vive solo en memoria: se carga entero de Drive en
 * cada arranque y nunca se guarda en el dispositivo. Las escrituras esperan
 * la confirmación de Drive antes de reflejarse.
 */
@Injectable({ providedIn: 'root' })
export class InventoryStore {
  private readonly repository = inject(InventoryRepository);
  private readonly connectivity = inject(Connectivity);

  private readonly all = signal<ReadonlyMap<EntityId, Entity>>(new Map());
  private readonly allTypes = signal<readonly ContainerType[]>([]);
  private readonly allPhotos = signal<ReadonlyMap<EntityId, Photo>>(new Map());
  private loading: Promise<void> | null = null;
  private refreshing: Promise<void> | null = null;
  private changeToken: string | null = null;
  private syncFailures = 0;

  readonly status = signal<StoreStatus>('idle');

  /** Entidades no borradas, por id. */
  private readonly active = computed(() => {
    const active = new Map<EntityId, Entity>();
    for (const entity of this.all().values()) if (!entity.deletedAt) active.set(entity.id, entity);
    return active;
  });
  private readonly unplacedIds = computed(() => findUnplaced(this.active()));
  private readonly childIndex = computed(() => indexChildren(this.active(), this.unplacedIds()));
  private readonly typeIndex = computed(() => canonicalTypes(this.allTypes()));
  /** Galería de cada entidad, de la foto más antigua a la más reciente. */
  private readonly photoIndex = computed(() => {
    const index = new Map<EntityId, Photo[]>();
    for (const photo of this.allPhotos().values()) {
      const gallery = index.get(photo.entityId);
      if (gallery) gallery.push(photo);
      else index.set(photo.entityId, [photo]);
    }
    for (const gallery of index.values()) {
      gallery.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    }
    return index;
  });

  /** Tipos de contenedor, ordenados y sin duplicados. */
  readonly types = computed(() => this.typeIndex().types);
  /** Entidades cuyo contenedor no existe o que forman un ciclo. */
  readonly unplaced = computed(() =>
    [...this.unplacedIds()].map((id) => this.active().get(id) as Entity).sort(compareEntities),
  );
  /** Entidades en la papelera, la más reciente primero. */
  readonly trash = computed(() =>
    [...this.all().values()]
      .filter((entity) => entity.deletedAt)
      .sort((a, b) => (b.deletedAt as string).localeCompare(a.deletedAt as string)),
  );
  readonly counts = computed(() => {
    let containers = 0;
    let items = 0;
    for (const entity of this.active().values()) {
      if (entity.kind === 'container') containers++;
      else items++;
    }
    return { containers, items };
  });

  /** Carga el inventario completo. Las llamadas simultáneas comparten la carga. */
  load(): Promise<void> {
    this.loading ??= this.loadOnce().finally(() => (this.loading = null));
    return this.loading;
  }

  private async loadOnce(): Promise<void> {
    this.status.set('loading');
    try {
      const snapshot = await this.repository.loadAll();
      let types = snapshot.types;
      if (types.length === 0) {
        types = [];
        for (const draft of DEFAULT_TYPES) types.push(await this.repository.createType(draft));
      }
      this.all.set(new Map(snapshot.entities.map((entity) => [entity.id, entity])));
      this.allTypes.set(types);
      this.allPhotos.set(new Map(snapshot.photos.map((photo) => [photo.id, photo])));
      this.changeToken = snapshot.changeToken;
      this.syncFailures = 0;
      this.status.set('ready');
      // La limpieza de la papelera no debe impedir usar la aplicación si falla.
      this.purgeExpired().catch(() => undefined);
    } catch (error) {
      this.status.set('error');
      throw error;
    }
  }

  /**
   * Trae los cambios hechos desde otros dispositivos. Los fallos no se
   * propagan: se reintentará en la siguiente consulta, y si se repiten se
   * recarga el inventario entero (el punto de sincronización puede haber caducado).
   */
  refresh(): Promise<void> {
    this.refreshing ??= this.refreshOnce().finally(() => (this.refreshing = null));
    return this.refreshing;
  }

  private async refreshOnce(): Promise<void> {
    if (this.status() !== 'ready' || this.changeToken === null) return;
    try {
      const changes = await this.repository.changesSince(this.changeToken);
      this.applyRemote(changes);
      this.changeToken = changes.nextToken;
      this.syncFailures = 0;
    } catch {
      if (++this.syncFailures >= MAX_SYNC_FAILURES && this.connectivity.online()) {
        this.syncFailures = 0;
        await this.load().catch(() => undefined);
      }
    }
  }

  /** Vacía el almacén, por ejemplo al cerrar la sesión. */
  reset(): void {
    this.changeToken = null;
    this.syncFailures = 0;
    this.all.set(new Map());
    this.allTypes.set([]);
    this.allPhotos.set(new Map());
    this.status.set('idle');
  }

  /** Entidad no borrada con ese id. */
  get(id: EntityId): Entity | undefined {
    return this.active().get(id);
  }

  /** Contenido directo de un contenedor; `null` devuelve la raíz. */
  children(parentId: EntityId | null): readonly Entity[] {
    return this.childIndex().get(parentId) ?? NO_CHILDREN;
  }

  /** Ruta desde la raíz hasta la entidad, ambas incluidas. */
  path(id: EntityId): Entity[] {
    return pathTo(id, this.active(), this.unplacedIds());
  }

  /** Indica si la entidad está entre las que no se pueden colocar en el árbol. */
  isUnplaced(id: EntityId): boolean {
    return this.unplacedIds().has(id);
  }

  /** Ids de todo lo que contiene un contenedor, a cualquier profundidad. */
  descendants(id: EntityId): Set<EntityId> {
    return descendantIds(id, this.childIndex());
  }

  typeOf(container: Container): ContainerType | undefined {
    if (!container.typeId) return undefined;
    const { types, aliases } = this.typeIndex();
    const id = aliases.get(container.typeId) ?? container.typeId;
    return types.find((type) => type.id === id);
  }

  /** Galería de fotos de una entidad, de la más antigua a la más reciente. */
  photosOf(id: EntityId): readonly Photo[] {
    return this.photoIndex().get(id) ?? NO_PHOTOS;
  }

  /**
   * Foto destacada de una entidad: la que se ve primero en su ficha y la que
   * la representa en miniatura. Si no hay ninguna elegida (o la elegida ya
   * no existe), es la primera de su galería.
   */
  featuredPhotoId(id: EntityId): EntityId | null {
    const gallery = this.photosOf(id);
    const chosen = this.all().get(id)?.photoId;
    if (chosen && gallery.some((photo) => photo.id === chosen)) return chosen;
    return gallery[0]?.id ?? null;
  }

  /** Anota una foto ya subida a la galería de su entidad. */
  photoAdded(photo: Photo): void {
    this.allPhotos.set(new Map(this.allPhotos()).set(photo.id, photo));
  }

  /** Anota que una foto se ha borrado. */
  photoRemoved(photoId: EntityId): void {
    const next = new Map(this.allPhotos());
    if (next.delete(photoId)) this.allPhotos.set(next);
  }

  search(query: string): Entity[] {
    return searchEntities(query, this.active().values());
  }

  async addContainer(draft: ContainerDraft): Promise<Container> {
    this.assertOnline();
    this.assertValidParent(draft.parentId ?? null);
    const container = await this.repository.createContainer(draft);
    this.upsert(container);
    return container;
  }

  async addItem(draft: ItemDraft): Promise<Item> {
    this.assertOnline();
    this.assertValidParent(draft.parentId ?? null);
    const item = await this.repository.createItem(draft);
    this.upsert(item);
    return item;
  }

  async update(id: EntityId, changes: EntityChanges): Promise<Entity> {
    this.assertOnline();
    if (!this.all().has(id)) throw new InventoryError('not_found');
    if (changes.parentId !== undefined) {
      this.assertValidParent(changes.parentId);
      if (wouldCreateCycle(id, changes.parentId, this.active())) throw new InventoryError('cycle');
    }
    const updated = await this.repository.updateEntity(id, changes);
    this.upsert(updated);
    return updated;
  }

  /** Traslada una entidad, con todo su contenido, a otro contenedor o a la raíz. */
  move(id: EntityId, parentId: EntityId | null): Promise<Entity> {
    return this.update(id, { parentId });
  }

  /**
   * Envía a la papelera. Un contenedor con contenido solo se borra si se pide
   * `moveContents`: su contenido directo pasa antes al contenedor que lo contenía.
   */
  async remove(id: EntityId, options: { moveContents?: boolean } = {}): Promise<Entity> {
    const entity = this.active().get(id);
    if (!entity) throw new InventoryError('not_found');
    const contents = this.children(id);
    if (contents.length > 0) {
      if (!options.moveContents) throw new InventoryError('not_empty');
      const target = this.isUnplaced(id) ? null : entity.parentId;
      for (const child of contents) await this.update(child.id, { parentId: target });
    }
    return this.update(id, { deletedAt: new Date().toISOString() });
  }

  restore(id: EntityId): Promise<Entity> {
    return this.update(id, { deletedAt: null });
  }

  /** Elimina definitivamente una entidad de la papelera. */
  async purge(id: EntityId): Promise<void> {
    this.assertOnline();
    const photos = this.photosOf(id);
    await this.repository.purgeEntity(id);
    // Las fotos quedan huérfanas sin su entidad; si el borrado falla solo ocupan espacio.
    for (const photo of photos) {
      await this.repository.deletePhoto(photo.id).catch(() => undefined);
      this.photoRemoved(photo.id);
    }
    const next = new Map(this.all());
    next.delete(id);
    this.all.set(next);
  }

  /** Todas las entidades, incluidas las de la papelera (para las copias de seguridad). */
  everything(): Entity[] {
    return [...this.all().values()];
  }

  /** Añade un tipo de contenedor al final de la lista. */
  async addType(draft: {
    name: string;
    icon: string;
    slug?: string | null;
  }): Promise<ContainerType> {
    this.assertOnline();
    const order = Math.max(0, ...this.types().map((type) => type.order)) + 10;
    const type = await this.repository.createType({ ...draft, order });
    this.allTypes.set([...this.allTypes(), type]);
    return type;
  }

  async updateType(id: EntityId, changes: TypeChanges): Promise<ContainerType> {
    this.assertOnline();
    const updated = await this.repository.updateType(id, changes);
    this.allTypes.set(this.allTypes().map((type) => (type.id === id ? updated : type)));
    return updated;
  }

  /** Elimina un tipo. Los contenedores que lo usaban quedan sin tipo. */
  async removeType(id: EntityId): Promise<void> {
    this.assertOnline();
    await this.repository.deleteType(id);
    this.allTypes.set(this.allTypes().filter((type) => type.id !== id));
  }

  /** Sube (-1) o baja (+1) un tipo una posición en la lista. */
  async moveType(id: EntityId, direction: -1 | 1): Promise<void> {
    const ordered = [...this.types()];
    const from = ordered.findIndex((type) => type.id === id);
    const to = from + direction;
    if (from < 0 || to < 0 || to >= ordered.length) return;
    [ordered[from], ordered[to]] = [ordered[to], ordered[from]];
    // Se renumera de diez en diez y solo se guardan los que cambian.
    for (const [index, type] of ordered.entries()) {
      const order = (index + 1) * 10;
      if (type.order !== order) await this.updateType(type.id, { order });
    }
  }

  /**
   * Elimina definitivamente lo que lleva en la papelera más del plazo de
   * retención. Como referencia de «ahora» se usa la modificación más reciente
   * del inventario, que es hora de Drive: un reloj mal puesto en el
   * dispositivo no puede adelantar ningún borrado.
   */
  async purgeExpired(): Promise<number> {
    let newest = 0;
    for (const entity of this.all().values()) {
      newest = Math.max(newest, Date.parse(entity.modifiedAt) || 0);
    }
    const limit = newest - TRASH_RETENTION_DAYS * DAY_MS;
    const expired = this.trash().filter((entity) => Date.parse(entity.modifiedAt) < limit);
    for (const entity of expired) await this.purge(entity.id);
    return expired.length;
  }

  /** Incorpora al estado cambios hechos desde otros dispositivos. */
  applyRemote(changes: {
    entities?: Entity[];
    types?: ContainerType[];
    photos?: Photo[];
    removedIds?: EntityId[];
  }): void {
    const removed = new Set(changes.removedIds ?? []);
    const entities = new Map(this.all());
    for (const id of removed) entities.delete(id);
    for (const entity of changes.entities ?? []) {
      // Una respuesta pedida antes de una escritura propia puede llegar después
      // de ella: nunca se sustituye una versión por otra más antigua.
      const current = entities.get(entity.id);
      if (!current || current.modifiedAt <= entity.modifiedAt) entities.set(entity.id, entity);
    }
    this.all.set(entities);

    const types = new Map(this.allTypes().map((type) => [type.id, type]));
    for (const id of removed) types.delete(id);
    for (const type of changes.types ?? []) types.set(type.id, type);
    this.allTypes.set([...types.values()]);

    const photos = new Map(this.allPhotos());
    for (const id of removed) photos.delete(id);
    for (const photo of changes.photos ?? []) photos.set(photo.id, photo);
    this.allPhotos.set(photos);
  }

  /** Sin conexión se falla al momento, en lugar de esperar a los reintentos de red. */
  private assertOnline(): void {
    if (!this.connectivity.online()) throw new InventoryError('offline');
  }

  private assertValidParent(parentId: EntityId | null): void {
    if (parentId === null) return;
    if (this.active().get(parentId)?.kind !== 'container') {
      throw new InventoryError('invalid_parent');
    }
  }

  private upsert(entity: Entity): void {
    this.all.set(new Map(this.all()).set(entity.id, entity));
  }
}
