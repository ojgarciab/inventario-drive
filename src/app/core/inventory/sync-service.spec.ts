import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AuthService, AuthStatus } from '../auth/auth-service';
import { Connectivity } from '../pwa/connectivity';
import { InventoryStore, StoreStatus } from './inventory-store';
import { SYNC_INTERVAL_MS, SyncService } from './sync-service';

describe('SyncService', () => {
  const auth = signal<AuthStatus>('signedIn');
  const online = signal(true);
  const ready = signal<StoreStatus>('ready');
  const refresh = vi.fn().mockResolvedValue(undefined);
  let visibility: DocumentVisibilityState;
  let sync: SyncService;

  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    auth.set('signedIn');
    online.set(true);
    ready.set('ready');
    refresh.mockClear();
    visibility = 'visible';
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
    TestBed.configureTestingModule({
      providers: [
        { provide: SYNC_INTERVAL_MS, useValue: 20_000 },
        { provide: AuthService, useValue: { status: auth } },
        { provide: Connectivity, useValue: { online } },
        { provide: InventoryStore, useValue: { status: ready, refresh } },
      ],
    });
    sync = TestBed.inject(SyncService);
  });

  afterEach(() => {
    TestBed.resetTestingModule(); // detiene el temporizador y quita los oyentes
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('consulta los cambios cada 20 segundos mientras la aplicación está visible', () => {
    sync.start();
    expect(refresh).not.toHaveBeenCalled();
    vi.advanceTimersByTime(19_999);
    expect(refresh).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(refresh).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(40_000);
    expect(refresh).toHaveBeenCalledTimes(3);
  });

  it('no consulta en segundo plano y lo hace al volver a primer plano', () => {
    sync.start();
    visibility = 'hidden';
    vi.advanceTimersByTime(60_000);
    expect(refresh).not.toHaveBeenCalled();

    visibility = 'visible';
    document.dispatchEvent(new Event('visibilitychange'));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('consulta al recuperar el foco o la conexión', () => {
    sync.start();
    window.dispatchEvent(new Event('focus'));
    window.dispatchEvent(new Event('online'));
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('no consulta sin conexión, sin sesión vigente ni sin inventario cargado', () => {
    sync.start();
    online.set(false);
    vi.advanceTimersByTime(20_000);
    online.set(true);
    auth.set('expired');
    vi.advanceTimersByTime(20_000);
    auth.set('signedOut');
    vi.advanceTimersByTime(20_000);
    auth.set('signedIn');
    ready.set('loading');
    vi.advanceTimersByTime(20_000);
    expect(refresh).not.toHaveBeenCalled();

    ready.set('ready');
    vi.advanceTimersByTime(20_000);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('arrancarlo dos veces no duplica las consultas', () => {
    sync.start();
    sync.start();
    vi.advanceTimersByTime(20_000);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  describe('preferencia del dispositivo', () => {
    it('está activada por defecto', () => {
      expect(sync.autoSync()).toBe(true);
    });

    it('desactivada, no consulta ni por tiempo ni al volver a primer plano', () => {
      sync.start();
      sync.setAutoSync(false);

      vi.advanceTimersByTime(60_000);
      window.dispatchEvent(new Event('focus'));
      window.dispatchEvent(new Event('online'));
      document.dispatchEvent(new Event('visibilitychange'));

      expect(sync.autoSync()).toBe(false);
      expect(refresh).not.toHaveBeenCalled();
    });

    it('al reactivarla consulta enseguida y retoma el intervalo', () => {
      sync.start();
      sync.setAutoSync(false);
      sync.setAutoSync(true);
      expect(refresh).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(20_000);
      expect(refresh).toHaveBeenCalledTimes(2);
    });

    it('se guarda en este dispositivo y se recupera al volver a abrir la aplicación', () => {
      sync.setAutoSync(false);
      expect(localStorage.getItem('inventario.sincronizacion')).toBe('off');

      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [
          { provide: AuthService, useValue: { status: auth } },
          { provide: Connectivity, useValue: { online } },
          { provide: InventoryStore, useValue: { status: ready, refresh } },
        ],
      });
      const reopened = TestBed.inject(SyncService);
      expect(reopened.autoSync()).toBe(false);

      reopened.setAutoSync(true);
      expect(localStorage.getItem('inventario.sincronizacion')).toBeNull();
    });
  });
});
