import { DOCUMENT, Injectable, inject, signal } from '@angular/core';

/** Estado de la conexión del dispositivo. */
@Injectable({ providedIn: 'root' })
export class Connectivity {
  private readonly window = inject(DOCUMENT).defaultView;

  private readonly state = signal(this.window?.navigator.onLine ?? true);
  readonly online = this.state.asReadonly();

  constructor() {
    this.window?.addEventListener('online', () => this.state.set(true));
    this.window?.addEventListener('offline', () => this.state.set(false));
  }
}
