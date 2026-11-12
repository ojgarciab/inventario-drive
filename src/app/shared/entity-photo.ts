import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar } from '@angular/material/snack-bar';
import { inventoryErrorMessage } from '../core/inventory/inventory-messages';
import { Entity } from '../core/inventory/models';
import { PhotoService } from '../core/photos/photo-service';
import { confirm } from './confirm-dialog';

type PhotoState = 'none' | 'loading' | 'ready' | 'error';

/** Fotografía de un contenedor o de un objeto, con las acciones para ponerla y quitarla. */
@Component({
  imports: [MatButtonModule, MatIconModule, MatProgressBarModule],
  selector: 'app-entity-photo',
  styleUrl: './entity-photo.scss',
  templateUrl: './entity-photo.html',
})
export class EntityPhoto {
  private readonly photos = inject(PhotoService);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);

  readonly entity = input.required<Entity>();

  protected readonly photoId = computed(() => this.entity().photoId);
  protected readonly state = signal<PhotoState>('none');
  protected readonly url = signal<string | null>(null);
  protected readonly expanded = signal(false);
  protected readonly busy = signal(false);

  constructor() {
    // Carga la foto cada vez que cambia, también si la cambia otro dispositivo.
    effect(() => {
      const photoId = this.photoId();
      this.expanded.set(false);
      if (photoId) this.load(photoId);
      else this.state.set('none');
    });
  }

  protected retry(): void {
    const photoId = this.photoId();
    if (photoId) this.load(photoId);
  }

  protected async pick(input: HTMLInputElement): Promise<void> {
    const file = input.files?.[0];
    input.value = ''; // permite volver a elegir el mismo archivo
    if (!file) return;
    await this.run(() => this.photos.attach(this.entity().id, file));
  }

  protected async remove(): Promise<void> {
    const accepted = await confirm(this.dialog, {
      title: '¿Quitar la foto?',
      message: 'La foto se borrará de Google Drive y no se podrá recuperar.',
      confirmLabel: 'Quitar',
    });
    if (accepted) await this.run(() => this.photos.detach(this.entity().id));
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

  private async load(photoId: string): Promise<void> {
    this.state.set('loading');
    try {
      const url = await this.photos.objectUrl(photoId);
      // Si mientras tanto la foto ha cambiado, esta carga ya no interesa.
      if (this.photoId() !== photoId) return;
      this.url.set(url);
      this.state.set('ready');
    } catch {
      if (this.photoId() === photoId) this.state.set('error');
    }
  }
}
