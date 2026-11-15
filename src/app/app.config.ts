import { provideHttpClient, withInterceptors } from '@angular/common/http';
import {
  ApplicationConfig,
  inject,
  isDevMode,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { MAT_ICON_DEFAULT_OPTIONS } from '@angular/material/icon';
import { TitleStrategy, provideRouter, withComponentInputBinding } from '@angular/router';
import { provideServiceWorker } from '@angular/service-worker';
import { routes } from './app.routes';
import { AuthService } from './core/auth/auth-service';
import { authInterceptor } from './core/auth/auth-interceptor';
import { DriveInventoryRepository } from './core/inventory/drive-inventory-repository';
import { InventoryRepository } from './core/inventory/inventory-repository';
import { PageTitleStrategy } from './core/pwa/page-title';
import { demoProviders } from './demo';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    // Antes de la primera navegación: si se vuelve de Google con el token en
    // la dirección, se recoge y se restaura la pantalla en la que se estaba.
    provideAppInitializer(() => inject(AuthService).completeRedirect()),
    provideRouter(routes, withComponentInputBinding()),
    { provide: TitleStrategy, useClass: PageTitleStrategy },
    provideHttpClient(withInterceptors([authInterceptor])),
    { provide: InventoryRepository, useClass: DriveInventoryRepository },
    { provide: MAT_ICON_DEFAULT_OPTIONS, useValue: { fontSet: 'material-symbols-outlined' } },
    ...demoProviders(), // sin efecto fuera del modo de demostración
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      registrationStrategy: 'registerWhenStable:30000',
    }),
  ],
};
