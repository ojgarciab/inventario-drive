import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
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
  const prepare = vi.fn();
  const online = signal(true);

  async function render(repository = new InMemoryInventoryRepository()) {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        provideRouter([{ path: '**', children: [] }]),
        { provide: InventoryRepository, useValue: repository },
        { provide: AuthService, useValue: { status, user, signIn, signOut, prepare } },
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
    signIn.mockClear();
    status.set('expired');
    user.set(casa);
    const { el } = await render();
    expect(prepare).toHaveBeenCalled(); // la ventana de Google se abrirá sin demora
    el.querySelector<HTMLButtonElement>('.resume button')?.click();
    expect(signIn).toHaveBeenCalled();
  });

  it('con la sesión caducada la reanuda el primer toque en cualquier parte', async () => {
    signIn.mockClear();
    signIn.mockRejectedValueOnce(new Error('popup_closed'));
    status.set('expired');
    user.set(casa);
    const { el, settle } = await render();

    el.querySelector<HTMLElement>('mat-toolbar')?.click();
    await settle();
    expect(signIn).toHaveBeenCalledTimes(1);

    // Si falla no se insiste en cada toque: queda el botón.
    el.querySelector<HTMLElement>('mat-toolbar')?.click();
    expect(signIn).toHaveBeenCalledTimes(1);
    expect(el.querySelector('.resume button')).not.toBeNull();
  });

  it('con la sesión vigente los toques no piden nada', async () => {
    signIn.mockClear();
    status.set('signedIn');
    user.set(casa);
    const { el } = await render();
    el.querySelector<HTMLElement>('mat-toolbar')?.click();
    expect(signIn).not.toHaveBeenCalled();
  });

  it('permite forzar el tema desde la cabecera, también sin sesión', async () => {
    localStorage.clear();
    status.set('signedOut');
    user.set(null);
    const { el, settle } = await render();
    const button = el.querySelector<HTMLButtonElement>('button.theme');
    expect(button?.getAttribute('aria-label')).toBe('Tema: automático');

    button?.click();
    await settle();
    const options = [...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')];
    expect(options.map((o) => o.querySelector('span')?.textContent?.trim())).toEqual([
      'Automático',
      'Claro',
      'Oscuro',
    ]);
    expect(options.map((o) => o.getAttribute('aria-checked'))).toEqual(['true', 'false', 'false']);

    options[1].click();
    await settle();

    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(localStorage.getItem('inventario.tema')).toBe('light');
    expect(button?.getAttribute('aria-label')).toBe('Tema: claro');
    document.documentElement.removeAttribute('data-theme');
    localStorage.clear();
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

  it('permite desactivar la sincronización automática desde el menú de cuenta', async () => {
    localStorage.clear();
    status.set('signedIn');
    user.set(casa);
    const { el, settle } = await render();
    const item = () =>
      [...document.querySelectorAll<HTMLElement>('[role="menuitemcheckbox"]')].find((b) =>
        b.textContent?.includes('Sincronización automática'),
      );

    el.querySelector<HTMLButtonElement>('[aria-label="Cuenta"]')?.click();
    await settle();
    expect(item()?.getAttribute('aria-checked')).toBe('true');

    item()?.click();
    await settle();
    expect(localStorage.getItem('inventario.sincronizacion')).toBe('off');

    el.querySelector<HTMLButtonElement>('[aria-label="Cuenta"]')?.click();
    await settle();
    expect(item()?.getAttribute('aria-checked')).toBe('false');
    localStorage.clear();
  });

  it('al cambiar de pantalla lleva el foco al contenido, pero no al cambiar solo los parámetros', async () => {
    status.set('signedIn');
    user.set(casa);
    const { el, settle } = await render();
    const router = TestBed.inject(Router);
    const main = el.querySelector('main') as HTMLElement;
    const button = el.querySelector('[aria-label="Cuenta"]') as HTMLElement;

    await router.navigateByUrl('/');
    await settle();
    button.focus();
    await router.navigateByUrl('/?q=uno'); // como hace la búsqueda al escribir
    await settle();
    expect(document.activeElement).toBe(button);

    await router.navigateByUrl('/otra');
    await settle();
    expect(document.activeElement).toBe(main);
  });

  it('ofrece un enlace para saltar al contenido con el teclado', async () => {
    status.set('signedOut');
    user.set(null);
    const { el } = await render();
    const skip = el.querySelector<HTMLAnchorElement>('a.skip');
    expect(skip?.textContent).toBe('Saltar al contenido');
    skip?.click();
    expect(document.activeElement).toBe(el.querySelector('main'));
  });
});
