import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  ActivatedRouteSnapshot,
  RouterStateSnapshot,
  UrlTree,
  provideRouter,
} from '@angular/router';
import { authGuard, guestGuard } from './auth-guard';
import { AuthService, AuthStatus } from './auth-service';

describe('guardas de sesión', () => {
  const status = signal<AuthStatus>('signedOut');
  const run = (guard: typeof authGuard) =>
    TestBed.runInInjectionContext(() =>
      guard({} as ActivatedRouteSnapshot, {} as RouterStateSnapshot),
    );

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: AuthService, useValue: { status } }],
    });
  });

  it('sin sesión, envía a la pantalla de inicio de sesión', () => {
    status.set('signedOut');
    expect(String(run(authGuard) as UrlTree)).toBe('/login');
    expect(run(guestGuard)).toBe(true);
  });

  it('con sesión, deja pasar y oculta la pantalla de inicio de sesión', () => {
    status.set('signedIn');
    expect(run(authGuard)).toBe(true);
    expect(String(run(guestGuard) as UrlTree)).toBe('/');
  });

  it('con la sesión caducada mantiene al usuario dentro para que la reanude', () => {
    status.set('expired');
    expect(run(authGuard)).toBe(true);
  });
});
