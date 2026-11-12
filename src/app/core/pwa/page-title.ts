import { Injectable, effect, inject } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { RouterStateSnapshot, TitleStrategy } from '@angular/router';

const APP_NAME = 'Inventario del hogar';
const withAppName = (title: string) => `${title} · ${APP_NAME}`;

/** Título de pestaña de las pantallas fijas: «Buscar · Inventario del hogar». */
@Injectable()
export class PageTitleStrategy extends TitleStrategy {
  private readonly title = inject(Title);

  override updateTitle(snapshot: RouterStateSnapshot): void {
    const title = this.buildTitle(snapshot);
    // Las pantallas sin título fijo lo ponen ellas mismas con `usePageTitle`.
    if (title) this.title.setTitle(withAppName(title));
  }
}

/**
 * Mantiene el título de la pestaña igual al nombre de lo que se está viendo
 * (un contenedor, un objeto), también si cambia desde otro dispositivo.
 * Debe llamarse en el constructor del componente.
 */
export function usePageTitle(name: () => string | undefined): void {
  const title = inject(Title);
  effect(() => title.setTitle(withAppName(name() ?? 'No encontrado')));
}
