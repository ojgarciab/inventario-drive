import { Injectable } from '@angular/core';
import { ContainerType, Entity, Photo } from './models';

const CACHE_NAME = 'inventario-datos';
const KEY = '/__inventario__/datos.json';
const VERSION = 1;

/** Copia del inventario guardada en el dispositivo para poder consultarlo sin conexión. */
export interface CachedInventory {
  /** Momento de la última sincronización con Drive que refleja esta copia. */
  syncedAt: string;
  /** Punto desde el que pedir a Drive los cambios posteriores a esta copia. */
  changeToken: string;
  types: ContainerType[];
  entities: Entity[];
  photos: Photo[];
}

/**
 * Guarda en el dispositivo la última versión conocida del inventario. Solo
 * sirve para consultarlo cuando no se puede llegar a Drive: los cambios se
 * siguen haciendo siempre contra Drive. Se borra al cerrar la sesión.
 */
@Injectable({ providedIn: 'root' })
export class InventoryCache {
  async save(inventory: CachedInventory): Promise<void> {
    try {
      const body = JSON.stringify({ version: VERSION, ...inventory });
      await (
        await caches.open(CACHE_NAME)
      ).put(KEY, new Response(body, { headers: { 'Content-Type': 'application/json' } }));
    } catch {
      // Sin almacenamiento (modo privado, disco lleno) no habrá copia sin conexión.
    }
  }

  async load(): Promise<CachedInventory | null> {
    try {
      const response = await (await caches.open(CACHE_NAME)).match(KEY);
      if (!response) return null;
      const raw = (await response.json()) as Partial<CachedInventory> & { version?: number };
      if (
        raw.version !== VERSION ||
        typeof raw.syncedAt !== 'string' ||
        typeof raw.changeToken !== 'string' ||
        !Array.isArray(raw.types) ||
        !Array.isArray(raw.entities) ||
        !Array.isArray(raw.photos)
      ) {
        return null;
      }
      return {
        syncedAt: raw.syncedAt,
        changeToken: raw.changeToken,
        types: raw.types,
        entities: raw.entities,
        photos: raw.photos,
      };
    } catch {
      return null;
    }
  }

  async clear(): Promise<void> {
    try {
      await caches.delete(CACHE_NAME);
    } catch {
      // Sin caché disponible no hay nada que borrar.
    }
  }

  /** Bytes que ocupa la copia en el dispositivo; `null` si no hay ninguna. */
  async size(): Promise<number | null> {
    try {
      const response = await (await caches.open(CACHE_NAME)).match(KEY);
      return response ? (await response.blob()).size : null;
    } catch {
      return null;
    }
  }
}
