import { DOCUMENT, Injectable, inject, signal } from '@angular/core';

/** `auto` sigue el tema del dispositivo; los otros lo fuerzan. */
export type ThemePreference = 'auto' | 'light' | 'dark';

/** Preferencia guardada en este dispositivo; solo se anota cuando no es `auto`. */
const THEME_KEY = 'inventario.tema';

/**
 * Tema claro u oscuro de la aplicación. Por defecto sigue al dispositivo,
 * pero se puede forzar uno. Es una preferencia de este dispositivo: se guarda
 * en su almacenamiento local, no en Drive.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly root = inject(DOCUMENT).documentElement;
  private readonly current = signal(readPreference());
  readonly preference = this.current.asReadonly();

  constructor() {
    this.apply(this.current());
  }

  set(preference: ThemePreference): void {
    this.current.set(preference);
    this.apply(preference);
    try {
      if (preference === 'auto') localStorage.removeItem(THEME_KEY);
      else localStorage.setItem(THEME_KEY, preference);
    } catch {
      // Sin almacenamiento la preferencia dura lo que dure la página.
    }
  }

  /** Los estilos eligen los colores a partir de este atributo (ver `styles.scss`). */
  private apply(preference: ThemePreference): void {
    if (preference === 'auto') this.root.removeAttribute('data-theme');
    else this.root.setAttribute('data-theme', preference);
  }
}

function readPreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    return stored === 'light' || stored === 'dark' ? stored : 'auto';
  } catch {
    return 'auto';
  }
}
