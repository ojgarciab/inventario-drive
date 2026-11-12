import { Component, computed, inject, input } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatMenuModule } from '@angular/material/menu';
import { RouterLink } from '@angular/router';
import { InventoryStore } from '../../core/inventory/inventory-store';
import { Container, Entity } from '../../core/inventory/models';
import { usePageTitle } from '../../core/pwa/page-title';
import { Breadcrumb } from '../../shared/breadcrumb';
import { EntityActions } from '../../shared/entity-actions';
import { EntityPhoto } from '../../shared/entity-photo';
import { entityLink } from '../../shared/entity-links';

interface Row {
  entity: Entity;
  icon: string;
  detail: string | null;
}

/** Contenido de un contenedor, o de la raíz si no se indica ninguno. */
@Component({
  imports: [
    Breadcrumb,
    EntityActions,
    EntityPhoto,
    MatButtonModule,
    MatIconModule,
    MatListModule,
    MatMenuModule,
    RouterLink,
  ],
  selector: 'app-browse',
  styleUrl: './browse.scss',
  templateUrl: './browse.html',
})
export class Browse {
  private readonly store = inject(InventoryStore);

  /** Id del contenedor, tomado de la ruta; ausente en la raíz. */
  readonly id = input<string>();

  protected readonly container = computed(() => {
    const entity = this.id() ? this.store.get(this.id() as string) : undefined;
    return entity?.kind === 'container' ? entity : undefined;
  });
  protected readonly notFound = computed(() => !!this.id() && !this.container());
  protected readonly path = computed(() => (this.id() ? this.store.path(this.id() as string) : []));
  protected readonly type = computed(() => {
    const container = this.container();
    return container ? this.store.typeOf(container) : undefined;
  });
  protected readonly rows = computed<Row[]>(() =>
    this.store.children(this.id() ?? null).map((entity) => ({
      entity,
      icon: entity.kind === 'container' ? this.iconOf(entity) : 'label',
      detail: this.detailOf(entity),
    })),
  );
  protected readonly newParams = computed(() => (this.id() ? { en: this.id() } : {}));
  protected readonly unplacedCount = computed(() => this.store.unplaced().length);
  protected readonly link = entityLink;

  constructor() {
    usePageTitle(() => (this.id() ? this.container()?.name : 'Inicio'));
  }

  private iconOf(container: Container): string {
    return this.store.typeOf(container)?.icon ?? 'inventory_2';
  }

  private detailOf(entity: Entity): string | null {
    if (entity.kind === 'item') return entity.quantity > 1 ? `Cantidad: ${entity.quantity}` : null;
    const count = this.store.children(entity.id).length;
    if (count === 0) return 'Vacío';
    return count === 1 ? '1 elemento' : `${count} elementos`;
  }
}
