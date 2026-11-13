import { TestBed } from '@angular/core/testing';
import { INSTALLABLE_EVENT, InstallPromptEvent, InstallService } from './install-service';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Evento de instalación simulado, como el que emite Chrome. */
function fakePrompt(outcome: 'accepted' | 'dismissed' = 'accepted') {
  const event = new Event('beforeinstallprompt') as InstallPromptEvent;
  event.prompt = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(event, 'userChoice', { value: Promise.resolve({ outcome }) });
  return event;
}

/** Como hace `main.ts` al recibir el evento del navegador. */
function announce(event: InstallPromptEvent): void {
  window.inventarioInstallPrompt = event;
  window.dispatchEvent(new Event(INSTALLABLE_EVENT));
}

describe('InstallService', () => {
  beforeEach(() => {
    localStorage.clear();
    window.inventarioInstallPrompt = undefined;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    window.inventarioInstallPrompt = undefined;
  });

  it('no ofrece instalar mientras el navegador no diga que se puede', () => {
    const install = TestBed.inject(InstallService);
    expect(install.available()).toBe(false);
    expect(install.suggested()).toBe(false);
    expect(install.state()).toBe('unavailable');
  });

  it('usa el evento que llegó antes de arrancar la aplicación', () => {
    window.inventarioInstallPrompt = fakePrompt();
    const install = TestBed.inject(InstallService);
    expect(install.suggested()).toBe(true);
  });

  it('ofrece instalar cuando el navegador lo permite y abre su diálogo', async () => {
    const install = TestBed.inject(InstallService);
    const event = fakePrompt();
    announce(event);
    expect(install.available()).toBe(true);
    expect(install.suggested()).toBe(true);

    expect(await install.install()).toBe(true);

    expect(event.prompt).toHaveBeenCalled();
    expect(install.available()).toBe(false);
    expect(window.inventarioInstallPrompt).toBeUndefined();
  });

  it('si el usuario no instala, la opción vuelve cuando el navegador lo permite de nuevo', async () => {
    const install = TestBed.inject(InstallService);
    announce(fakePrompt('dismissed'));
    await install.install();
    expect(install.available()).toBe(false);

    announce(fakePrompt());
    expect(install.available()).toBe(true);
  });

  it('al cerrar el aviso deja de sugerirse, pero se puede seguir instalando', () => {
    const install = TestBed.inject(InstallService);
    announce(fakePrompt());

    install.dismiss();

    expect(install.suggested()).toBe(false);
    expect(install.available()).toBe(true);
    expect(Number(localStorage.getItem('inventario.instalacion'))).toBeCloseTo(Date.now(), -3);
  });

  it('un aviso cerrado hace menos de siete días sigue oculto', () => {
    localStorage.setItem('inventario.instalacion', String(Date.now() - 6 * DAY_MS));
    window.inventarioInstallPrompt = fakePrompt();
    const install = TestBed.inject(InstallService);
    expect(install.suggested()).toBe(false);
    expect(install.available()).toBe(true);
  });

  it('pasados siete días el aviso vuelve a mostrarse', () => {
    localStorage.setItem('inventario.instalacion', String(Date.now() - 7 * DAY_MS - 1000));
    window.inventarioInstallPrompt = fakePrompt();
    expect(TestBed.inject(InstallService).suggested()).toBe(true);
  });

  it('ignora una anotación que no entiende o con fecha futura', () => {
    window.inventarioInstallPrompt = fakePrompt();
    localStorage.setItem('inventario.instalacion', 'no');
    expect(TestBed.inject(InstallService).suggested()).toBe(true);

    TestBed.resetTestingModule();
    localStorage.setItem('inventario.instalacion', String(Date.now() + DAY_MS));
    expect(TestBed.inject(InstallService).suggested()).toBe(true);
  });

  it('deja de ofrecerlo cuando la aplicación queda instalada', () => {
    const install = TestBed.inject(InstallService);
    announce(fakePrompt());
    expect(install.state()).toBe('available');
    window.dispatchEvent(new Event('appinstalled'));
    expect(install.available()).toBe(false);
    expect(install.state()).toBe('installed');
  });

  it('no lo ofrece si ya se está usando como aplicación instalada', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('standalone') }));
    window.inventarioInstallPrompt = fakePrompt();
    const install = TestBed.inject(InstallService);
    expect(install.available()).toBe(false);
    expect(install.state()).toBe('installed');
  });

  it('en iPhone lo ofrece sin evento y pide mostrar instrucciones', async () => {
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0)' });
    const install = TestBed.inject(InstallService);
    expect(install.isIos).toBe(true);
    expect(install.suggested()).toBe(true);
    expect(await install.install()).toBe(false);
    expect(install.available()).toBe(true);
  });
});
