import { Injectable, inject } from '@angular/core';
import { InventoryStore } from '../inventory/inventory-store';
import { Container, Entity, EntityId, Item } from '../inventory/models';
import { normalizeText } from '../inventory/tree-utils';
import { PhotoService } from '../photos/photo-service';
import {
  BACKUP_DATA_FILE,
  Backup,
  BackupError,
  parseBackup,
  photoFileName,
  toBackup,
} from './backup-format';
import { ZipEntry, createZip, readZip } from './zip';

/** Avance de una operación larga: cuántos pasos lleva y cuántos son. */
export type Progress = (done: number, total: number) => void;

/** Copia leída de un archivo, lista para importar. */
export interface LoadedBackup {
  backup: Backup;
  /** Fotografías que traía el ZIP, por nombre de archivo. */
  photos: Map<string, Uint8Array>;
  /** Lo que se importaría: la papelera de la copia no se restaura. */
  summary: { containers: number; items: number; photos: number };
}

export interface ImportResult {
  containers: number;
  items: number;
  photos: number;
  /** Fotografías que no se pudieron subir; sus elementos sí se han creado. */
  failedPhotos: number;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Exportación e importación de copias de seguridad del inventario. */
@Injectable({ providedIn: 'root' })
export class BackupService {
  private readonly store = inject(InventoryStore);
  private readonly photos = inject(PhotoService);

  /** Todos los datos del inventario, incluida la papelera. */
  snapshot(): Backup {
    // Se guarda el tipo tal y como se ve en la aplicación (sin duplicados).
    const entities = this.store.everything().map((entity): Entity => {
      if (entity.kind !== 'container') return entity;
      return { ...entity, typeId: this.store.typeOf(entity)?.id ?? null };
    });
    return toBackup(this.store.types(), entities);
  }

  /** Copia de los datos, como archivo JSON. */
  exportJson(): Blob {
    return new Blob([JSON.stringify(this.snapshot(), null, 2)], { type: 'application/json' });
  }

  /**
   * Copia completa, como archivo ZIP: los datos (`inventario.json`) y todas
   * las fotografías (`fotos/<id>.jpg`). Si alguna foto no se puede obtener,
   * la exportación falla en lugar de dar por buena una copia incompleta.
   */
  async exportZip(progress?: Progress): Promise<Blob> {
    const backup = this.snapshot();
    const photoIds = [
      ...new Set(backup.entities.map((entity) => entity.photoId).filter((id) => id !== null)),
    ];
    const entries: ZipEntry[] = [
      { name: BACKUP_DATA_FILE, data: encoder.encode(JSON.stringify(backup, null, 2)) },
    ];
    progress?.(0, photoIds.length);
    for (const [index, photoId] of photoIds.entries()) {
      const image = await this.photos.blob(photoId);
      entries.push({
        name: photoFileName(photoId),
        data: new Uint8Array(await image.arrayBuffer()),
      });
      progress?.(index + 1, photoIds.length);
    }
    return new Blob([createZip(entries) as BlobPart], { type: 'application/zip' });
  }

  /** Lee una copia de un archivo `.json` o `.zip` sin importar nada todavía. */
  async read(file: Blob): Promise<LoadedBackup> {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b; // «PK»
    let photos = new Map<string, Uint8Array>();
    let text: string;
    if (isZip) {
      try {
        photos = await readZip(bytes);
      } catch {
        throw new BackupError('No se ha podido leer el archivo ZIP.');
      }
      const data = photos.get(BACKUP_DATA_FILE);
      if (!data) throw new BackupError('El ZIP no contiene los datos del inventario.');
      text = decoder.decode(data);
    } else {
      text = decoder.decode(bytes);
    }
    const backup = parseBackup(text);
    const live = backup.entities.filter((entity) => !entity.deletedAt);
    return {
      backup,
      photos,
      summary: {
        containers: live.filter((entity) => entity.kind === 'container').length,
        items: live.filter((entity) => entity.kind === 'item').length,
        photos: live.filter((e) => e.photoId && photos.has(photoFileName(e.photoId))).length,
      },
    };
  }

  /**
   * Añade al inventario lo que contiene la copia, sin borrar ni modificar
   * nada de lo que ya hay. Los tipos se reutilizan si ya existe uno igual.
   */
  async import({ backup, photos }: LoadedBackup, progress?: Progress): Promise<ImportResult> {
    const live = backup.entities.filter((entity) => !entity.deletedAt);
    const containers = parentsFirst(live.filter((e): e is Container => e.kind === 'container'));
    const items = live.filter((e): e is Item => e.kind === 'item');
    const withPhoto = live.filter((e) => e.photoId && photos.has(photoFileName(e.photoId)));
    const total = containers.length + items.length + withPhoto.length;
    let done = 0;
    const step = () => progress?.(++done, total);
    progress?.(0, total);

    const typeIds = await this.importTypes(backup);
    const newIds = new Map<EntityId, EntityId>();
    const parentOf = (entity: Entity) => (entity.parentId && newIds.get(entity.parentId)) || null;

    for (const container of containers) {
      const created = await this.store.addContainer({
        name: container.name,
        notes: container.notes,
        tags: container.tags,
        typeId: (container.typeId && typeIds.get(container.typeId)) || null,
        parentId: parentOf(container),
      });
      newIds.set(container.id, created.id);
      step();
    }
    for (const item of items) {
      const created = await this.store.addItem({
        name: item.name,
        notes: item.notes,
        tags: item.tags,
        quantity: item.quantity,
        parentId: parentOf(item),
      });
      newIds.set(item.id, created.id);
      step();
    }

    let failedPhotos = 0;
    for (const entity of withPhoto) {
      const data = photos.get(photoFileName(entity.photoId as string)) as Uint8Array;
      try {
        await this.photos.attachStored(
          newIds.get(entity.id) as EntityId,
          new Blob([data as BlobPart], { type: 'image/jpeg' }),
        );
      } catch {
        failedPhotos++;
      }
      step();
    }
    return {
      containers: containers.length,
      items: items.length,
      photos: withPhoto.length - failedPhotos,
      failedPhotos,
    };
  }

  /** Empareja los tipos de la copia con los existentes y crea los que falten. */
  private async importTypes(backup: Backup): Promise<Map<EntityId, EntityId>> {
    const used = new Set(
      backup.entities.map((e) => (e.kind === 'container' && !e.deletedAt ? e.typeId : null)),
    );
    const ids = new Map<EntityId, EntityId>();
    for (const type of backup.types) {
      if (!used.has(type.id)) continue;
      const existing = this.store
        .types()
        .find(
          (t) =>
            (type.slug !== null && t.slug === type.slug) ||
            normalizeText(t.name) === normalizeText(type.name),
        );
      const target =
        existing ??
        (await this.store.addType({ name: type.name, icon: type.icon, slug: type.slug }));
      ids.set(type.id, target.id);
    }
    return ids;
  }
}

/**
 * Ordena los contenedores de modo que cada uno vaya después del que lo
 * contiene. Los que no cuelgan de ningún otro de la copia (o forman un
 * ciclo) se tratan como raíces.
 */
function parentsFirst(containers: Container[]): Container[] {
  const ids = new Set(containers.map((container) => container.id));
  const children = new Map<EntityId | null, Container[]>();
  for (const container of containers) {
    const parent = container.parentId && ids.has(container.parentId) ? container.parentId : null;
    children.set(parent, [...(children.get(parent) ?? []), container]);
  }
  const ordered: Container[] = [];
  const placed = new Set<EntityId>();
  const pending = [...(children.get(null) ?? [])];
  while (pending.length > 0) {
    const container = pending.shift() as Container;
    if (placed.has(container.id)) continue;
    placed.add(container.id);
    ordered.push(container);
    pending.push(...(children.get(container.id) ?? []));
  }
  // Lo que queda solo puede ser un ciclo. Se importa igualmente: el primero
  // irá a la raíz (su padre aún no existe) y los demás, dentro de él.
  return [...ordered, ...containers.filter((container) => !placed.has(container.id))];
}
