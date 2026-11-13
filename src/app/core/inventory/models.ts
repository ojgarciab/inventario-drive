/** Identificador de entidad: es el id del archivo de Drive que la guarda. */
export type EntityId = string;

export interface ContainerType {
  id: EntityId;
  name: string;
  /** Nombre de un icono de Material Symbols. */
  icon: string;
  order: number;
  /** Identifica a los tipos creados por defecto, para detectar duplicados. */
  slug: string | null;
}

interface BaseEntity {
  id: EntityId;
  name: string;
  notes: string;
  /** Contenedor en el que está; `null` si está en la raíz. */
  parentId: EntityId | null;
  /** Foto destacada, una de las de su galería; `null` si no se ha elegido. */
  photoId: EntityId | null;
  tags: string[];
  createdAt: string;
  modifiedAt: string;
  /** Fecha de envío a la papelera; `null` si no está borrada. */
  deletedAt: string | null;
}

export interface Container extends BaseEntity {
  kind: 'container';
  typeId: EntityId | null;
}

export interface Item extends BaseEntity {
  kind: 'item';
  quantity: number;
}

export type Entity = Container | Item;

/** Fotografía de la galería de un contenedor o de un objeto. */
export interface Photo {
  id: EntityId;
  /** Entidad a la que pertenece. */
  entityId: EntityId;
  createdAt: string;
  /**
   * Giro con el que debe mostrarse, en cuartos de vuelta a la derecha (0–3).
   * El archivo de la imagen no se toca: el giro es solo un metadato.
   */
  rotation: number;
}

export interface ContainerDraft {
  name: string;
  typeId: EntityId | null;
  parentId?: EntityId | null;
  notes?: string;
  tags?: string[];
}

export interface ItemDraft {
  name: string;
  parentId?: EntityId | null;
  quantity?: number;
  notes?: string;
  tags?: string[];
}

/** Cambios parciales sobre una entidad. Solo se envían los campos presentes. */
export interface EntityChanges {
  name?: string;
  notes?: string;
  parentId?: EntityId | null;
  typeId?: EntityId | null;
  quantity?: number;
  tags?: string[];
  photoId?: EntityId | null;
  deletedAt?: string | null;
}

export interface TypeDraft {
  name: string;
  icon: string;
  order: number;
  slug?: string | null;
}

export type TypeChanges = Partial<Pick<ContainerType, 'name' | 'icon' | 'order'>>;

export interface InventorySnapshot {
  types: ContainerType[];
  entities: Entity[];
  photos: Photo[];
  /** Punto desde el que pedir los cambios posteriores a esta carga. */
  changeToken: string;
}

/** Cambios ocurridos en el almacenamiento desde un punto dado. */
export interface InventoryChanges {
  types: ContainerType[];
  entities: Entity[];
  photos: Photo[];
  removedIds: EntityId[];
  /** Punto desde el que pedir los cambios siguientes. */
  nextToken: string;
}

export const NAME_MAX_LENGTH = 200;
/** Drive admite 16 000 caracteres de 2 bytes en `description`; se deja margen. */
export const NOTES_MAX_LENGTH = 8000;

export type InventoryErrorCode =
  | 'name_required'
  | 'name_too_long'
  | 'notes_too_long'
  | 'tags_too_long'
  | 'invalid_quantity'
  | 'not_found'
  | 'invalid_parent'
  | 'cycle'
  | 'not_empty'
  | 'offline'
  | 'invalid_image';

export class InventoryError extends Error {
  constructor(readonly code: InventoryErrorCode) {
    super(code);
    this.name = 'InventoryError';
  }
}

/** Tipos de contenedor que se crean la primera vez que se usa la aplicación. */
export const DEFAULT_TYPES: readonly TypeDraft[] = [
  { slug: 'casa', name: 'Casa', icon: 'home', order: 10 },
  { slug: 'habitacion', name: 'Habitación', icon: 'meeting_room', order: 20 },
  { slug: 'armario', name: 'Armario', icon: 'door_sliding', order: 30 },
  { slug: 'caja', name: 'Caja', icon: 'package_2', order: 40 },
];
