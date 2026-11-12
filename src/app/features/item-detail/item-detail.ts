import { Component, computed, inject, input } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { InventoryStore } from '../../core/inventory/inventory-store';
import { usePageTitle } from '../../core/pwa/page-title';
import { Breadcrumb } from '../../shared/breadcrumb';
import { EntityActions } from '../../shared/entity-actions';
import { EntityPhoto } from '../../shared/entity-photo';

/** Ficha de un objeto. */
@Component({
  imports: [Breadcrumb, EntityActions, EntityPhoto, MatButtonModule, MatIconModule, RouterLink],
  selector: 'app-item-detail',
  styleUrl: '../browse/browse.scss',
  template: `
    <app-breadcrumb [path]="path()" />
    @if (item(); as i) {
      <header>
        <mat-icon aria-hidden="true">label</mat-icon>
        <div class="heading">
          <h1>{{ i.name }}</h1>
          <span class="type">Cantidad: {{ i.quantity }}</span>
        </div>
        <app-entity-actions [entity]="i" />
      </header>
      <app-entity-photo [entity]="i" />
      @if (i.notes) {
        <p class="notes">{{ i.notes }}</p>
      }
      @if (i.tags.length > 0) {
        <ul class="tags" aria-label="Etiquetas">
          @for (tag of i.tags; track tag) {
            <li>
              <a routerLink="/buscar" [queryParams]="{ q: tag }">{{ tag }}</a>
            </li>
          }
        </ul>
      }
    } @else {
      <p class="empty" role="alert">Este objeto ya no existe.</p>
      <a matButton="tonal" routerLink="/">Ir al inicio</a>
    }
  `,
})
export class ItemDetail {
  private readonly store = inject(InventoryStore);

  readonly id = input.required<string>();

  protected readonly item = computed(() => {
    const entity = this.store.get(this.id());
    return entity?.kind === 'item' ? entity : undefined;
  });
  protected readonly path = computed(() => (this.item() ? this.store.path(this.id()) : []));

  constructor() {
    usePageTitle(() => this.item()?.name);
  }
}
