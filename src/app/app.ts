import {
  Component,
  DOCUMENT,
  computed,
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
import { AgentTools } from './core/ai/agent-tools';
import { authErrorMessage } from './core/auth/auth-messages';
import { AuthService } from './core/auth/auth-service';
import { InstallService } from './core/pwa/install-service';
import { installApp } from './shared/ios-install-dialog';
import { MatDialog } from '@angular/material/dialog';
import { InventoryStore } from './core/inventory/inventory-store';
import { ThemePreference, ThemeService } from './core/theme/theme-service';
import { SyncService } from './core/inventory/sync-service';
import { PhotoService } from './core/photos/photo-service';
import { Connectivity } from './core/pwa/connectivity';
import { UpdateService } from './core/pwa/update-service';

/** Fecha y hora de la última sincronización, como «14 nov, 16:40». */
const SYNC_DATE = new Intl.DateTimeFormat('es', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

const THEMES: readonly { value: ThemePreference; label: string; icon: string }[] = [
  { value: 'auto', label: 'Automático', icon: 'brightness_auto' },
  { value: 'light', label: 'Claro', icon: 'light_mode' },
  { value: 'dark', label: 'Oscuro', icon: 'dark_mode' },
];

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
  /** Si se volvió de Google con un error, se cuenta en el aviso de sesión caducada. */
  protected readonly resumeError = signal<string | null>(
    this.auth.redirectError() ? authErrorMessage(this.auth.redirectError()) : null,
  );
  protected readonly redirectMode = computed(() => this.auth.redirectMode());
  /** Sin conexión (o sin sesión vigente) y sin copia del inventario en el dispositivo. */
  protected readonly noLocalCopy = signal(false);
  /** Aviso de que se está viendo la copia del dispositivo, y de cuándo es. */
  protected readonly offlineNotice = computed(() => {
    const offline = !this.online();
    if (!offline && !this.store.stale()) return null;
    const cause = offline ? 'Sin conexión.' : 'No se ha podido sincronizar con Google Drive.';
    if (!this.user() || this.inventory() !== 'ready') return cause;
    const syncedAt = this.store.syncedAt();
    const when = syncedAt ? `, del ${SYNC_DATE.format(new Date(syncedAt))}` : '';
    return `${cause} Está viendo la copia guardada en este dispositivo${when}. No se pueden hacer cambios hasta volver a conectar.`;
  });
  private readonly installer = inject(InstallService);
  private readonly dialog = inject(MatDialog);
  protected readonly installAvailable = this.installer.available;
  protected readonly installSuggested = this.installer.suggested;
  private readonly themeService = inject(ThemeService);
  protected readonly themes = THEMES;
  protected readonly theme = this.themeService.preference;
  private readonly themeOption = computed(
    () => THEMES.find((option) => option.value === this.theme()) ?? THEMES[0],
  );
  protected readonly themeIcon = computed(() => this.themeOption().icon);
  protected readonly themeLabel = computed(() => this.themeOption().label.toLowerCase());
  private readonly main = viewChild.required<ElementRef<HTMLElement>>('main');
  /** Ruta de la pantalla actual, sin parámetros de consulta. */
  private currentPath: string | null = null;

  constructor() {
    this.sync.start();
    inject(UpdateService).start();
    inject(AgentTools).start();
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
      // Sin conexión no tiene sentido intentarlo: se navega con la copia local.
      if (this.status() !== 'expired' || !this.online()) return;
      // Por redirección se sale de la página: solo se hace con el botón, para
      // no perder por un toque cualquiera lo que se estuviera escribiendo.
      if (this.redirectMode()) return;
      this.auth.prepare();
      const stop = () => this.document.removeEventListener('click', onGesture, true);
      const onGesture = () => {
        stop();
        void this.resume();
      };
      this.document.addEventListener('click', onGesture, true);
      onCleanup(stop);
    });
    // Con sesión vigente y conexión el inventario se carga de Drive. Si falta
    // alguna de las dos (sin red, o sin poder renovar la sesión), se muestra
    // la copia guardada en el dispositivo y se sincroniza en cuanto se pueda.
    effect(() => {
      const session = this.status();
      const online = this.online();
      if (session === 'signedOut') return;
      untracked(() => void this.startInventory(session === 'signedIn' && online));
    });
  }

  private async startInventory(canReachDrive: boolean): Promise<void> {
    const inventory = this.inventory();
    if (inventory === 'loading') return;
    if (canReachDrive) {
      this.noLocalCopy.set(false);
      // Con datos ya al día no hay nada que hacer; el sondeo los mantiene.
      if (inventory !== 'ready' || this.store.stale()) this.load();
    } else if (inventory !== 'ready') {
      this.noLocalCopy.set(!(await this.store.showLocalCopy()));
    }
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

  protected install(): Promise<void> {
    return installApp(this.installer, this.dialog);
  }

  protected dismissInstall(): void {
    this.installer.dismiss();
  }

  protected setTheme(preference: ThemePreference): void {
    this.themeService.set(preference);
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
