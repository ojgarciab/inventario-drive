import { DOCUMENT, DestroyRef, Injectable, InjectionToken, inject, signal } from '@angular/core';
import { AuthService } from '../auth/auth-service';
import { Connectivity } from '../pwa/connectivity';
import { InventoryStore } from './inventory-store';

/** Intervalo entre consultas de cambios mientras la aplicación está visible. */
export const SYNC_INTERVAL_MS = new InjectionToken<number>('SYNC_INTERVAL_MS', {
  providedIn: 'root',
  factory: () => 20_000,
});

/** Preferencia guardada en este dispositivo; solo se anota cuando está desactivada. */
const AUTO_SYNC_KEY = 'inventario.sincronizacion';

/**
 * Mantiene el inventario al día con lo que cambian otros dispositivos:
 * consulta los cambios periódicamente mientras la aplicación está visible y
 * en cuanto vuelve a primer plano o recupera la conexión.
 *
 * La sincronización automática se puede desactivar. Es una preferencia de
 * este dispositivo: se guarda en su almacenamiento local, no en Drive, y no
 * afecta a los demás. Desactivada, los cambios ajenos solo llegan al pedirlo
 * («Actualizar ahora») o al abrir un formulario de edición o de traslado.
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

  private readonly enabled = signal(readPreference());
  /** Indica si la sincronización automática está activada en este dispositivo. */
  readonly autoSync = this.enabled.asReadonly();

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

  setAutoSync(enabled: boolean): void {
    this.enabled.set(enabled);
    try {
      if (enabled) localStorage.removeItem(AUTO_SYNC_KEY);
      else localStorage.setItem(AUTO_SYNC_KEY, 'off');
    } catch {
      // Sin almacenamiento la preferencia dura lo que dure la página.
    }
    if (enabled) this.sync(); // al reactivarla se pone al día enseguida
  }

  /** Consulta los cambios si la sincronización automática está activada y tiene sentido ahora. */
  sync(): void {
    // Con la sesión caducada no se consulta: cada intento abriría la ventana
    // de Google para renovar el token.
    if (
      this.enabled() &&
      this.document.visibilityState === 'visible' &&
      this.connectivity.online() &&
      this.auth.status() === 'signedIn' &&
      this.store.status() === 'ready'
    ) {
      void this.store.refresh();
    }
  }
}

function readPreference(): boolean {
  try {
    return localStorage.getItem(AUTO_SYNC_KEY) !== 'off';
  } catch {
    return true;
  }
}
