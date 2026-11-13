import { Component, inject } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { RouterLink } from '@angular/router';
import { InventoryStore } from '../../core/inventory/inventory-store';

/** Etiquetas en uso y cuántos elementos llevan cada una, de más a menos usada. */
@Component({
  imports: [MatIconModule, MatListModule, RouterLink],
  selector: 'app-tags',
  styleUrl: '../trash/trash.scss',
  template: `
    <nav class="back"><a routerLink="/">‹ Inicio</a></nav>
    <h1>Etiquetas</h1>
    <p class="hint">Pulse una etiqueta para buscar los elementos que la llevan.</p>

    @if (tags().length === 0) {
      <p class="empty">
        Todavía no hay etiquetas. Puede añadirlas al crear o editar un contenedor o un objeto.
      </p>
    } @else {
      <mat-nav-list aria-label="Etiquetas, de la más usada a la menos">
        @for (row of tags(); track row.tag) {
          <a mat-list-item class="entity-row" routerLink="/buscar" [queryParams]="{ q: row.tag }">
            <mat-icon matListItemIcon aria-hidden="true">sell</mat-icon>
            <span matListItemTitle>{{ row.tag }}</span>
            <span matListItemMeta class="count">
              {{ row.count === 1 ? '1 elemento' : row.count + ' elementos' }}
            </span>
          </a>
        }
      </mat-nav-list>
    }
  `,
  styles: `
    .count {
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-medium);
    }
  `,
})
export class Tags {
  protected readonly tags = inject(InventoryStore).tags;
}
