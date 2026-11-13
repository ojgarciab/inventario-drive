import { DOCUMENT, Injectable, computed, inject, signal } from '@angular/core';

/** Evento de Chromium con el que se abre el diálogo de instalación cuando se quiera. */
export interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

declare global {
  interface Window {
    /** Lo guarda `main.ts` si el navegador lo emite antes de arrancar Angular. */
    inventarioInstallPrompt?: InstallPromptEvent;
  }
}

/** Evento propio con el que `main.ts` avisa de que ya se puede instalar. */
export const INSTALLABLE_EVENT = 'inventario-instalable';
/** Anotación, en este dispositivo, de que el usuario cerró el aviso de instalación. */
const DISMISSED_KEY = 'inventario.instalacion';

/**
 * Instalación como aplicación (PWA). Chrome, Edge y Samsung Internet ya no
 * muestran por su cuenta un aviso visible: emiten `beforeinstallprompt` y es
 * la página la que debe ofrecer la instalación. En iPhone y iPad no hay
 * diálogo y solo se pueden dar instrucciones.
 */
@Injectable({ providedIn: 'root' })
export class InstallService {
  private readonly window = inject(DOCUMENT).defaultView as Window;
  private event = this.window.inventarioInstallPrompt;

  private readonly installed =
    this.window.matchMedia?.('(display-mode: standalone)').matches === true ||
    (this.window.navigator as Navigator & { standalone?: boolean }).standalone === true;

  /** iPhone o iPad (los iPad recientes se presentan como Mac con pantalla táctil). */
  readonly isIos =
    /iphone|ipad|ipod/i.test(this.window.navigator.userAgent) ||
    (/macintosh/i.test(this.window.navigator.userAgent) &&
      this.window.navigator.maxTouchPoints > 1);

  private readonly installable = signal(!this.installed && (!!this.event || this.isIos));
  private readonly dismissed = signal(readDismissed());

  /** Se puede instalar: la opción «Instalar aplicación» tiene sentido. */
  readonly available = this.installable.asReadonly();
  /** Conviene mostrar el aviso: se puede instalar y el usuario no lo ha cerrado. */
  readonly suggested = computed(() => this.installable() && !this.dismissed());

  constructor() {
    this.window.addEventListener(INSTALLABLE_EVENT, () => {
      this.event = this.window.inventarioInstallPrompt;
      if (!this.installed) this.installable.set(true);
    });
    this.window.addEventListener('appinstalled', () => this.installable.set(false));
  }

  /** Abre el diálogo del navegador. Devuelve `false` si hay que mostrar instrucciones. */
  async install(): Promise<boolean> {
    const event = this.event;
    if (!event) return false;
    await event.prompt();
    await event.userChoice;
    // El evento solo sirve una vez. Si el usuario no instala, el navegador
    // emitirá otro cuando vuelva a ser posible y la opción reaparecerá.
    this.event = this.window.inventarioInstallPrompt = undefined;
    this.installable.set(false);
    return true;
  }

  /** Cierra el aviso y no lo vuelve a mostrar en este dispositivo. */
  dismiss(): void {
    this.dismissed.set(true);
    try {
      localStorage.setItem(DISMISSED_KEY, 'no');
    } catch {
      // Sin almacenamiento el aviso volverá en la próxima visita.
    }
  }
}

function readDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISSED_KEY) === 'no';
  } catch {
    return false;
  }
}
