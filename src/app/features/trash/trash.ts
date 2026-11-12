import { Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router, RouterLink } from '@angular/router';
import { inventoryErrorMessage } from '../../core/inventory/inventory-messages';
import { InventoryStore, TRASH_RETENTION_DAYS } from '../../core/inventory/inventory-store';
import { Entity, EntityId } from '../../core/inventory/models';
import { confirm } from '../../shared/confirm-dialog';
import { entityLink } from '../../shared/entity-links';

const dateFormat = new Intl.DateTimeFormat('es', { dateStyle: 'medium' });

/** Entidades borradas: se pueden restaurar o eliminar definitivamente. */
@Component({
  imports: [MatButtonModule, MatIconModule, MatListModule, RouterLink],
  selector: 'app-trash',
  styleUrl: './trash.scss',
  templateUrl: './trash.html',
})
export class Trash {
  private readonly store = inject(InventoryStore);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);
  private readonly router = inject(Router);

  protected readonly retentionDays = TRASH_RETENTION_DAYS;
  /** Entidad sobre la que se está trabajando, para no repetir la operación. */
  protected readonly busy = signal<EntityId | null>(null);

  protected readonly rows = computed(() =>
    this.store.trash().map((entity) => ({
      entity,
      icon: entity.kind === 'container' ? 'inventory_2' : 'label',
      detail: `${this.deletedOn(entity)} · ${this.formerPlace(entity)}`,
    })),
  );

  protected async restore(entity: Entity): Promise<void> {
    await this.run(entity, async () => {
      const restored = await this.store.restore(entity.id);
      this.snackBar
        .open(`«${entity.name}» restaurado`, 'Ver', { duration: 6000 })
        .onAction()
        .subscribe(() => this.router.navigate(entityLink(restored)));
    });
  }

  protected async purge(entity: Entity): Promise<void> {
    const accepted = await confirm(this.dialog, {
      title: '¿Eliminar definitivamente?',
      message: `«${entity.name}» se borrará de Google Drive y no se podrá recuperar.`,
      confirmLabel: 'Eliminar para siempre',
    });
    if (accepted) await this.run(entity, () => this.store.purge(entity.id));
  }

  private async run(entity: Entity, action: () => Promise<void>): Promise<void> {
    this.busy.set(entity.id);
    try {
      await action();
    } catch (error) {
      this.snackBar.open(inventoryErrorMessage(error), 'Cerrar');
    } finally {
      this.busy.set(null);
    }
  }

  private deletedOn(entity: Entity): string {
    const date = new Date(entity.deletedAt ?? '');
    return Number.isNaN(date.getTime()) ? 'Borrado' : `Borrado el ${dateFormat.format(date)}`;
  }

  private formerPlace(entity: Entity): string {
    if (entity.parentId === null) return 'estaba en el inicio';
    const path = this.store.path(entity.parentId);
    return path.length > 0
      ? `estaba en ${path.map((step) => step.name).join(' › ')}`
      : 'su contenedor ya no existe';
  }
}
