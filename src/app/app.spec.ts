import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { App } from './app';
import { AuthService, AuthStatus, UserProfile } from './core/auth/auth-service';

describe('App', () => {
  const status = signal<AuthStatus>('signedOut');
  const user = signal<UserProfile | null>(null);
  const signIn = vi.fn().mockResolvedValue(undefined);

  async function render() {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: { status, user, signIn, signOut: vi.fn() } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  it('muestra el título y oculta la cuenta sin sesión', async () => {
    status.set('signedOut');
    user.set(null);
    const el = await render();
    expect(el.querySelector('mat-toolbar')?.textContent).toContain('Inventario del hogar');
    expect(el.querySelector('[aria-label="Cuenta"]')).toBeNull();
    expect(el.querySelector('.resume')).toBeNull();
  });

  it('ofrece reanudar la sesión cuando ha caducado', async () => {
    status.set('expired');
    user.set({ name: 'Casa', email: 'casa@example.com', photoUrl: null });
    const el = await render();
    expect(el.querySelector('[aria-label="Cuenta"]')).not.toBeNull();
    el.querySelector<HTMLButtonElement>('.resume button')?.click();
    expect(signIn).toHaveBeenCalled();
  });
});
