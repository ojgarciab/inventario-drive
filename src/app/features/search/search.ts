import {
  Component,
  ElementRef,
  afterNextRender,
  computed,
  inject,
  input,
  viewChild,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatListModule } from '@angular/material/list';
import { Router, RouterLink } from '@angular/router';
import { InventoryStore } from '../../core/inventory/inventory-store';
import { Entity } from '../../core/inventory/models';
import { entityLink } from '../../shared/entity-links';
import { EntityThumb } from '../../shared/entity-thumb';

/** Resultados que se muestran como máximo; con más, conviene afinar la búsqueda. */
const MAX_RESULTS = 100;

/** Búsqueda en todo el inventario; cada resultado indica dónde está. */
@Component({
  imports: [
    EntityThumb,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatListModule,
    RouterLink,
  ],
  selector: 'app-search',
  styleUrl: './search.scss',
  templateUrl: './search.html',
})
export class Search {
  private readonly store = inject(InventoryStore);
  private readonly router = inject(Router);
  private readonly field = viewChild.required<ElementRef<HTMLInputElement>>('field');

  /** Texto buscado, tomado del parámetro `q` para que sobreviva a ir y volver. */
  readonly q = input<string>();

  protected readonly query = computed(() => this.q() ?? '');
  private readonly results = computed(() => this.store.search(this.query()));
  protected readonly total = computed(() => this.results().length);
  protected readonly truncated = computed(() => this.total() > MAX_RESULTS);
  protected readonly rows = computed(() =>
    this.results()
      .slice(0, MAX_RESULTS)
      .map((entity) => ({
        entity,
        icon: this.iconOf(entity),
        place: this.placeOf(entity),
      })),
  );
  protected readonly link = entityLink;

  constructor() {
    afterNextRender(() => this.field().nativeElement.focus());
  }

  protected search(text: string): void {
    void this.router.navigate([], { queryParams: { q: text || null }, replaceUrl: true });
  }

  protected clear(): void {
    this.search('');
    this.field().nativeElement.focus();
  }

  private iconOf(entity: Entity): string {
    if (entity.kind === 'item') return 'label';
    return this.store.typeOf(entity)?.icon ?? 'inventory_2';
  }

  private placeOf(entity: Entity): string {
    if (this.store.isUnplaced(entity.id)) return 'Sin ubicar';
    // Del contenedor más cercano al más lejano: si no cabe, se corta lo menos útil.
    const ancestors = this.store.path(entity.id).slice(0, -1).reverse();
    return ancestors.length > 0 ? ancestors.map((step) => step.name).join(' ‹ ') : 'En el inicio';
  }
}
