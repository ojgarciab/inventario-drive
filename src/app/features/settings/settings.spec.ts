import { TestBed } from '@angular/core/testing';
import { DOWNLOADER } from '../../shared/download';
import { clickOn, setupApp, texts, typeInto } from '../../testing';

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

  describe('instalación', () => {
    const section = (el: HTMLElement) =>
      el.querySelector('#install-title')?.closest('section') as HTMLElement;

    afterEach(() => {
      vi.unstubAllGlobals();
      window.inventarioInstallPrompt = undefined;
    });

    it('explica qué hacer cuando el navegador no ofrece instalar', async () => {
      const { open } = await setup();
      const el = await open('/ajustes');
      expect(section(el).querySelector('.not-installable')?.textContent).toContain(
        'no ofrece instalarla',
      );
      expect(section(el).querySelector('button')).toBeNull();
    });

    it('permite instalar aunque el aviso se haya cerrado, y después indica que está instalada', async () => {
      localStorage.setItem('inventario.instalacion', String(Date.now()));
      const event = Object.assign(new Event('beforeinstallprompt'), {
        prompt: vi.fn().mockResolvedValue(undefined),
        userChoice: Promise.resolve({ outcome: 'accepted' as const }),
      });
      window.inventarioInstallPrompt = event;
      const { open, settle } = await setup();
      const el = await open('/ajustes');

      section(el).querySelector<HTMLButtonElement>('button.install')?.click();
      await settle();
      expect(event.prompt).toHaveBeenCalled();

      window.dispatchEvent(new Event('appinstalled'));
      await settle();
      expect(section(el).querySelector('.installed')?.textContent).toContain('ya está instalada');
      expect(section(el).querySelector('button')).toBeNull();
      localStorage.clear();
    });

    it('indica que ya está instalada cuando se usa como aplicación', async () => {
      vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('standalone') }));
      const { open } = await setup();
      const el = await open('/ajustes');
      expect(section(el).querySelector('.installed')?.textContent).toContain('ya está instalada');
    });
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
});
