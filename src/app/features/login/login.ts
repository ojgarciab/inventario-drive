import { Component, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { Router } from '@angular/router';
import { authErrorMessage } from '../../core/auth/auth-messages';
import { AuthService } from '../../core/auth/auth-service';

@Component({
  imports: [MatButtonModule, MatCardModule, MatProgressBarModule],
  selector: 'app-login',
  styleUrl: './login.scss',
  templateUrl: './login.html',
})
export class Login {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  protected readonly busy = signal(false);
  /** Si se volvió de Google con un error (redirección), se muestra al llegar. */
  protected readonly error = signal<string | null>(
    this.auth.redirectError() ? authErrorMessage(this.auth.redirectError()) : null,
  );
  protected readonly redirectMode = this.auth.redirectMode;

  /** `popup` usa la ventana emergente aunque esté elegida la redirección. */
  protected async signIn(popup = false): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.auth.signIn({ popup });
      await this.router.navigateByUrl('/');
    } catch (error) {
      this.error.set(authErrorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }
}
