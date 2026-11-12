import { DOCUMENT, DestroyRef, Injectable, inject } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { SwUpdate } from '@angular/service-worker';

/** Cada cuánto se comprueba si hay una versión nueva mientras la aplicación está abierta. */
const CHECK_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Avisa cuando se ha descargado una versión nueva de la aplicación. No se
 * aplica sola para no interrumpir lo que se esté haciendo: se ofrece
 * recargar, y si no, se usará al abrir la aplicación la próxima vez.
 */
@Injectable({ providedIn: 'root' })
export class UpdateService {
  // Sin service worker (desarrollo, pruebas) no hay nada que vigilar.
  private readonly updates = inject(SwUpdate, { optional: true });
  private readonly snackBar = inject(MatSnackBar);
  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);
  private started = false;

  start(): void {
    const updates = this.updates;
    if (this.started || !updates?.isEnabled) return;
    this.started = true;

    const ready = updates.versionUpdates.subscribe((event) => {
      if (event.type === 'VERSION_READY')
        this.offerReload('Hay una versión nueva de la aplicación.');
    });
    // La caché quedó en un estado del que el service worker no puede salir solo.
    const broken = updates.unrecoverable.subscribe(() =>
      this.offerReload('La aplicación necesita recargarse para seguir funcionando.'),
    );

    const check = () => {
      if (this.document.visibilityState === 'visible') {
        updates.checkForUpdate().catch(() => undefined); // sin conexión, ya se comprobará
      }
    };
    const timer = setInterval(check, CHECK_INTERVAL_MS);
    this.document.addEventListener('visibilitychange', check);

    this.destroyRef.onDestroy(() => {
      ready.unsubscribe();
      broken.unsubscribe();
      clearInterval(timer);
      this.document.removeEventListener('visibilitychange', check);
    });
  }

  private offerReload(message: string): void {
    this.snackBar
      .open(message, 'Actualizar')
      .onAction()
      .subscribe(async () => {
        await this.updates?.activateUpdate().catch(() => undefined);
        this.document.location.reload();
      });
  }
}
