import { TestBed } from '@angular/core/testing';
import { DOWNLOADER } from '../../shared/download';
import { clickOn, setupApp, texts, typeInto } from '../../testing';

/** Simula que el usuario elige un archivo de copia. */
function choose(el: HTMLElement, file: Blob): void {
  const input = el.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error('No existe el selector de archivo');
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new Event('change'));
}

const dialogClosed = () => document.querySelector('mat-dialog-container') === null;
const snack = () => document.querySelector('mat-snack-bar-container')?.textContent ?? '';

describe('Settings', () => {
  const downloads: { content: Blob; name: string }[] = [];

  async function setup() {
    downloads.length = 0;
    TestBed.overrideProvider(DOWNLOADER, {
      useValue: (content: Blob, name: string) => downloads.push({ content, name }),
    });
    return setupApp();
  }

  afterEach(() => {
    document.querySelectorAll('.cdk-overlay-container').forEach((el) => el.replaceChildren());
  });

  it('lista los tipos de contenedor en su orden', async () => {
    const { open } = await setup();
    const el = await open('/ajustes');
    expect(texts(el, 'mat-list [matListItemTitle]')).toEqual([
      'Casa',
      'Habitación',
      'Armario',
      'Caja',
    ]);
    expect(el.querySelector<HTMLButtonElement>('[aria-label="Subir Casa"]')?.disabled).toBe(true);
    expect(el.querySelector<HTMLButtonElement>('[aria-label="Bajar Caja"]')?.disabled).toBe(true);
  });

  it('añade el tipo «Estantería» y permite usarlo', async () => {
    const { open, settle, until, store } = await setup();
    const el = await open('/ajustes');

    clickOn('.add-type');
    await settle();
    typeInto(document.body, 'mat-dialog-container input', 'Estantería');
    clickOn('mat-dialog-actions .confirm');
    await until(() => store.types().length === 5);

    expect(texts(el, 'mat-list [matListItemTitle]').at(-1)).toBe('Estantería');
    const form = await open('/nuevo/contenedor');
    clickOn('mat-select');
    await settle();
    expect(texts(document.body, 'mat-option')).toContain('Estantería');
    expect(form.querySelector('form')).not.toBeNull();
  });

  it('no guarda un tipo sin nombre', async () => {
    const { open, settle, store } = await setup();
    await open('/ajustes');
    clickOn('.add-type');
    await settle();
    clickOn('mat-dialog-actions .confirm');
    await settle();
    expect(document.querySelector('mat-dialog-container')).not.toBeNull();
    expect(store.types().length).toBe(4);
  });

  it('edita y reordena los tipos', async () => {
    const { open, settle, until, store } = await setup();
    const el = await open('/ajustes');

    clickOn('[aria-label="Editar Armario"]');
    await settle();
    const name = document.querySelector<HTMLInputElement>('mat-dialog-container input');
    expect(name?.value).toBe('Armario');
    typeInto(document.body, 'mat-dialog-container input', 'Mueble');
    clickOn('mat-dialog-actions .confirm');
    await until(() => store.types().some((t) => t.name === 'Mueble'));

    clickOn('[aria-label="Subir Caja"]');
    await until(() => store.types()[2].name === 'Caja');

    expect(texts(el, 'mat-list [matListItemTitle]')).toEqual([
      'Casa',
      'Habitación',
      'Caja',
      'Mueble',
    ]);
  });

  it('al eliminar un tipo en uso avisa de cuántos contenedores quedan sin tipo', async () => {
    const { open, settle, until, store, typeId } = await setup();
    await store.addContainer({ name: 'Uno', typeId: typeId('Caja') });
    await store.addContainer({ name: 'Dos', typeId: typeId('Caja') });
    await open('/ajustes');

    clickOn('[aria-label="Eliminar Caja"]');
    await settle();
    expect(document.querySelector('mat-dialog-content')?.textContent).toContain(
      '2 contenedores lo usan y quedarán sin tipo',
    );
    clickOn('mat-dialog-actions .confirm');
    await until(() => store.types().length === 3);

    expect(store.counts().containers).toBe(2);
  });

  it('exporta los datos en un archivo JSON con la fecha en el nombre', async () => {
    const { open, until, store } = await setup();
    await store.addItem({ name: 'Pilas' });
    await open('/ajustes');

    clickOn('button.json');
    await until(() => downloads.length === 1);

    expect(downloads[0].name).toMatch(/^inventario-\d{4}-\d{2}-\d{2}\.json$/);
    expect(downloads[0].content.type).toBe('application/json');
    const backup = JSON.parse(new TextDecoder().decode(await downloads[0].content.arrayBuffer()));
    expect(backup.entities.map((e: { name: string }) => e.name)).toEqual(['Pilas']);
  });

  it('exporta datos e imágenes en un archivo ZIP', async () => {
    const { open, until, store } = await setup();
    await store.addItem({ name: 'Pilas' });
    await open('/ajustes');

    clickOn('button.zip');
    await until(() => downloads.length === 1);

    expect(downloads[0].name).toMatch(/^inventario-\d{4}-\d{2}-\d{2}\.zip$/);
    const head = new Uint8Array(await downloads[0].content.arrayBuffer()).subarray(0, 2);
    expect([...head]).toEqual([0x50, 0x4b]);
  });

  it('importa una copia tras mostrar lo que contiene y pedir confirmación', async () => {
    const { open, settle, until, store } = await setup();
    const el = await open('/ajustes');
    const backup = new Blob([
      JSON.stringify({
        format: 'inventario-hogar',
        version: 1,
        types: [{ id: 't', name: 'caja', icon: 'package_2', order: 1, slug: null }],
        entities: [
          { id: 'c', kind: 'container', name: 'Caja importada', typeId: 't' },
          { id: 'o', kind: 'item', name: 'Pilas', parentId: 'c', quantity: 2 },
        ],
      }),
    ]);

    choose(el, backup);
    await until(() => document.querySelector('mat-dialog-content') !== null);
    expect(document.querySelector('mat-dialog-content')?.textContent).toContain(
      'Se añadirán 1 contenedor, 1 objeto y 0 fotografías',
    );
    clickOn('mat-dialog-actions .confirm');
    await until(() => store.counts().items === 1);
    await until(() => snack().includes('Importados'));
    await settle();

    expect(store.counts()).toEqual({ containers: 1, items: 1 });
    expect(store.types().length).toBe(4); // «caja» ya existía como «Caja»
    expect(snack()).toContain('Importados 1 contenedor, 1 objeto y 0 fotografías.');
  });

  it('no importa nada si se cancela', async () => {
    const { open, until, store } = await setup();
    const el = await open('/ajustes');
    choose(
      el,
      new Blob([
        JSON.stringify({
          format: 'inventario-hogar',
          version: 1,
          types: [],
          entities: [{ id: 'o', kind: 'item', name: 'Pilas' }],
        }),
      ]),
    );
    await until(() => document.querySelector('mat-dialog-content') !== null);
    clickOn('mat-dialog-actions button', 'Cancelar');
    await until(dialogClosed);
    expect(store.counts().items).toBe(0);
  });

  it('explica el problema si el archivo no es una copia', async () => {
    const { open, until, store } = await setup();
    const el = await open('/ajustes');
    choose(el, new Blob(['esto no es una copia']));
    await until(() => snack() !== '');
    expect(snack()).toContain('no contiene una copia del inventario');
    expect(store.counts()).toEqual({ containers: 0, items: 0 });
  });
});
