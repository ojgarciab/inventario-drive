import { Component, inject, input } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router, RouterLink } from '@angular/router';
import { inventoryErrorMessage } from '../core/inventory/inventory-messages';
import { InventoryStore } from '../core/inventory/inventory-store';
import { Entity } from '../core/inventory/models';
import { confirm } from './confirm-dialog';
import { containerLink, entityLink } from './entity-links';

/** Menú de acciones de un contenedor o de un objeto: editar, mover y eliminar. */
@Component({
  imports: [MatButtonModule, MatIconModule, MatMenuModule, RouterLink],
  selector: 'app-entity-actions',
  template: `
    <button matIconButton type="button" aria-label="Acciones" [matMenuTriggerFor]="menu">
      <mat-icon>more_vert</mat-icon>
    </button>
    <mat-menu #menu="matMenu" xPosition="before">
      <a mat-menu-item [routerLink]="[...link(entity()), 'editar']">
        <mat-icon>edit</mat-icon>
        <span>Editar</span>
      </a>
      <a mat-menu-item [routerLink]="['/mover', entity().id]">
        <mat-icon>drive_file_move</mat-icon>
        <span>Mover a…</span>
      </a>
      <button mat-menu-item type="button" (click)="remove()">
        <mat-icon>delete</mat-icon>
        <span>Eliminar</span>
      </button>
    </mat-menu>
  `,
})
export class EntityActions {
  private readonly store = inject(InventoryStore);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);
  private readonly router = inject(Router);

  readonly entity = input.required<Entity>();
  protected readonly link = entityLink;

  protected async remove(): Promise<void> {
    const entity = this.entity();
    const placed = !this.store.isUnplaced(entity.id);
    const parent = placed && entity.parentId ? this.store.get(entity.parentId) : undefined;
    const count = this.store.children(entity.id).length;
    const destination = parent ? `«${parent.name}»` : 'el inicio';
    const message =
      count === 0
        ? `«${entity.name}» irá a la papelera. Podrá restaurarlo desde ahí.`
        : `«${entity.name}» contiene ${count === 1 ? '1 elemento, que pasará' : `${count} elementos, que pasarán`} a ${destination}. El contenedor irá a la papelera.`;

    const accepted = await confirm(this.dialog, {
      title: entity.kind === 'container' ? '¿Eliminar el contenedor?' : '¿Eliminar el objeto?',
      message,
      confirmLabel: 'Eliminar',
    });
    if (!accepted) return;

    try {
      await this.store.remove(entity.id, { moveContents: true });
    } catch (error) {
      this.snackBar.open(inventoryErrorMessage(error), 'Cerrar');
      return;
    }
    await this.router.navigate(containerLink(parent?.id ?? null));
    this.snackBar
      .open('Enviado a la papelera', 'Deshacer', { duration: 8000 })
      .onAction()
      .subscribe(() => this.undo(entity));
  }

  private async undo(entity: Entity): Promise<void> {
    try {
      await this.store.restore(entity.id);
    } catch (error) {
      this.snackBar.open(inventoryErrorMessage(error), 'Cerrar');
    }
  }
}
