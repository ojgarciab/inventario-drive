import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { App } from './app';
import { AuthService, AuthStatus, UserProfile } from './core/auth/auth-service';
import { InMemoryInventoryRepository } from './core/inventory/in-memory-inventory-repository';
import { InventoryRepository } from './core/inventory/inventory-repository';
import { InventoryStore } from './core/inventory/inventory-store';
import { Connectivity } from './core/pwa/connectivity';

const casa: UserProfile = { name: 'Casa', email: 'casa@example.com', photoUrl: null };

describe('App', () => {
  const status = signal<AuthStatus>('signedOut');
  const user = signal<UserProfile | null>(null);
  const signIn = vi.fn().mockResolvedValue(undefined);
  const signOut = vi.fn();
  const online = signal(true);

  async function render(repository = new InMemoryInventoryRepository()) {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        provideRouter([]),
        { provide: InventoryRepository, useValue: repository },
        { provide: AuthService, useValue: { status, user, signIn, signOut } },
        { provide: Connectivity, useValue: { online } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(App);
    const settle = async () => {
      await fixture.whenStable();
      await new Promise((resolve) => setTimeout(resolve));
      await fixture.whenStable();
    };
    await settle();
    return {
      el: fixture.nativeElement as HTMLElement,
      settle,
      store: TestBed.inject(InventoryStore),
    };
  }

  it('sin sesión muestra el título, oculta la cuenta y no carga el inventario', async () => {
    status.set('signedOut');
    user.set(null);
    const { el, store } = await render();
    expect(el.querySelector('mat-toolbar')?.textContent).toContain('Inventario del hogar');
    expect(el.querySelector('[aria-label="Cuenta"]')).toBeNull();
    expect(el.querySelector('router-outlet')).not.toBeNull();
    expect(store.status()).toBe('idle');
  });

  it('con sesión carga el inventario antes de mostrar las pantallas', async () => {
    status.set('signedIn');
    user.set(casa);
    const { el, store } = await render();
    expect(store.status()).toBe('ready');
    expect(el.querySelector('router-outlet')).not.toBeNull();
    expect(el.querySelector('[aria-label="Cuenta"]')).not.toBeNull();
  });

  it('ofrece reintentar si la carga falla', async () => {
    status.set('signedIn');
    user.set(casa);
    const repository = new InMemoryInventoryRepository();
    vi.spyOn(repository, 'loadAll').mockRejectedValueOnce(new Error('sin red'));
    const { el, settle, store } = await render(repository);
    expect(el.querySelector('router-outlet')).toBeNull();
    expect(el.querySelector('.load-error')).not.toBeNull();

    el.querySelector<HTMLButtonElement>('main button')?.click();
    await settle();
    expect(store.status()).toBe('ready');
    expect(el.querySelector('router-outlet')).not.toBeNull();
  });

  it('ofrece reanudar la sesión cuando ha caducado', async () => {
    status.set('expired');
    user.set(casa);
    const { el } = await render();
    el.querySelector<HTMLButtonElement>('.resume button')?.click();
    expect(signIn).toHaveBeenCalled();
  });

  it('avisa cuando no hay conexión', async () => {
    status.set('signedIn');
    user.set(casa);
    online.set(true);
    const { el, settle } = await render();
    expect(el.querySelector('.offline')).toBeNull();

    online.set(false);
    await settle();
    expect(el.querySelector('.offline')?.textContent).toContain('Sin conexión');
    online.set(true);
  });
});
