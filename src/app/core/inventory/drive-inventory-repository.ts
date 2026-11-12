import { Injectable, inject } from '@angular/core';
import { DriveApi, DriveFile } from '../drive/drive-api';
import {
  changesToPatch,
  containerToFile,
  fileToEntity,
  fileToType,
  itemToFile,
  typeChangesToPatch,
  typeToFile,
} from './drive-mapping';
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

/** Inventario guardado en `appDataFolder`: un archivo de Drive por entidad. */
@Injectable()
export class DriveInventoryRepository extends InventoryRepository {
  private readonly api = inject(DriveApi);

  async loadAll(): Promise<InventorySnapshot> {
    // El token se pide antes de listar: así ningún cambio hecho durante la
    // carga queda fuera de la primera consulta de cambios.
    const changeToken = await this.api.startPageToken();
    const snapshot: InventorySnapshot = { types: [], entities: [], changeToken };
    for (const file of await this.api.listAll()) classify(file, snapshot);
    return snapshot;
  }

  async changesSince(token: string): Promise<InventoryChanges> {
    const { changes, nextToken } = await this.api.listChanges(token);
    const result: InventoryChanges = { types: [], entities: [], removedIds: [], nextToken };
    for (const change of changes) {
      if (change.removed || !change.file) result.removedIds.push(change.fileId);
      else classify(change.file, result);
    }
    return result;
  }

  async createContainer(draft: ContainerDraft): Promise<Container> {
    return asEntity(await this.api.create(containerToFile(draft))) as Container;
  }

  async createItem(draft: ItemDraft): Promise<Item> {
    return asEntity(await this.api.create(itemToFile(draft))) as Item;
  }

  async updateEntity(id: EntityId, changes: EntityChanges): Promise<Entity> {
    return asEntity(await this.api.update(id, changesToPatch(changes)));
  }

  purgeEntity(id: EntityId): Promise<void> {
    return this.api.delete(id);
  }

  async createType(draft: TypeDraft): Promise<ContainerType> {
    return asType(await this.api.create(typeToFile(draft)));
  }

  async updateType(id: EntityId, changes: TypeChanges): Promise<ContainerType> {
    return asType(await this.api.update(id, typeChangesToPatch(changes)));
  }

  deleteType(id: EntityId): Promise<void> {
    return this.api.delete(id);
  }
}

/** Añade el archivo a la lista que le corresponde; ignora los que no son del inventario. */
function classify(file: DriveFile, into: { types: ContainerType[]; entities: Entity[] }): void {
  const entity = fileToEntity(file);
  if (entity) {
    into.entities.push(entity);
    return;
  }
  const type = fileToType(file);
  if (type) into.types.push(type);
}

function asEntity(file: DriveFile): Entity {
  const entity = fileToEntity(file);
  if (!entity) throw new InventoryError('not_found');
  return entity;
}

function asType(file: DriveFile): ContainerType {
  const type = fileToType(file);
  if (!type) throw new InventoryError('not_found');
  return type;
}
