import { Component, effect, inject, signal, untracked } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatToolbarModule } from '@angular/material/toolbar';
import { Router, RouterLink, RouterOutlet } from '@angular/router';
import { authErrorMessage } from './core/auth/auth-messages';
import { AuthService } from './core/auth/auth-service';
import { InventoryStore } from './core/inventory/inventory-store';
import { SyncService } from './core/inventory/sync-service';
import { PhotoService } from './core/photos/photo-service';
import { Connectivity } from './core/pwa/connectivity';

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

  protected readonly user = this.auth.user;
  protected readonly status = this.auth.status;
  protected readonly inventory = this.store.status;
  protected readonly online = inject(Connectivity).online;
  protected readonly autoSync = this.sync.autoSync;
  protected readonly resumeError = signal<string | null>(null);

  constructor() {
    this.sync.start();
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
