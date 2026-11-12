import {
  Component,
  ElementRef,
  afterRenderEffect,
  computed,
  input,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { Entity } from '../core/inventory/models';
import { entityLink } from './entity-links';

/** Ruta desde el inicio hasta la entidad actual; el último elemento no es enlace. */
@Component({
  imports: [RouterLink],
  selector: 'app-breadcrumb',
  styles: `
    nav {
      margin: 0 -16px 8px;
      overflow-x: auto;
      padding: 0 16px;
      scrollbar-width: none;
      white-space: nowrap;
    }

    ol {
      display: flex;
      font: var(--mat-sys-body-medium);
      gap: 4px;
      list-style: none;
      margin: 0;
      padding: 0;
    }

    li + li::before {
      color: var(--mat-sys-outline);
      content: '›';
      margin-right: 4px;
    }

    a {
      color: var(--mat-sys-primary);
      display: inline-block;
      padding: 8px 0;
      text-decoration: none;
    }

    [aria-current] {
      color: var(--mat-sys-on-surface-variant);
      display: inline-block;
      padding: 8px 0;
    }
  `,
  template: `
    <nav #nav aria-label="Ubicación">
      <ol>
        @if (path().length === 0) {
          <li><span aria-current="page">Inicio</span></li>
        } @else {
          <li><a routerLink="/">Inicio</a></li>
        }
        @for (entity of ancestors(); track entity.id) {
          <li>
            <a [routerLink]="link(entity)">{{ entity.name }}</a>
          </li>
        }
        @if (current(); as entity) {
          <li>
            <span aria-current="page">{{ entity.name }}</span>
          </li>
        }
      </ol>
    </nav>
  `,
})
export class Breadcrumb {
  /** Ruta desde la raíz hasta la entidad actual, ambas incluidas. */
  readonly path = input.required<readonly Entity[]>();

  protected readonly ancestors = computed(() => this.path().slice(0, -1));
  protected readonly current = computed(() => this.path().at(-1));
  protected readonly link = entityLink;

  private readonly nav = viewChild.required<ElementRef<HTMLElement>>('nav');

  constructor() {
    // Si la ruta no cabe, se muestra su final: lo más cercano a la entidad actual.
    afterRenderEffect(() => {
      this.path();
      const nav = this.nav().nativeElement;
      nav.scrollLeft = nav.scrollWidth;
    });
  }
}
