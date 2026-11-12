import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { routes } from './app.routes';
import { AuthService, AuthStatus } from './core/auth/auth-service';
import { InMemoryInventoryRepository } from './core/inventory/in-memory-inventory-repository';
import { InventoryRepository } from './core/inventory/inventory-repository';
import { InventoryStore } from './core/inventory/inventory-store';

/**
 * Monta las rutas reales de la aplicación sobre un inventario en memoria ya
 * cargado y con sesión iniciada. Solo para pruebas.
 */
export async function setupApp() {
  const repository = new InMemoryInventoryRepository();
  TestBed.configureTestingModule({
    providers: [
      provideRouter(routes, withComponentInputBinding()),
      { provide: InventoryRepository, useValue: repository },
      { provide: AuthService, useValue: { status: signal<AuthStatus>('signedIn') } },
    ],
  });
  const store = TestBed.inject(InventoryStore);
  await store.load();
  const harness = await RouterTestingHarness.create();

  /** Navega y devuelve el elemento de la pantalla mostrada. */
  const open = async (url: string): Promise<HTMLElement> => {
    await harness.navigateByUrl(url);
    await harness.fixture.whenStable();
    return harness.routeNativeElement as HTMLElement;
  };
  /** Espera a que terminen el guardado y la navegación posterior. */
  const settle = async (): Promise<HTMLElement> => {
    await new Promise((resolve) => setTimeout(resolve));
    await harness.fixture.whenStable();
    return harness.routeNativeElement as HTMLElement;
  };
  /** Espera a que se cumpla una condición que depende de animaciones (diálogos, avisos). */
  const until = async (condition: () => boolean): Promise<HTMLElement> => {
    for (let attempt = 0; attempt < 100 && !condition(); attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      await harness.fixture.whenStable();
    }
    if (!condition()) throw new Error('La condición esperada no llegó a cumplirse');
    return settle();
  };
  const typeId = (name: string) => store.types().find((type) => type.name === name)?.id ?? null;

  return { store, repository, harness, open, settle, until, typeId };
}

/** Escribe en un campo de formulario como lo haría el usuario. */
export function typeInto(root: HTMLElement, selector: string, value: string): void {
  const field = root.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector);
  if (!field) throw new Error(`No existe el campo ${selector}`);
  field.value = value;
  field.dispatchEvent(new Event('input'));
}

export const texts = (root: HTMLElement, selector: string): string[] =>
  [...root.querySelectorAll(selector)].map((el) => el.textContent?.trim() ?? '');

/** Pulsa un elemento de la página o de una capa superpuesta (menú, diálogo, aviso). */
export function clickOn(selector: string, text?: string): void {
  const element = [...document.querySelectorAll<HTMLElement>(selector)].find(
    (el) => text === undefined || el.textContent?.includes(text),
  );
  if (!element) throw new Error(`No existe ${selector}${text ? ` con «${text}»` : ''}`);
  element.click();
}
