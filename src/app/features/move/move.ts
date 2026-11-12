import { Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router, RouterLink } from '@angular/router';
import { inventoryErrorMessage } from '../../core/inventory/inventory-messages';
import { InventoryStore } from '../../core/inventory/inventory-store';
import { Container, EntityId } from '../../core/inventory/models';
import { entityLink } from '../../shared/entity-links';

/** Selector de destino: se navega por los contenedores hasta el nuevo sitio. */
@Component({
  imports: [MatButtonModule, MatIconModule, MatListModule, MatProgressBarModule, RouterLink],
  selector: 'app-move',
  styleUrl: './move.scss',
  templateUrl: './move.html',
})
export class Move implements OnInit {
  private readonly store = inject(InventoryStore);
  private readonly router = inject(Router);
  private readonly snackBar = inject(MatSnackBar);

  /** Id de la entidad que se mueve. */
  readonly id = input.required<string>();

  /** Contenedor que se está mostrando como posible destino; `null` es el inicio. */
  protected readonly at = signal<EntityId | null>(null);
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly entity = computed(() => this.store.get(this.id()));
  /** La propia entidad y todo lo que contiene no pueden ser destino. */
  private readonly excluded = computed(
    () => new Set([this.id(), ...this.store.descendants(this.id())]),
  );
  protected readonly path = computed(() => {
    const at = this.at();
    return at ? this.store.path(at) : [];
  });
  protected readonly rows = computed(() =>
    this.store
      .children(this.at())
      .filter((child): child is Container => child.kind === 'container')
      .map((container) => ({
        container,
        icon: this.store.typeOf(container)?.icon ?? 'inventory_2',
        disabled: this.excluded().has(container.id),
      })),
  );
  protected readonly destinationName = computed(() => this.path().at(-1)?.name ?? 'Inicio');
  /** Ya está ahí: no hay nada que mover. */
  protected readonly isCurrent = computed(() => {
    const entity = this.entity();
    return !!entity && !this.store.isUnplaced(entity.id) && entity.parentId === this.at();
  });
  protected readonly cancelLink = computed(() => {
    const entity = this.entity();
    return entity ? entityLink(entity) : ['/'];
  });

  ngOnInit(): void {
    // Antes de elegir destino conviene ver los contenedores tal y como están ahora.
    void this.store.refresh();
    const entity = this.entity();
    // Se empieza donde está ahora: lo habitual es moverlo cerca.
    if (entity && !this.store.isUnplaced(entity.id)) this.at.set(entity.parentId);
  }

  protected open(id: EntityId | null): void {
    this.at.set(id);
    this.error.set(null);
  }

  protected async confirm(): Promise<void> {
    const entity = this.entity();
    if (!entity || this.isCurrent()) return;
    this.saving.set(true);
    this.error.set(null);
    try {
      const moved = await this.store.move(entity.id, this.at());
      await this.router.navigate(entityLink(moved));
      this.snackBar.open(`Movido a ${this.destinationName()}`, undefined, { duration: 4000 });
    } catch (error) {
      this.error.set(inventoryErrorMessage(error));
    } finally {
      this.saving.set(false);
    }
  }
}
