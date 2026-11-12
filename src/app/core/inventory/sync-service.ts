import { DOCUMENT, DestroyRef, Injectable, InjectionToken, inject } from '@angular/core';
import { AuthService } from '../auth/auth-service';
import { Connectivity } from '../pwa/connectivity';
import { InventoryStore } from './inventory-store';

/** Intervalo entre consultas de cambios mientras la aplicación está visible. */
export const SYNC_INTERVAL_MS = new InjectionToken<number>('SYNC_INTERVAL_MS', {
  providedIn: 'root',
  factory: () => 20_000,
});

/**
 * Mantiene el inventario al día con lo que cambian otros dispositivos:
 * consulta los cambios periódicamente mientras la aplicación está visible y
 * en cuanto vuelve a primer plano o recupera la conexión.
 */
@Injectable({ providedIn: 'root' })
export class SyncService {
  private readonly store = inject(InventoryStore);
  private readonly auth = inject(AuthService);
  private readonly connectivity = inject(Connectivity);
  private readonly document = inject(DOCUMENT);
  private readonly intervalMs = inject(SYNC_INTERVAL_MS);
  private readonly destroyRef = inject(DestroyRef);
  private started = false;

  start(): void {
    if (this.started) return;
    this.started = true;
    const window = this.document.defaultView;
    const sync = () => this.sync();

    const timer = setInterval(sync, this.intervalMs);
    this.document.addEventListener('visibilitychange', sync);
    window?.addEventListener('focus', sync);
    window?.addEventListener('online', sync);

    this.destroyRef.onDestroy(() => {
      clearInterval(timer);
      this.document.removeEventListener('visibilitychange', sync);
      window?.removeEventListener('focus', sync);
      window?.removeEventListener('online', sync);
    });
  }

  /** Consulta los cambios si tiene sentido hacerlo ahora. */
  sync(): void {
    // Con la sesión caducada no se consulta: cada intento abriría la ventana
    // de Google para renovar el token.
    if (
      this.document.visibilityState === 'visible' &&
      this.connectivity.online() &&
      this.auth.status() === 'signedIn' &&
      this.store.status() === 'ready'
    ) {
      void this.store.refresh();
    }
  }
}
