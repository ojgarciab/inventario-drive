import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';
import { INSTALLABLE_EVENT, InstallPromptEvent } from './app/core/pwa/install-service';

// Chrome puede emitir el evento de instalación antes de que arranque Angular:
// se guarda para ofrecer después la instalación desde la propia aplicación.
window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  window.inventarioInstallPrompt = event as InstallPromptEvent;
  window.dispatchEvent(new Event(INSTALLABLE_EVENT));
});

bootstrapApplication(App, appConfig).catch((err) => console.error(err));
