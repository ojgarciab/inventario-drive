import { Component, inject } from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { AuthService } from '../../core/auth/auth-service';

/** Pantalla provisional: confirma la sesión hasta que exista el inventario (fase 4). */
@Component({
  imports: [MatCardModule],
  selector: 'app-home',
  styleUrl: './home.scss',
  templateUrl: './home.html',
})
export class Home {
  protected readonly user = inject(AuthService).user;
}
