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
import { EntityThumb } from '../../shared/entity-thumb';
import { entityLink } from '../../shared/entity-links';

interface Row {
  entity: Entity;
  icon: string;
  detail: string | null;
}

/** Funciones principales, que se explican al pie de la página de inicio. */
const FEATURES: readonly { icon: string; title: string; text: string }[] = [
  {
    icon: 'account_tree',
    title: 'Un sitio para cada cosa',
    text: 'Organice la casa en contenedores dentro de contenedores (habitaciones, armarios, cajas) y anote en cuál está cada objeto.',
  },
  {
    icon: 'search',
    title: 'Encuentre lo que busca',
    text: 'Busque por nombre, notas o etiquetas y verá la ruta completa hasta el objeto, sin importar mayúsculas ni acentos.',
  },
  {
    icon: 'photo_library',
    title: 'Fotografías',
    text: 'Añada varias fotos a cada contenedor u objeto y destaque la que mejor lo identifica.',
  },
  {
    icon: 'sell',
    title: 'Etiquetas',
    text: 'Agrupe con etiquetas lo que está repartido por la casa y consulte cuáles usa más.',
  },
  {
    icon: 'drive_file_move',
    title: 'Mudanzas sin perder nada',
    text: 'Mueva un objeto o un contenedor entero, con todo su contenido, a otro lugar en un par de toques.',
  },
  {
    icon: 'cloud_done',
    title: 'Sus datos, en su Google Drive',
    text: 'El inventario se guarda en su cuenta, se comparte entre sus dispositivos y puede exportarlo como copia de seguridad.',
  },
];

/** Contenido de un contenedor, o de la raíz si no se indica ninguno. */
@Component({
  imports: [
    Breadcrumb,
    EntityActions,
    EntityPhoto,
    EntityThumb,
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
  private readonly rows = computed<Row[]>(() =>
    this.store.children(this.id() ?? null).map((entity) => ({
      entity,
      icon: entity.kind === 'container' ? this.iconOf(entity) : 'label',
      detail: this.detailOf(entity),
    })),
  );
  /** Contenedores y objetos van en grupos separados, cada uno con su rejilla. */
  protected readonly groups = computed(() =>
    [
      { label: 'Contenedores', rows: this.rows().filter((r) => r.entity.kind === 'container') },
      { label: 'Objetos', rows: this.rows().filter((r) => r.entity.kind === 'item') },
    ].filter((group) => group.rows.length > 0),
  );
  protected readonly newParams = computed(() => (this.id() ? { en: this.id() } : {}));
  protected readonly unplacedCount = computed(() => this.store.unplaced().length);
  protected readonly link = entityLink;
  protected readonly features = FEATURES;

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
