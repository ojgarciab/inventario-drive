import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth-service';

/** Solo deja pasar con sesión (vigente o pendiente de reanudar). */
export const authGuard: CanActivateFn = () =>
  inject(AuthService).status() === 'signedOut' ? inject(Router).createUrlTree(['/login']) : true;

/** Evita mostrar la pantalla de inicio de sesión a quien ya tiene sesión. */
export const guestGuard: CanActivateFn = () =>
  inject(AuthService).status() === 'signedOut' ? true : inject(Router).createUrlTree(['/']);
