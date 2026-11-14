import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AiAvailability, LocalAi } from '../../core/ai/local-ai';
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

  describe('inteligencia artificial en el dispositivo', () => {
    const availability = signal<AiAvailability>('unsupported');
    const enabled = signal(false);
    const downloadProgress = signal<number | null>(null);
    const download = vi.fn().mockResolvedValue(undefined);
    const spanish = signal(true);
    const clean = (text: string | null | undefined) => (text ?? '').replace(/\s+/g, ' ').trim();

    async function withAi(state: AiAvailability, isEnabled = false) {
      availability.set(state);
      enabled.set(isEnabled);
      downloadProgress.set(null);
      spanish.set(true);
      download.mockClear();
      TestBed.overrideProvider(LocalAi, {
        useValue: {
          availability,
          enabled,
          downloadProgress,
          spanish,
          download,
          setEnabled: (value: boolean) => enabled.set(value),
        },
      });
      const app = await setup();
      const el = (await app.open('/ajustes')).querySelector('section.ai') as HTMLElement;
      return { ...app, el };
    }

    it('se presenta como experimental y detalla los requisitos', async () => {
      const { el } = await withAi('downloadable');
      expect(el.querySelector('.badge')?.textContent).toBe('Experimental');
      const requirements = clean(el.querySelector('details')?.textContent);
      expect(requirements).toContain('Chrome 148');
      expect(requirements).toContain('4 GB');
      expect(requirements).toContain('carpeta temporal');
      expect(requirements).toContain('TMPDIR');
      expect(requirements).toContain('22 GB libres');
      expect(requirements).toContain('16 GB de RAM');
      expect(requirements).toContain('No funciona en móviles');
    });

    it('en un navegador sin IA integrada lo dice y no ofrece activarla', async () => {
      const { el } = await withAi('unsupported');
      expect(clean(el.querySelector('.status')?.textContent)).toContain(
        'no tiene inteligencia artificial integrada',
      );
      expect(el.querySelector('.ai-toggle')).toBeNull();
    });

    it('en un equipo que no cumple los requisitos lo indica', async () => {
      const { el } = await withAi('unavailable');
      expect(clean(el.querySelector('.status')?.textContent)).toContain('no cumple los requisitos');
      expect(el.querySelector('.ai-toggle')).toBeNull();
    });

    it('se activa a mano y entonces ofrece descargar el modelo', async () => {
      const { el, settle } = await withAi('downloadable');
      expect(clean(el.querySelector('.status')?.textContent)).toBe(
        'Desactivada en este dispositivo.',
      );
      expect(el.querySelector('.ai-download')).toBeNull();

      clickOn('.ai-toggle');
      await settle();
      expect(clean(el.querySelector('.status')?.textContent)).toContain(
        'falta descargar el modelo',
      );

      clickOn('.ai-download');
      expect(download).toHaveBeenCalledTimes(1);
    });

    it('si la descarga la lleva Chrome por su cuenta, indica actividad y ofrece ver el avance', async () => {
      const { el, settle } = await withAi('downloading', true);
      expect(clean(el.querySelector('.status')?.textContent)).toBe('Descargando el modelo…');
      expect(el.querySelector('mat-progress-bar')?.getAttribute('mode')).toBe('indeterminate');

      clickOn('.ai-progress');
      expect(download).toHaveBeenCalledTimes(1);

      // Al sumarse a la descarga empieza a recibir su avance.
      downloadProgress.set(0.21);
      await settle();
      expect(clean(el.querySelector('.status')?.textContent)).toBe('Descargando el modelo… 21 %');
      expect(el.querySelector('mat-progress-bar')?.getAttribute('mode')).toBe('determinate');
      expect(el.querySelector('.ai-progress')).toBeNull();
    });

    it('muestra el avance de la descarga', async () => {
      const { el, settle } = await withAi('downloading', true);
      downloadProgress.set(0.42);
      await settle();
      expect(clean(el.querySelector('.status')?.textContent)).toBe('Descargando el modelo… 42 %');
      expect(el.querySelector('mat-progress-bar')).not.toBeNull();
      expect(clean(el.querySelector('.downloading')?.textContent)).toContain('carpeta temporal');
    });

    it('avisa si el navegador no declara compatibilidad con el español', async () => {
      const { el, settle } = await withAi('available', true);
      expect(el.querySelector('.language')).toBeNull();
      spanish.set(false);
      await settle();
      expect(clean(el.querySelector('.language')?.textContent)).toContain('pueden salir en inglés');
    });

    it('con el modelo listo indica dónde se usa y permite desactivarla', async () => {
      const { el, settle } = await withAi('available', true);
      expect(clean(el.querySelector('.status')?.textContent)).toContain('Activada y lista');
      expect(clean(el.querySelector('.ai-toggle')?.textContent)).toContain('Desactivar');

      clickOn('.ai-toggle');
      await settle();
      expect(enabled()).toBe(false);
    });
  });
});
