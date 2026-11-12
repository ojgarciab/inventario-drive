import { Component, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatToolbarModule } from '@angular/material/toolbar';
import { Router, RouterOutlet } from '@angular/router';
import { authErrorMessage } from './core/auth/auth-messages';
import { AuthService } from './core/auth/auth-service';

@Component({
  imports: [MatButtonModule, MatIconModule, MatMenuModule, MatToolbarModule, RouterOutlet],
  selector: 'app-root',
  styleUrl: './app.scss',
  templateUrl: './app.html',
})
export class App {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  protected readonly user = this.auth.user;
  protected readonly status = this.auth.status;
  protected readonly resumeError = signal<string | null>(null);

  protected async resume(): Promise<void> {
    this.resumeError.set(null);
    try {
      await this.auth.signIn();
    } catch (error) {
      this.resumeError.set(authErrorMessage(error));
    }
  }

  protected async signOut(): Promise<void> {
    this.auth.signOut();
    await this.router.navigateByUrl('/login');
  }
}
