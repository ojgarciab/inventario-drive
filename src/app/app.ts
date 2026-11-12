import {
  Component,
  DOCUMENT,
  ElementRef,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatToolbarModule } from '@angular/material/toolbar';
import { NavigationEnd, Router, RouterLink, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
import { authErrorMessage } from './core/auth/auth-messages';
import { AuthService } from './core/auth/auth-service';
import { InventoryStore } from './core/inventory/inventory-store';
import { SyncService } from './core/inventory/sync-service';
import { PhotoService } from './core/photos/photo-service';
import { Connectivity } from './core/pwa/connectivity';
import { UpdateService } from './core/pwa/update-service';

@Component({
  imports: [
    MatButtonModule,
    MatIconModule,
    MatMenuModule,
    MatProgressBarModule,
    MatToolbarModule,
    RouterLink,
    RouterOutlet,
  ],
  selector: 'app-root',
  styleUrl: './app.scss',
  templateUrl: './app.html',
})
export class App {
  private readonly auth = inject(AuthService);
  private readonly store = inject(InventoryStore);
  private readonly router = inject(Router);
  private readonly sync = inject(SyncService);
  private readonly photos = inject(PhotoService);
  private readonly document = inject(DOCUMENT);

  protected readonly user = this.auth.user;
  protected readonly status = this.auth.status;
  protected readonly inventory = this.store.status;
  protected readonly online = inject(Connectivity).online;
  protected readonly autoSync = this.sync.autoSync;
  protected readonly resumeError = signal<string | null>(null);
  private readonly main = viewChild.required<ElementRef<HTMLElement>>('main');
  /** Ruta de la pantalla actual, sin parámetros de consulta. */
  private currentPath: string | null = null;

  constructor() {
    this.sync.start();
    inject(UpdateService).start();
    // Al cambiar de pantalla el foco pasa al contenido, para que los lectores
    // de pantalla y el teclado no se queden en el enlace que se pulsó. No se
    // hace si solo cambian los parámetros (la búsqueda los cambia al escribir).
    this.router.events
      .pipe(
        filter((event) => event instanceof NavigationEnd),
        takeUntilDestroyed(),
      )
      .subscribe((event) => {
        const path = event.urlAfterRedirects.split('?')[0];
        if (this.currentPath !== null && this.currentPath !== path) {
          this.main().nativeElement.focus({ preventScroll: true });
          this.main().nativeElement.ownerDocument.defaultView?.scrollTo(0, 0);
        }
        this.currentPath = path;
      });
    // Con la sesión caducada, el primer toque en cualquier parte la reanuda:
    // Google solo deja abrir su ventana desde un gesto del usuario. Se intenta
    // una vez; si falla, queda el botón «Reanudar sesión».
    effect((onCleanup) => {
      if (this.status() !== 'expired') return;
      this.auth.prepare();
      const stop = () => this.document.removeEventListener('click', onGesture, true);
      const onGesture = () => {
        stop();
        void this.resume();
      };
      this.document.addEventListener('click', onGesture, true);
      onCleanup(stop);
    });
    // El inventario se carga entero en cuanto hay sesión vigente.
    effect(() => {
      if (this.status() === 'signedIn' && untracked(this.inventory) === 'idle') this.load();
    });
  }

  protected load(): void {
    // El error queda reflejado en el estado del almacén.
    this.store.load().catch(() => undefined);
  }

  protected async resume(): Promise<void> {
    this.resumeError.set(null);
    try {
      await this.auth.signIn();
      if (this.inventory() !== 'ready') this.load();
      else this.sync.sync();
    } catch (error) {
      this.resumeError.set(authErrorMessage(error));
    }
  }

  protected toggleAutoSync(): void {
    this.sync.setAutoSync(!this.autoSync());
  }

  protected refresh(): void {
    void this.store.refresh();
  }

  protected async signOut(): Promise<void> {
    this.auth.signOut();
    this.store.reset(); // el inventario es de la cuenta que acaba de salir
    void this.photos.clearCache(); // y sus fotos no deben quedarse en el dispositivo
    await this.router.navigateByUrl('/login');
  }
}
