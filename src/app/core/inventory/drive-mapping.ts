import { DriveFile, DriveFilePatch } from '../drive/drive-api';
import {
  ContainerDraft,
  ContainerType,
  Entity,
  EntityChanges,
  InventoryError,
  ItemDraft,
  NAME_MAX_LENGTH,
  NOTES_MAX_LENGTH,
  Photo,
  TypeChanges,
  TypeDraft,
} from './models';

// Formato de almacenamiento: cada entidad es un archivo sin contenido cuyos
// datos van en `name`, `description` y `appProperties`. Las claves son de una
// letra porque Drive limita cada propiedad a 124 bytes (clave + valor).
//
//   k  clase: c = contenedor, o = objeto, t = tipo de contenedor, f = foto
//   p  id del contenedor padre (ausente = raíz)
//   t  id del tipo de contenedor
//   q  cantidad (objetos)
//   f  id del archivo de la foto destacada
//   g  etiquetas separadas por comas
//   d  fecha de borrado lógico
//   i  icono (tipos)     o  orden (tipos)     s  identificador de tipo por defecto
//   v  versión del esquema

const SCHEMA_VERSION = '1';
const PROPERTY_MAX_BYTES = 124;
const encoder = new TextEncoder();

type Properties = Record<string, string>;
type PropertyPatch = Record<string, string | null>;

export function fileToEntity(file: DriveFile): Entity | null {
  const props = file.appProperties ?? {};
  const kind = props['k'];
  if (kind !== 'c' && kind !== 'o') return null;
  const base = {
    id: file.id,
    name: file.name,
    notes: file.description ?? '',
    parentId: props['p'] ?? null,
    photoId: props['f'] ?? null,
    tags: splitTags(props['g']),
    createdAt: file.createdTime,
    modifiedAt: file.modifiedTime,
    deletedAt: props['d'] ?? null,
  };
  if (kind === 'c') return { ...base, kind: 'container', typeId: props['t'] ?? null };
  const quantity = Number(props['q']);
  return {
    ...base,
    kind: 'item',
    quantity: Number.isInteger(quantity) && quantity > 0 ? quantity : 1,
  };
}

export function fileToType(file: DriveFile): ContainerType | null {
  const props = file.appProperties ?? {};
  if (props['k'] !== 't') return null;
  const order = Number(props['o']);
  return {
    id: file.id,
    name: file.name,
    icon: props['i'] ?? 'category',
    order: Number.isFinite(order) ? order : 0,
    slug: props['s'] ?? null,
  };
}

/** Las fotos de una entidad son los archivos `k = f` cuyo `p` apunta a ella. */
export function fileToPhoto(file: DriveFile): Photo | null {
  const props = file.appProperties ?? {};
  if (props['k'] !== 'f' || !props['p']) return null;
  return {
    id: file.id,
    entityId: props['p'],
    createdAt: file.createdTime,
    rotation: cleanRotation(Number(props['r'])),
  };
}

export function containerToFile(draft: ContainerDraft) {
  const appProperties: Properties = { k: 'c', v: SCHEMA_VERSION };
  setIfPresent(appProperties, 'p', draft.parentId);
  setIfPresent(appProperties, 't', draft.typeId);
  setIfPresent(appProperties, 'g', joinTags(draft.tags));
  return { name: cleanName(draft.name), description: cleanNotes(draft.notes), appProperties };
}

export function itemToFile(draft: ItemDraft) {
  const appProperties: Properties = {
    k: 'o',
    v: SCHEMA_VERSION,
    q: String(cleanQuantity(draft.quantity ?? 1)),
  };
  setIfPresent(appProperties, 'p', draft.parentId);
  setIfPresent(appProperties, 'g', joinTags(draft.tags));
  return { name: cleanName(draft.name), description: cleanNotes(draft.notes), appProperties };
}

export function typeToFile(draft: TypeDraft) {
  const appProperties: Properties = {
    k: 't',
    v: SCHEMA_VERSION,
    i: property('i', draft.icon),
    o: String(draft.order),
  };
  setIfPresent(appProperties, 's', draft.slug);
  return { name: cleanName(draft.name), appProperties };
}

/**
 * Metadatos del archivo de una fotografía; `p` es la entidad a la que
 * pertenece y `r`, el giro con el que se muestra (ausente si no está girada).
 */
export function photoToFile(entityId: string, rotation = 0) {
  const appProperties: Properties = { k: 'f', v: SCHEMA_VERSION, p: entityId };
  const turns = cleanRotation(rotation);
  if (turns !== 0) appProperties['r'] = String(turns);
  return { name: `foto-${entityId}.jpg`, appProperties };
}

/** PATCH que cambia solo el giro de una fotografía; el archivo de imagen no se toca. */
export function photoRotationPatch(rotation: number): DriveFilePatch {
  const turns = cleanRotation(rotation);
  return { appProperties: { r: turns === 0 ? null : String(turns) } };
}

/** Cuartos de vuelta a la derecha equivalentes, entre 0 y 3. */
export function cleanRotation(rotation: number): number {
  return Number.isFinite(rotation) ? ((Math.round(rotation) % 4) + 4) % 4 : 0;
}

/** Traduce cambios parciales a un PATCH: solo viajan los campos presentes. */
export function changesToPatch(changes: EntityChanges): DriveFilePatch {
  const patch: DriveFilePatch = {};
  const props: PropertyPatch = {};
  if (changes.name !== undefined) patch.name = cleanName(changes.name);
  if (changes.notes !== undefined) patch.description = cleanNotes(changes.notes);
  if (changes.parentId !== undefined) props['p'] = changes.parentId;
  if (changes.typeId !== undefined) props['t'] = changes.typeId;
  if (changes.photoId !== undefined) props['f'] = changes.photoId;
  if (changes.deletedAt !== undefined) props['d'] = changes.deletedAt;
  if (changes.quantity !== undefined) props['q'] = String(cleanQuantity(changes.quantity));
  if (changes.tags !== undefined) props['g'] = joinTags(changes.tags);
  if (Object.keys(props).length > 0) patch.appProperties = props;
  return patch;
}

export function typeChangesToPatch(changes: TypeChanges): DriveFilePatch {
  const patch: DriveFilePatch = {};
  const props: PropertyPatch = {};
  if (changes.name !== undefined) patch.name = cleanName(changes.name);
  if (changes.icon !== undefined) props['i'] = property('i', changes.icon);
  if (changes.order !== undefined) props['o'] = String(changes.order);
  if (Object.keys(props).length > 0) patch.appProperties = props;
  return patch;
}

function cleanName(name: string): string {
  const clean = name.trim();
  if (!clean) throw new InventoryError('name_required');
  if (clean.length > NAME_MAX_LENGTH) throw new InventoryError('name_too_long');
  return clean;
}

function cleanNotes(notes: string | undefined): string {
  const clean = (notes ?? '').trim();
  if (clean.length > NOTES_MAX_LENGTH) throw new InventoryError('notes_too_long');
  return clean;
}

function cleanQuantity(quantity: number): number {
  if (!Number.isInteger(quantity) || quantity < 1) throw new InventoryError('invalid_quantity');
  return quantity;
}

function splitTags(value: string | undefined): string[] {
  return value ? value.split(',').filter(Boolean) : [];
}

/** Normaliza las etiquetas y las une; `null` si no queda ninguna. */
function joinTags(tags: string[] | undefined): string | null {
  const clean = [
    ...new Set((tags ?? []).map((tag) => tag.replaceAll(',', ' ').trim()).filter(Boolean)),
  ];
  if (clean.length === 0) return null;
  const joined = clean.join(',');
  if (bytes('g') + bytes(joined) > PROPERTY_MAX_BYTES) throw new InventoryError('tags_too_long');
  return joined;
}

function property(key: string, value: string): string {
  if (bytes(key) + bytes(value) > PROPERTY_MAX_BYTES) throw new InventoryError('name_too_long');
  return value;
}

function setIfPresent(props: Properties, key: string, value: string | null | undefined): void {
  if (value) props[key] = value;
}

function bytes(text: string): number {
  return encoder.encode(text).length;
}
