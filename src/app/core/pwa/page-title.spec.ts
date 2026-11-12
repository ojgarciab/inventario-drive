import { TestBed } from '@angular/core/testing';
import { TitleStrategy } from '@angular/router';
import { setupApp } from '../../testing';
import { PageTitleStrategy } from './page-title';

describe('título de la página', () => {
  async function setup() {
    TestBed.configureTestingModule({
      providers: [{ provide: TitleStrategy, useClass: PageTitleStrategy }],
    });
    return setupApp();
  }

  it('las pantallas fijas llevan su nombre y el de la aplicación', async () => {
    const { open } = await setup();
    await open('/buscar');
    expect(document.title).toBe('Buscar · Inventario del hogar');
    await open('/ajustes');
    expect(document.title).toBe('Ajustes · Inventario del hogar');
    await open('/nuevo/objeto');
    expect(document.title).toBe('Nuevo objeto · Inventario del hogar');
  });

  it('las fichas llevan el nombre de lo que muestran y lo actualizan si cambia', async () => {
    const { open, settle, store } = await setup();
    const caja = await store.addContainer({ name: 'Caja azul', typeId: null });
    const item = await store.addItem({ name: 'Pilas', parentId: caja.id });

    await open(`/c/${caja.id}`);
    expect(document.title).toBe('Caja azul · Inventario del hogar');
    await store.update(caja.id, { name: 'Caja roja' });
    await settle();
    expect(document.title).toBe('Caja roja · Inventario del hogar');

    await open(`/o/${item.id}`);
    expect(document.title).toBe('Pilas · Inventario del hogar');
    await open('/');
    expect(document.title).toBe('Inicio · Inventario del hogar');
    await open('/c/no-existe');
    expect(document.title).toBe('No encontrado · Inventario del hogar');
  });
});
