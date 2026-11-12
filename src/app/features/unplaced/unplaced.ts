import { Component, computed, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { RouterLink } from '@angular/router';
import { InventoryStore } from '../../core/inventory/inventory-store';
import { entityLink } from '../../shared/entity-links';

/** Entidades cuyo contenedor ya no existe o que han quedado en un ciclo. */
@Component({
  imports: [MatButtonModule, MatIconModule, MatListModule, RouterLink],
  selector: 'app-unplaced',
  styleUrl: '../trash/trash.scss',
  template: `
    <nav class="back"><a routerLink="/">‹ Inicio</a></nav>
    <h1>Sin ubicar</h1>
    <p class="hint">
      Estos elementos han perdido su sitio: su contenedor se eliminó, o dos dispositivos los
      movieron a la vez uno dentro del otro. Muévalos a donde correspondan.
    </p>

    @if (rows().length === 0) {
      <p class="empty">No hay nada sin ubicar.</p>
    } @else {
      <mat-list>
        @for (row of rows(); track row.entity.id) {
          <mat-list-item>
            <mat-icon matListItemIcon aria-hidden="true">{{ row.icon }}</mat-icon>
            <a matListItemTitle class="name" [routerLink]="link(row.entity)">{{
              row.entity.name
            }}</a>
            <a
              matListItemMeta
              matButton="tonal"
              [routerLink]="['/mover', row.entity.id]"
              [attr.aria-label]="'Mover ' + row.entity.name"
            >
              Mover
            </a>
          </mat-list-item>
        }
      </mat-list>
    }
  `,
  styles: `
    .name {
      color: inherit;
      text-decoration: none;
    }
  `,
})
export class Unplaced {
  private readonly store = inject(InventoryStore);

  protected readonly rows = computed(() =>
    this.store.unplaced().map((entity) => ({
      entity,
      icon: entity.kind === 'container' ? 'inventory_2' : 'label',
    })),
  );
  protected readonly link = entityLink;
}
