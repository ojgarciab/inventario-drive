import { Component, inject } from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { SwUpdate } from '@angular/service-worker';
import { environment } from '../../../environments/environment';

/** Pantalla provisional de la fase 1: muestra el estado del esqueleto. */
@Component({
  imports: [MatCardModule],
  selector: 'app-home',
  styleUrl: './home.scss',
  templateUrl: './home.html',
})
export class Home {
  protected readonly clienteConfigurado = environment.googleClientId !== '';
  protected readonly serviceWorkerActivo = inject(SwUpdate, { optional: true })?.isEnabled ?? false;
}
