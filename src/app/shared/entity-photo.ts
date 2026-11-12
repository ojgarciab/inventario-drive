import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar } from '@angular/material/snack-bar';
import { inventoryErrorMessage } from '../core/inventory/inventory-messages';
import { InventoryStore } from '../core/inventory/inventory-store';
import { Entity, EntityId } from '../core/inventory/models';
import { PhotoService } from '../core/photos/photo-service';
import { confirm } from './confirm-dialog';

type PhotoState = 'none' | 'loading' | 'ready' | 'error';

/**
 * Fotografías de un contenedor o de un objeto: la elegida se ve en grande
 * (al entrar, la destacada) y debajo queda la galería con todas en pequeño.
 * Incluye las acciones para añadir fotos, destacar una y quitarlas.
 */
@Component({
  imports: [MatButtonModule, MatIconModule, MatProgressBarModule],
  selector: 'app-entity-photo',
  styleUrl: './entity-photo.scss',
  templateUrl: './entity-photo.html',
})
export class EntityPhoto {
  private readonly photos = inject(PhotoService);
  private readonly store = inject(InventoryStore);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);

  readonly entity = input.required<Entity>();

  private readonly entityId = computed(() => this.entity().id);
  protected readonly gallery = computed(() => this.store.photosOf(this.entityId()));
  protected readonly featuredId = computed(() => this.store.featuredPhotoId(this.entityId()));

  /** Foto que el usuario ha elegido ver en grande; sin elegir, la destacada. */
  private readonly picked = signal<EntityId | null>(null);
  protected readonly selectedId = computed(() => {
    const picked = this.picked();
    return picked && this.gallery().some((photo) => photo.id === picked)
      ? picked
      : this.featuredId();
  });

  /** Direcciones locales de las fotos ya cargadas y fotos cuya carga ha fallado. */
  protected readonly urls = signal<ReadonlyMap<EntityId, string>>(new Map());
  private readonly failed = signal<ReadonlySet<EntityId>>(new Set());

  protected readonly state = computed<PhotoState>(() => {
    const id = this.selectedId();
    if (!id) return 'none';
    if (this.urls().has(id)) return 'ready';
    return this.failed().has(id) ? 'error' : 'loading';
  });
  protected readonly url = computed(() => this.urls().get(this.selectedId() ?? '') ?? null);
  protected readonly expanded = signal(false);
  protected readonly busy = signal(false);

  constructor() {
    // Al pasar a otra entidad se vuelve a empezar por su foto destacada.
    effect(() => {
      this.entityId();
      this.picked.set(null);
    });
    effect(() => {
      this.selectedId();
      this.expanded.set(false);
    });
    // Carga las fotos de la galería según aparecen, también las de otro dispositivo.
    effect(() => {
      const gallery = this.gallery();
      untracked(() => {
        for (const photo of gallery) {
          if (!this.urls().has(photo.id) && !this.failed().has(photo.id)) this.load(photo.id);
        }
      });
    });
  }

  protected select(photoId: EntityId): void {
    this.picked.set(photoId);
  }

  protected retry(): void {
    const photoId = this.selectedId();
    if (photoId) this.load(photoId);
  }

  protected async pick(input: HTMLInputElement): Promise<void> {
    const files = [...(input.files ?? [])];
    input.value = ''; // permite volver a elegir los mismos archivos
    if (files.length === 0) return;
    const entityId = this.entityId();
    await this.run(async () => {
      for (const file of files) {
        const photo = await this.photos.attach(entityId, file);
        this.picked.set(photo.id); // se enseña lo que se acaba de añadir
      }
    });
  }

  protected async feature(): Promise<void> {
    const photoId = this.selectedId();
    if (photoId) await this.run(() => this.photos.feature(this.entityId(), photoId));
  }

  protected async remove(): Promise<void> {
    const photoId = this.selectedId();
    if (!photoId) return;
    const accepted = await confirm(this.dialog, {
      title: '¿Quitar la foto?',
      message: 'La foto se borrará de Google Drive y no se podrá recuperar.',
      confirmLabel: 'Quitar',
    });
    if (accepted) await this.run(() => this.photos.remove(this.entityId(), photoId));
  }

  private async run(action: () => Promise<void>): Promise<void> {
    this.busy.set(true);
    try {
      await action();
    } catch (error) {
      this.snackBar.open(inventoryErrorMessage(error), 'Cerrar');
    } finally {
      this.busy.set(false);
    }
  }

  private async load(photoId: EntityId): Promise<void> {
    this.failed.update((failed) => without(failed, photoId));
    try {
      const url = await this.photos.objectUrl(photoId);
      this.urls.update((urls) => new Map(urls).set(photoId, url));
    } catch {
      this.failed.update((failed) => new Set(failed).add(photoId));
    }
  }
}

function without(ids: ReadonlySet<EntityId>, id: EntityId): ReadonlySet<EntityId> {
  if (!ids.has(id)) return ids;
  const next = new Set(ids);
  next.delete(id);
  return next;
}
