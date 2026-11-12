import { Injectable, inject } from '@angular/core';
import { InventoryRepository } from '../inventory/inventory-repository';
import { InventoryStore } from '../inventory/inventory-store';
import { EntityId, InventoryError, Photo } from '../inventory/models';
import { Connectivity } from '../pwa/connectivity';
import { IMAGE_RESIZER } from './image-resizer';

const CACHE_NAME = 'inventario-fotos';
const cacheKey = (photoId: EntityId) => `/__fotos__/${encodeURIComponent(photoId)}`;

/**
 * Fotografías de contenedores y objetos: cada uno tiene una galería y una de
 * sus fotos es la destacada. Cada foto es un archivo de Drive inmutable, así
 * que se guarda en la
 * caché del dispositivo sin caducidad: una foto ya vista no se vuelve a
 * descargar. Es lo único del inventario que se conserva en local.
 */
@Injectable({ providedIn: 'root' })
export class PhotoService {
  private readonly repository = inject(InventoryRepository);
  private readonly store = inject(InventoryStore);
  private readonly connectivity = inject(Connectivity);
  private readonly resize = inject(IMAGE_RESIZER);

  /** Direcciones locales de las fotos ya cargadas en esta sesión. */
  private readonly urls = new Map<EntityId, Promise<string>>();

  /** Dirección local (`blob:`) con la que mostrar la foto. */
  objectUrl(photoId: EntityId): Promise<string> {
    let url = this.urls.get(photoId);
    if (!url) {
      url = this.load(photoId).then((image) => URL.createObjectURL(image));
      // Un fallo no se recuerda: se podrá reintentar.
      url.catch(() => this.urls.delete(photoId));
      this.urls.set(photoId, url);
    }
    return url;
  }

  /** Contenido de la foto, de la caché del dispositivo o descargado. */
  blob(photoId: EntityId): Promise<Blob> {
    return this.load(photoId);
  }

  /** Añade una foto a la galería de la entidad. La primera queda como destacada. */
  async attach(entityId: EntityId, image: Blob): Promise<Photo> {
    if (!this.store.get(entityId)) throw new InventoryError('not_found');
    this.assertOnline();
    let resized: Blob;
    try {
      resized = await this.resize(image);
    } catch {
      throw new InventoryError('invalid_image');
    }
    return this.attachStored(entityId, resized);
  }

  /**
   * Añade una foto ya reducida (por ejemplo, de una copia de seguridad) tal
   * cual. Queda como destacada si se pide o si la entidad no tenía ninguna.
   */
  async attachStored(entityId: EntityId, image: Blob, featured = false): Promise<Photo> {
    if (!this.store.get(entityId)) throw new InventoryError('not_found');
    this.assertOnline();
    const photo = await this.repository.uploadPhoto(entityId, image);
    if (featured || this.store.featuredPhotoId(entityId) === null) {
      try {
        await this.store.update(entityId, { photoId: photo.id });
      } catch (error) {
        // La entidad no llegó a apuntar a la foto: no se deja el archivo suelto.
        await this.repository.deletePhoto(photo.id).catch(() => undefined);
        throw error;
      }
    }
    this.store.photoAdded(photo);
    await this.remember(photo.id, image);
    return photo;
  }

  /** Elige cuál de las fotos de la galería es la destacada. */
  async feature(entityId: EntityId, photoId: EntityId): Promise<void> {
    if (!this.store.photosOf(entityId).some((photo) => photo.id === photoId)) {
      throw new InventoryError('not_found');
    }
    await this.store.update(entityId, { photoId });
  }

  /** Borra una foto de la galería. Si era la destacada, pasa a serlo la siguiente. */
  async remove(entityId: EntityId, photoId: EntityId): Promise<void> {
    const gallery = this.store.photosOf(entityId);
    if (!gallery.some((photo) => photo.id === photoId)) return;
    const entity = this.store.get(entityId);
    if (entity && (entity.photoId === photoId || !entity.photoId)) {
      const next = gallery.find((photo) => photo.id !== photoId)?.id ?? null;
      if (next !== entity.photoId) await this.store.update(entityId, { photoId: next });
    } else {
      this.assertOnline();
    }
    this.store.photoRemoved(photoId);
    await this.discard(photoId);
  }

  /** Borra las fotos guardadas en este dispositivo, por ejemplo al cerrar sesión. */
  async clearCache(): Promise<void> {
    for (const url of this.urls.values()) url.then(URL.revokeObjectURL, () => undefined);
    this.urls.clear();
    try {
      await caches.delete(CACHE_NAME);
    } catch {
      // Sin caché disponible no hay nada que borrar.
    }
  }

  private async load(photoId: EntityId): Promise<Blob> {
    const cached = await this.readCache(photoId);
    if (cached) return cached;
    const image = await this.repository.downloadPhoto(photoId);
    await this.writeCache(photoId, image);
    return image;
  }

  /** Deja disponible una foto recién subida sin tener que descargarla. */
  private async remember(photoId: EntityId, image: Blob): Promise<void> {
    this.urls.set(photoId, Promise.resolve(URL.createObjectURL(image)));
    await this.writeCache(photoId, image);
  }

  /** Borra una foto que ya no usa ninguna entidad. Si falla, solo ocupa espacio. */
  private async discard(photoId: EntityId): Promise<void> {
    this.urls.get(photoId)?.then(URL.revokeObjectURL, () => undefined);
    this.urls.delete(photoId);
    try {
      await (await caches.open(CACHE_NAME)).delete(cacheKey(photoId));
    } catch {
      // La caché es una optimización.
    }
    await this.repository.deletePhoto(photoId).catch(() => undefined);
  }

  private async readCache(photoId: EntityId): Promise<Blob | null> {
    try {
      const response = await (await caches.open(CACHE_NAME)).match(cacheKey(photoId));
      return response ? await response.blob() : null;
    } catch {
      return null;
    }
  }

  private async writeCache(photoId: EntityId, image: Blob): Promise<void> {
    try {
      await (await caches.open(CACHE_NAME)).put(cacheKey(photoId), new Response(image));
    } catch {
      // Sin caché (modo privado, almacenamiento lleno) la foto se descargará otra vez.
    }
  }

  private assertOnline(): void {
    if (!this.connectivity.online()) throw new InventoryError('offline');
  }
}
