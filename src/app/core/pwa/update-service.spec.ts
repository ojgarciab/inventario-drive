import { TestBed } from '@angular/core/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { SwUpdate } from '@angular/service-worker';
import { Subject } from 'rxjs';
import { UpdateService } from './update-service';

describe('UpdateService', () => {
  const versionUpdates = new Subject<{ type: string }>();
  const unrecoverable = new Subject<unknown>();
  let action = new Subject<void>();
  const open = vi.fn(() => ({ onAction: () => action.asObservable() }));
  const sw = {
    isEnabled: true,
    versionUpdates,
    unrecoverable,
    checkForUpdate: vi.fn().mockResolvedValue(false),
    activateUpdate: vi.fn().mockResolvedValue(true),
  };

  function setup(provideSw = true) {
    TestBed.configureTestingModule({
      providers: [
        { provide: MatSnackBar, useValue: { open } },
        ...(provideSw ? [{ provide: SwUpdate, useValue: sw }] : []),
      ],
    });
    return TestBed.inject(UpdateService);
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    action = new Subject<void>(); // cada aviso de cada prueba, con su propio botón
    sw.isEnabled = true;
  });
  afterEach(() => {
    TestBed.resetTestingModule();
    vi.useRealTimers();
  });

  it('avisa cuando hay una versión nueva lista, y no antes', () => {
    setup().start();
    versionUpdates.next({ type: 'VERSION_DETECTED' });
    versionUpdates.next({ type: 'NO_NEW_VERSION_DETECTED' });
    expect(open).not.toHaveBeenCalled();

    versionUpdates.next({ type: 'VERSION_READY' });
    expect(open).toHaveBeenCalledWith('Hay una versión nueva de la aplicación.', 'Actualizar');
  });

  it('no aplica la versión nueva hasta que el usuario lo pide', () => {
    setup().start();
    versionUpdates.next({ type: 'VERSION_READY' });
    expect(sw.activateUpdate).not.toHaveBeenCalled();

    // La recarga posterior no se puede observar en el entorno de pruebas.
    action.next();
    expect(sw.activateUpdate).toHaveBeenCalledTimes(1);
  });

  it('pide recargar si la caché queda inservible', () => {
    setup().start();
    unrecoverable.next({});
    expect(open).toHaveBeenCalledWith(
      'La aplicación necesita recargarse para seguir funcionando.',
      'Actualizar',
    );
  });

  it('comprueba si hay versión nueva cada hora y al volver a primer plano', () => {
    setup().start();
    expect(sw.checkForUpdate).not.toHaveBeenCalled();
    vi.advanceTimersByTime(60 * 60 * 1000);
    expect(sw.checkForUpdate).toHaveBeenCalledTimes(1);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(sw.checkForUpdate).toHaveBeenCalledTimes(2);
  });

  it('no hace nada sin service worker (desarrollo) ni si está desactivado', () => {
    setup(false).start();
    TestBed.resetTestingModule();
    sw.isEnabled = false;
    setup().start();
    versionUpdates.next({ type: 'VERSION_READY' });
    vi.advanceTimersByTime(2 * 60 * 60 * 1000);
    expect(open).not.toHaveBeenCalled();
    expect(sw.checkForUpdate).not.toHaveBeenCalled();
  });

  it('arrancarlo dos veces no duplica los avisos', () => {
    const service = setup();
    service.start();
    service.start();
    versionUpdates.next({ type: 'VERSION_READY' });
    expect(open).toHaveBeenCalledTimes(1);
  });
});
