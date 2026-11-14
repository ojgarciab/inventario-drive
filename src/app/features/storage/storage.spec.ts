import { TestBed } from '@angular/core/testing';
import { StorageUsage } from '../../core/inventory/models';
import { DOWNLOADER } from '../../shared/download';
import { clickOn, setupApp, texts } from '../../testing';
import { formatBytes, formatPercent } from './format-bytes';

/** Simula que el usuario elige un archivo de copia. */
function choose(el: HTMLElement, file: Blob): void {
  const input = el.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error('No existe el selector de archivo');
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new Event('change'));
}

const dialogClosed = () => document.querySelector('mat-dialog-container') === null;
const snack = () => document.querySelector('mat-snack-bar-container')?.textContent ?? '';
const clean = (text: string | null | undefined) => (text ?? '').replace(/\s+/g, ' ').trim();
const MB = 1024 * 1024;

describe('Storage', () => {
  const downloads: { content: Blob; name: string }[] = [];

  async function setup() {
    downloads.length = 0;
    TestBed.overrideProvider(DOWNLOADER, {
      useValue: (content: Blob, name: string) => downloads.push({ content, name }),
    });
    return setupApp();
  }

  /** Abre la pantalla con el uso de espacio que devolvería Drive. */
  async function withUsage(usage: StorageUsage) {
    const app = await setup();
    vi.spyOn(app.repository, 'storageUsage').mockResolvedValue(usage);
    const el = await app.open('/almacenamiento');
    await app.settle();
    return { ...app, el };
  }

  const segments = (el: HTMLElement) =>
    [...el.querySelectorAll<HTMLElement>('.bar .segment')].map((segment) => ({
      kind: segment.classList.contains('data') ? 'datos' : 'fotos',
      weight: segment.style.flexGrow,
    }));

  afterEach(() => {
    vi.restoreAllMocks();
    document.querySelectorAll('.cdk-overlay-container').forEach((el) => el.replaceChildren());
  });

  describe('espacio ocupado', () => {
    it('muestra el total y reparte la barra entre datos (verde) y fotos (azul)', async () => {
      const { el } = await withUsage({
        dataBytes: 1 * MB,
        dataFiles: 40,
        photoBytes: 3 * MB,
        photoFiles: 12,
        account: null,
      });

      expect(clean(el.querySelector('.total')?.textContent)).toBe('4 MB ocupa este inventario');
      expect(segments(el)).toEqual([
        { kind: 'datos', weight: String(1 * MB) },
        { kind: 'fotos', weight: String(3 * MB) },
      ]);
      expect(texts(el, '.legend .value').map(clean)).toEqual([
        '1 MB · 40 archivos',
        '3 MB · 12 fotografías',
      ]);
      expect(el.querySelector('.bar')?.getAttribute('aria-label')).toBe(
        'Datos: 1\u00a0MB. Fotografías: 3\u00a0MB.',
      );
      expect(el.querySelector('.note')).toBeNull();
    });

    it('si los datos no ocupan nada, la barra es solo de fotos y se explica por qué', async () => {
      const { el } = await withUsage({
        dataBytes: 0,
        dataFiles: 68,
        photoBytes: 2.5 * MB,
        photoFiles: 9,
        account: null,
      });

      expect(segments(el)).toEqual([{ kind: 'fotos', weight: String(2.5 * MB) }]);
      expect(texts(el, '.legend .value').map(clean)).toEqual([
        '0 B · 68 archivos',
        '2,5 MB · 9 fotografías',
      ]);
      expect(el.querySelector('.note')?.textContent).toContain('Los datos no ocupan espacio');
    });

    it('con el inventario sin fotos deja la barra vacía', async () => {
      const { el } = await withUsage({
        dataBytes: 0,
        dataFiles: 4,
        photoBytes: 0,
        photoFiles: 0,
        account: null,
      });
      expect(clean(el.querySelector('.total')?.textContent)).toBe('0 B ocupa este inventario');
      expect(segments(el)).toEqual([]);
      expect(el.querySelector('.bar')?.classList.contains('empty')).toBe(true);
      expect(texts(el, '.legend .value').map(clean)[1]).toBe('0 B · 0 fotografías');
    });

    it('sitúa el inventario dentro del espacio de la cuenta de Google', async () => {
      const { el } = await withUsage({
        dataBytes: 0,
        dataFiles: 10,
        photoBytes: 150 * MB,
        photoFiles: 400,
        account: { usedBytes: 3.2 * 1024 * MB, limitBytes: 15 * 1024 * MB },
      });
      expect(clean(el.querySelector('.account')?.textContent)).toBe(
        'La cuenta de Google tiene usados 3,2 GB de 15 GB entre todos sus servicios. ' +
          'Este inventario supone el 0,98 % de ese espacio.',
      );
    });

    it('una cuenta sin tope de espacio no muestra límite ni porcentaje', async () => {
      const { el } = await withUsage({
        dataBytes: 0,
        dataFiles: 1,
        photoBytes: MB,
        photoFiles: 1,
        account: { usedBytes: 2 * 1024 * MB, limitBytes: null },
      });
      expect(clean(el.querySelector('.account')?.textContent)).toBe(
        'La cuenta de Google tiene usados 2 GB entre todos sus servicios.',
      );
    });

    it('calcula el espacio a partir de lo que hay guardado', async () => {
      const { open, settle, store, repository } = await setup();
      const item = await store.addItem({ name: 'Taladro' });
      await repository.uploadPhoto(item.id, new Blob(['x'.repeat(2048)]));

      const el = await open('/almacenamiento');
      await settle();

      expect(texts(el, '.legend .value').map(clean)).toEqual([
        '0 B · 5 archivos', // el objeto y los cuatro tipos por defecto
        '2 kB · 1 fotografía',
      ]);
    });

    it('avisa si no se puede consultar y deja reintentar', async () => {
      const { open, settle, repository } = await setup();
      vi.spyOn(repository, 'storageUsage').mockRejectedValueOnce(new Error('sin red'));
      const el = await open('/almacenamiento');
      await settle();
      expect(el.querySelector('[role="alert"]')?.textContent).toContain(
        'No se ha podido consultar',
      );
      expect(el.querySelector('.bar')).toBeNull();
      // Las copias de seguridad siguen disponibles aunque falle el cálculo.
      expect(el.querySelector('button.json')).not.toBeNull();

      clickOn('section [role="alert"] + button');
      await settle();
      expect(el.querySelector('.bar')).not.toBeNull();
    });

    it('vuelve a calcular el espacio después de importar una copia', async () => {
      const { open, settle, until, store, repository } = await setup();
      const usage = vi.spyOn(repository, 'storageUsage');
      const el = await open('/almacenamiento');
      await settle();
      expect(usage).toHaveBeenCalledTimes(1);

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
      clickOn('mat-dialog-actions .confirm');
      await until(() => store.counts().items === 1);
      await until(() => usage.mock.calls.length === 2);
    });
  });

  describe('copias de seguridad', () => {
    it('exporta los datos en un archivo JSON con la fecha en el nombre', async () => {
      const { open, until, store } = await setup();
      await store.addItem({ name: 'Pilas' });
      await open('/almacenamiento');

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
      await open('/almacenamiento');

      clickOn('button.zip');
      await until(() => downloads.length === 1);

      expect(downloads[0].name).toMatch(/^inventario-\d{4}-\d{2}-\d{2}\.zip$/);
      const head = new Uint8Array(await downloads[0].content.arrayBuffer()).subarray(0, 2);
      expect([...head]).toEqual([0x50, 0x4b]);
    });

    it('importa una copia tras mostrar lo que contiene y pedir confirmación', async () => {
      const { open, settle, until, store } = await setup();
      const el = await open('/almacenamiento');
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
      const el = await open('/almacenamiento');
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
      const el = await open('/almacenamiento');
      choose(el, new Blob(['esto no es una copia']));
      await until(() => snack() !== '');
      expect(snack()).toContain('no contiene una copia del inventario');
      expect(store.counts()).toEqual({ containers: 0, items: 0 });
    });
  });
});

describe('formato de tamaños', () => {
  const plain = (text: string) => text.replace(/\u00a0/g, ' ');

  it('elige la unidad adecuada, con coma decimal', () => {
    expect(plain(formatBytes(0))).toBe('0 B');
    expect(plain(formatBytes(812))).toBe('812 B');
    expect(plain(formatBytes(1536))).toBe('1,5 kB');
    expect(plain(formatBytes(12.44 * MB))).toBe('12,4 MB');
    expect(plain(formatBytes(15 * 1024 * MB))).toBe('15 GB');
    expect(plain(formatBytes(-5))).toBe('0 B');
  });

  it('expresa las proporciones muy pequeñas sin decir que son cero', () => {
    expect(plain(formatPercent(0.0098))).toBe('0,98 %');
    expect(plain(formatPercent(0.25))).toBe('25 %');
    expect(plain(formatPercent(0.000001))).toBe('menos del 0,01 %');
    expect(plain(formatPercent(0))).toBe('0 %');
  });
});
