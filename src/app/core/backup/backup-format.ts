import { ContainerType, Entity } from '../inventory/models';

export const BACKUP_FORMAT = 'inventario-hogar';
export const BACKUP_VERSION = 1;
/** Nombre del archivo de datos dentro del ZIP. */
export const BACKUP_DATA_FILE = 'inventario.json';
/** Nombre de cada fotografía dentro del ZIP. */
export const photoFileName = (photoId: string) => `fotos/${photoId}.jpg`;

/** Copia de seguridad de los datos del inventario. */
export interface Backup {
  format: typeof BACKUP_FORMAT;
  version: number;
  exportedAt: string;
  types: ContainerType[];
  /** Todas las entidades, incluidas las de la papelera. */
  entities: BackupEntity[];
}

/** Entidad de una copia: lleva además su galería; `photoId` es la foto destacada. */
export type BackupEntity = Entity & { photoIds: string[] };

export class BackupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackupError';
  }
}

export function toBackup(
  types: ContainerType[],
  entities: BackupEntity[],
  now = new Date(),
): Backup {
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: now.toISOString(),
    types,
    entities,
  };
}

/** Interpreta y valida el texto de una copia; lanza `BackupError` si no sirve. */
export function parseBackup(text: string): Backup {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new BackupError('El archivo no contiene una copia del inventario.');
  }
  if (!isRecord(raw) || raw['format'] !== BACKUP_FORMAT) {
    throw new BackupError('El archivo no contiene una copia del inventario.');
  }
  if (raw['version'] !== BACKUP_VERSION) {
    throw new BackupError('La copia es de una versión de la aplicación que no se puede leer.');
  }
  const types = raw['types'];
  const entities = raw['entities'];
  if (!Array.isArray(types) || !Array.isArray(entities)) {
    throw new BackupError('La copia está incompleta.');
  }
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: text_(raw['exportedAt']),
    types: types.map(readType),
    entities: entities.map(readEntity),
  };
}

function readType(raw: unknown): ContainerType {
  if (!isRecord(raw) || !text_(raw['id']) || !text_(raw['name'])) {
    throw new BackupError('La copia contiene un tipo de contenedor no válido.');
  }
  return {
    id: text_(raw['id']),
    name: text_(raw['name']),
    icon: text_(raw['icon']) || 'category',
    order: Number.isFinite(raw['order']) ? (raw['order'] as number) : 0,
    slug: text_(raw['slug']) || null,
  };
}

function readEntity(raw: unknown): BackupEntity {
  if (!isRecord(raw) || !text_(raw['id']) || !text_(raw['name'])) {
    throw new BackupError('La copia contiene un elemento no válido.');
  }
  const photoId = text_(raw['photoId']) || null;
  // Las copias anteriores a las galerías solo traen la foto destacada.
  const photoIds = Array.isArray(raw['photoIds'])
    ? raw['photoIds'].filter((id): id is string => typeof id === 'string' && id !== '')
    : [];
  if (photoId && !photoIds.includes(photoId)) photoIds.unshift(photoId);
  const base = {
    id: text_(raw['id']),
    name: text_(raw['name']),
    notes: text_(raw['notes']),
    parentId: text_(raw['parentId']) || null,
    photoId,
    photoIds,
    tags: Array.isArray(raw['tags']) ? raw['tags'].filter((tag) => typeof tag === 'string') : [],
    createdAt: text_(raw['createdAt']),
    modifiedAt: text_(raw['modifiedAt']),
    deletedAt: text_(raw['deletedAt']) || null,
  };
  if (raw['kind'] === 'container') {
    return { ...base, kind: 'container', typeId: text_(raw['typeId']) || null };
  }
  if (raw['kind'] === 'item') {
    const quantity = raw['quantity'];
    return {
      ...base,
      kind: 'item',
      quantity: Number.isInteger(quantity) && (quantity as number) > 0 ? (quantity as number) : 1,
    };
  }
  throw new BackupError('La copia contiene un elemento no válido.');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text_(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
