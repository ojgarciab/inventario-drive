import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { InventoryStore } from '../../core/inventory/inventory-store';
import { clickOn, setupApp, texts } from '../../testing';

/** casa > dormitorio > armario > caja > adornos ; casa > salón > aparador */
async function house(store: InventoryStore) {
  const box = (name: string, parentId: string | null) =>
    store.addContainer({ name, typeId: null, parentId });
  const casa = await box('Casa', null);
  const dormitorio = await box('Dormitorio', casa.id);
  const armario = await box('Armario', dormitorio.id);
  const caja = await box('Caja', armario.id);
  const adornos = await store.addItem({ name: 'Adornos', parentId: caja.id });
  const salon = await box('Salón', casa.id);
  const aparador = await box('Aparador', salon.id);
  return { casa, dormitorio, armario, caja, adornos, salon, aparador };
}

const crumbs = (el: HTMLElement) => texts(el, 'nav[aria-label="Destino"] button');
const confirmButton = (el: HTMLElement) => el.querySelector<HTMLButtonElement>('.confirm');

describe('Move', () => {
  it('empieza donde está la entidad y no deja moverla al mismo sitio', async () => {
    const { open, store } = await setupApp();
    const h = await house(store);

    const el = await open(`/mover/${h.caja.id}`);

    expect(el.querySelector('h1')?.textContent).toBe('Mover «Caja»');
    expect(crumbs(el)).toEqual(['Inicio', 'Casa', 'Dormitorio', 'Armario']);
    expect(confirmButton(el)?.textContent?.trim()).toBe('Ya está aquí');
    expect(confirmButton(el)?.disabled).toBe(true);
  });

  it('traslada una caja a un mueble de otra habitación navegando hasta él', async () => {
    const { open, settle, store } = await setupApp();
    const h = await house(store);
    const el = await open(`/mover/${h.caja.id}`);

    clickOn('nav[aria-label="Destino"] button', 'Casa');
    await settle();
    expect(texts(el, '[matListItemTitle]')).toEqual(['Dormitorio', 'Salón']);
    clickOn('mat-nav-list button', 'Salón');
    await settle();
    clickOn('mat-nav-list button', 'Aparador');
    await settle();
    expect(crumbs(el)).toEqual(['Inicio', 'Casa', 'Salón', 'Aparador']);
    expect(confirmButton(el)?.textContent?.trim()).toBe('Mover a Aparador');

    confirmButton(el)?.click();
    await settle();

    expect(store.path(h.adornos.id).map((e) => e.name)).toEqual([
      'Casa',
      'Salón',
      'Aparador',
      'Caja',
      'Adornos',
    ]);
    expect(TestBed.inject(Router).url).toBe(`/c/${h.caja.id}`);
  });

  it('no deja elegir como destino lo que se está moviendo', async () => {
    const { open, settle, store } = await setupApp();
    const h = await house(store);
    const el = await open(`/mover/${h.dormitorio.id}`);

    const rows = [...el.querySelectorAll<HTMLButtonElement>('mat-nav-list button')];
    expect(rows.map((row) => [row.textContent?.includes('Dormitorio'), row.disabled])).toEqual([
      [true, true],
      [false, false],
    ]);
    expect(texts(el, '[matListItemLine]')).toEqual(['Es lo que está moviendo']);

    clickOn('mat-nav-list button', 'Dormitorio'); // deshabilitado: no navega
    await settle();
    expect(crumbs(el)).toEqual(['Inicio', 'Casa']);
  });

  it('mueve un objeto al inicio', async () => {
    const { open, settle, store } = await setupApp();
    const h = await house(store);
    const el = await open(`/mover/${h.adornos.id}`);

    clickOn('nav[aria-label="Destino"] button', 'Inicio');
    await settle();
    expect(confirmButton(el)?.textContent?.trim()).toBe('Mover a Inicio');
    confirmButton(el)?.click();
    await settle();

    expect(store.get(h.adornos.id)?.parentId).toBeNull();
    expect(TestBed.inject(Router).url).toBe(`/o/${h.adornos.id}`);
  });

  it('muestra el error si Drive falla y deja reintentar', async () => {
    const { open, settle, store, repository } = await setupApp();
    const h = await house(store);
    vi.spyOn(repository, 'updateEntity').mockRejectedValueOnce(new Error('sin red'));
    const el = await open(`/mover/${h.adornos.id}`);

    clickOn('nav[aria-label="Destino"] button', 'Inicio');
    await settle();
    confirmButton(el)?.click();
    await settle();

    expect(el.querySelector('[role="alert"]')?.textContent).toContain('No se ha podido guardar');
    expect(store.get(h.adornos.id)?.parentId).toBe(h.caja.id);
    expect(confirmButton(el)?.disabled).toBe(false);
  });

  it('avisa si lo que se quiere mover no existe', async () => {
    const { open } = await setupApp();
    const el = await open('/mover/no-existe');
    expect(el.querySelector('[role="alert"]')?.textContent).toContain('ya no existe');
  });
});
