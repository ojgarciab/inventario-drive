import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { InventoryStore } from '../../core/inventory/inventory-store';
import { clickOn, setupApp, texts, typeInto } from '../../testing';

async function house(store: InventoryStore) {
  const box = (name: string, parentId: string | null) =>
    store.addContainer({ name, typeId: null, parentId });
  const casa = await box('Casa', null);
  const dormitorio = await box('Dormitorio', casa.id);
  const caja = await box('Caja de Navidad', dormitorio.id);
  const arbol = await store.addItem({ name: 'Árbol', parentId: caja.id, tags: ['navidad'] });
  await store.addItem({ name: 'Bolas', parentId: caja.id, notes: 'Para el árbol' });
  const suelto = await store.addItem({ name: 'Paraguas' });
  return { casa, dormitorio, caja, arbol, suelto };
}

describe('Search', () => {
  it('invita a escribir cuando no hay búsqueda', async () => {
    const { open } = await setupApp();
    const el = await open('/buscar');
    expect(el.querySelector('.hint')?.textContent).toContain('Escriba para buscar');
    expect(el.querySelector('mat-nav-list')).toBeNull();
    expect(document.activeElement).toBe(el.querySelector('input'));
  });

  it('busca al escribir y muestra dónde está cada resultado', async () => {
    const { open, settle, store } = await setupApp();
    const h = await house(store);
    const el = await open('/buscar');

    typeInto(el, 'input', 'arbol');
    await settle();

    expect(TestBed.inject(Router).url).toBe('/buscar?q=arbol');
    expect(el.querySelector('.count')?.textContent?.trim()).toBe('2 resultados');
    // Primero lo que coincide por nombre; después, por notas o etiquetas.
    expect(texts(el, '[matListItemTitle]')).toEqual(['Árbol', 'Bolas']);
    expect(texts(el, '[matListItemLine]')).toEqual([
      'Caja de Navidad ‹ Dormitorio ‹ Casa',
      'Caja de Navidad ‹ Dormitorio ‹ Casa',
    ]);
    expect(el.querySelector('mat-nav-list a')?.getAttribute('href')).toBe(`/o/${h.arbol.id}`);
  });

  it('encuentra contenedores y objetos por nombre o etiqueta', async () => {
    const { open, store } = await setupApp();
    const h = await house(store);

    const el = await open('/buscar?q=NAVIDAD');

    expect(el.querySelector<HTMLInputElement>('input')?.value).toBe('NAVIDAD');
    expect(texts(el, '[matListItemTitle]')).toEqual(['Caja de Navidad', 'Árbol']);
    expect(el.querySelector('mat-nav-list a')?.getAttribute('href')).toBe(`/c/${h.caja.id}`);
  });

  it('indica lo que está en el inicio y lo que está sin ubicar', async () => {
    const { open, store } = await setupApp();
    const h = await house(store);
    expect(texts(await open('/buscar?q=paraguas'), '[matListItemLine]')).toEqual(['En el inicio']);

    store.applyRemote({ removedIds: [h.caja.id] });
    const el = await open('/buscar?q=bolas');
    expect(texts(el, '[matListItemLine]')).toEqual(['Sin ubicar']);
  });

  it('avisa cuando no hay resultados y permite borrar la búsqueda', async () => {
    const { open, settle, store } = await setupApp();
    await house(store);
    const el = await open('/buscar?q=destornillador');
    expect(el.querySelector('.hint')?.textContent).toContain(
      'No hay resultados para «destornillador»',
    );

    clickOn('[aria-label="Borrar la búsqueda"]');
    await settle();

    expect(TestBed.inject(Router).url).toBe('/buscar');
    expect(el.querySelector<HTMLInputElement>('input')?.value).toBe('');
  });

  it('no incluye lo que está en la papelera', async () => {
    const { open, store } = await setupApp();
    const h = await house(store);
    await store.remove(h.suelto.id);
    const el = await open('/buscar?q=paraguas');
    expect(el.querySelector('mat-nav-list')).toBeNull();
  });

  it('limita los resultados mostrados y lo indica', async () => {
    const { open, store } = await setupApp();
    for (let i = 0; i < 105; i++) await store.addItem({ name: `Tornillo ${i}` });
    const el = await open('/buscar?q=tornillo');
    expect(el.querySelectorAll('mat-nav-list a').length).toBe(100);
    expect(el.querySelector('.count')?.textContent).toContain('105 resultados');
    expect(el.querySelector('.count')?.textContent).toContain('se muestran los 100 primeros');
  });
});
