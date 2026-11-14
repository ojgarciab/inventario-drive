import { TestBed } from '@angular/core/testing';
import { LocalAi, LocalAiError, comparableName } from './local-ai';

/** Modelo simulado: responde a cada petición con la respuesta programada. */
function fakeLanguageModel(availability = 'available') {
  const model = {
    availabilityValue: availability,
    availabilityOptions: [] as object[],
    createOptions: [] as Record<string, unknown>[],
    prompts: [] as { input: unknown; options?: object }[],
    answers: [] as (string | Error)[],
    destroyed: 0,
    progress: [] as number[],
    failCreate: false,
    /** Idiomas declarados con los que este «navegador» dice no poder usar el modelo. */
    unsupportedLanguages: [] as string[],
    /** Si se indica, la creación de la sesión espera a esta promesa (una descarga en curso). */
    gate: null as Promise<void> | null,
  };
  vi.stubGlobal('LanguageModel', {
    availability: async (options: object) => {
      model.availabilityOptions.push(options);
      const languages = JSON.stringify(options).match(/"languages":\["(\w+)"\]/)?.[1] ?? 'ninguno';
      return model.unsupportedLanguages.includes(languages)
        ? 'unavailable'
        : model.availabilityValue;
    },
    create: async (options: Record<string, unknown>) => {
      model.createOptions.push(options);
      if (model.failCreate) throw new Error('sin espacio');
      const monitor = options['monitor'] as ((target: EventTarget) => void) | undefined;
      if (monitor) {
        const target = new EventTarget();
        monitor(target);
        for (const loaded of model.progress) {
          target.dispatchEvent(Object.assign(new Event('downloadprogress'), { loaded }));
        }
      }
      await model.gate;
      return {
        prompt: async (input: unknown, promptOptions?: object) => {
          model.prompts.push({ input, options: promptOptions });
          const answer = model.answers.shift() ?? '';
          if (answer instanceof Error) throw answer;
          return answer;
        },
        destroy: () => void model.destroyed++,
      };
    },
  });
  return model;
}

async function setup() {
  const ai = TestBed.inject(LocalAi);
  await ai.refresh();
  return ai;
}

const image = new Blob(['foto'], { type: 'image/jpeg' });

describe('LocalAi (Prompt API de Chrome)', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.unstubAllGlobals());

  describe('disponibilidad', () => {
    it('sin la API en el navegador, no está disponible', async () => {
      const ai = await setup();
      expect(ai.availability()).toBe('unsupported');
      expect(ai.ready()).toBe(false);
      await expect(ai.transcribe(image)).rejects.toBeInstanceOf(LocalAiError);
    });

    it('pregunta al navegador por texto en español e imágenes', async () => {
      const model = fakeLanguageModel('downloadable');
      const ai = await setup();
      expect(ai.availability()).toBe('downloadable');
      // La primera opción ya vale: no se prueban las alternativas.
      expect(new Set(model.availabilityOptions.map((o) => JSON.stringify(o))).size).toBe(1);
      expect(model.availabilityOptions.at(-1)).toEqual({
        expectedInputs: [{ type: 'text', languages: ['es'] }, { type: 'image' }],
        expectedOutputs: [{ type: 'text', languages: ['es'] }],
      });
    });

    it('si el navegador no admite declarar español, usa inglés y lo indica', async () => {
      const model = fakeLanguageModel('available');
      model.unsupportedLanguages = ['es'];
      model.answers = ['Texto'];
      const ai = await setup();

      expect(ai.availability()).toBe('available');
      expect(ai.spanish()).toBe(false);
      await ai.transcribe(image);
      expect(model.createOptions[0]).toEqual({
        expectedInputs: [{ type: 'text', languages: ['en'] }, { type: 'image' }],
        expectedOutputs: [{ type: 'text', languages: ['en'] }],
      });
    });

    it('como último recurso prueba sin declarar idioma', async () => {
      const model = fakeLanguageModel('downloadable');
      model.unsupportedLanguages = ['es', 'en'];
      const ai = await setup();
      expect(ai.availability()).toBe('downloadable');
      expect(ai.spanish()).toBe(false);
      expect(model.availabilityOptions.at(-1)).toEqual({
        expectedInputs: [{ type: 'text' }, { type: 'image' }],
      });
    });

    it('con español admitido lo declara', async () => {
      fakeLanguageModel('available');
      expect((await setup()).spanish()).toBe(true);
    });

    it('un equipo que no cumple los requisitos, o un fallo al preguntar, es «no disponible»', async () => {
      fakeLanguageModel('unavailable');
      expect((await setup()).availability()).toBe('unavailable');

      TestBed.resetTestingModule();
      vi.stubGlobal('LanguageModel', {
        availability: async () => {
          throw new Error('fallo');
        },
        create: async () => undefined,
      });
      expect((await setup()).availability()).toBe('unavailable');
    });

    it('está desactivada hasta que el usuario la activa, y lo recuerda en el dispositivo', async () => {
      fakeLanguageModel('available');
      const ai = await setup();
      expect(ai.enabled()).toBe(false);
      expect(ai.ready()).toBe(false);

      ai.setEnabled(true);
      expect(ai.ready()).toBe(true);
      expect(localStorage.getItem('inventario.ia')).toBe('on');

      TestBed.resetTestingModule();
      expect((await setup()).ready()).toBe(true);

      TestBed.inject(LocalAi).setEnabled(false);
      expect(localStorage.getItem('inventario.ia')).toBeNull();
    });
  });

  describe('descarga del modelo', () => {
    /** Deja la descarga en curso hasta que la prueba la da por terminada. */
    function holdDownload(model: ReturnType<typeof fakeLanguageModel>) {
      let finish: () => void = () => undefined;
      model.gate = new Promise<void>((resolve) => (finish = resolve));
      return () => finish();
    }
    const tick = () => new Promise((resolve) => setTimeout(resolve));

    it('informa del avance y queda disponible al terminar', async () => {
      const model = fakeLanguageModel('downloadable');
      model.progress = [0.25, 0.9];
      const finish = holdDownload(model);
      const ai = await setup();

      const download = ai.download();
      expect(ai.availability()).toBe('downloading');
      await tick();
      expect(ai.downloadProgress()).toBe(0.9);

      finish();
      await download;
      expect(ai.availability()).toBe('available');
      expect(ai.downloadProgress()).toBeNull(); // ya no hay descarga en curso
      expect(model.destroyed).toBe(1); // la sesión solo servía para descargar
      expect(typeof model.createOptions[0]['monitor']).toBe('function');
    });

    it('ignora avances fuera de rango', async () => {
      const model = fakeLanguageModel('downloadable');
      model.progress = [-1, 7];
      const finish = holdDownload(model);
      const ai = await setup();
      const download = ai.download();
      await tick();
      expect(ai.downloadProgress()).toBe(1);
      finish();
      await download;
    });

    it('si Chrome ya lo está descargando por su cuenta, pregunta hasta que termina', async () => {
      vi.useFakeTimers();
      try {
        const model = fakeLanguageModel('downloading');
        const ai = await setup();
        expect(ai.availability()).toBe('downloading');
        expect(ai.downloadProgress()).toBeNull(); // no se conoce el avance

        await vi.advanceTimersByTimeAsync(5000);
        expect(ai.availability()).toBe('downloading');

        model.availabilityValue = 'available';
        await vi.advanceTimersByTimeAsync(5000);
        expect(ai.availability()).toBe('available');

        // Una vez disponible deja de preguntar.
        const calls = model.availabilityOptions.length;
        await vi.advanceTimersByTimeAsync(60_000);
        expect(model.availabilityOptions.length).toBe(calls);
      } finally {
        vi.useRealTimers();
      }
    });

    it('se suma a una descarga que Chrome ya tenía en curso y muestra su avance', async () => {
      const model = fakeLanguageModel('downloading');
      model.progress = [0.2];
      const finish = holdDownload(model);
      const ai = await setup();
      expect(ai.downloadProgress()).toBeNull();

      const download = ai.download();
      await tick();
      expect(ai.availability()).toBe('downloading');
      expect(ai.downloadProgress()).toBe(0.2);

      finish();
      await download;
      expect(ai.availability()).toBe('available');
    });

    it('si no puede sumarse, la descarga de Chrome sigue y se sigue consultando', async () => {
      const model = fakeLanguageModel('downloading');
      model.failCreate = true;
      const ai = await setup();

      await expect(ai.download()).rejects.toThrow('No se ha podido descargar el modelo');

      expect(ai.availability()).toBe('downloading'); // el estado real, no «descargable»
      expect(ai.downloadProgress()).toBeNull();
    });

    it('si falla, se puede volver a intentar', async () => {
      const model = fakeLanguageModel('downloadable');
      model.failCreate = true;
      const ai = await setup();

      await expect(ai.download()).rejects.toThrow('No se ha podido descargar el modelo');
      expect(ai.availability()).toBe('downloadable');
      expect(ai.downloadProgress()).toBeNull();
    });
  });

  describe('leer el texto de una foto', () => {
    it('envía la imagen al modelo y devuelve la transcripción', async () => {
      const model = fakeLanguageModel();
      model.answers = ['  Modelo: BC-700\nS/N 12345  '];
      const ai = await setup();

      expect(await ai.transcribe(image)).toBe('Modelo: BC-700\nS/N 12345');

      const [message] = model.prompts[0].input as {
        role: string;
        content: { type: string; value: unknown }[];
      }[];
      expect(message.role).toBe('user');
      expect(message.content[0]).toMatchObject({ type: 'text' });
      expect(message.content[0].value).toContain('Transcribe literalmente');
      expect(message.content[1]).toEqual({ type: 'image', value: image });
      expect(model.destroyed).toBe(1);
    });

    it('si la foto no tiene texto devuelve una cadena vacía', async () => {
      const model = fakeLanguageModel();
      model.answers = ['SIN_TEXTO', ' "SIN_TEXTO". '];
      const ai = await setup();
      expect(await ai.transcribe(image)).toBe('');
      expect(await ai.transcribe(image)).toBe('');
    });

    it('si el modelo falla, lo explica y libera la sesión', async () => {
      const model = fakeLanguageModel();
      model.answers = [new Error('contexto agotado')];
      const ai = await setup();
      await expect(ai.transcribe(image)).rejects.toThrow('no ha podido analizar la imagen');
      expect(model.destroyed).toBe(1);
    });
  });

  describe('reconocer objetos', () => {
    it('pide una lista con formato fijo y la devuelve limpia y sin repetidos', async () => {
      const model = fakeLanguageModel();
      model.answers = [
        JSON.stringify({
          objetos: ['  taladro ', 'Taladro', 'cables  USB', '', 42, 'Árbol', 'arboles'],
        }),
      ];
      const ai = await setup();

      expect(await ai.recognize(image)).toEqual(['Taladro', 'Cables USB', 'Árbol']);
      const options = model.prompts[0].options as { responseConstraint: { required: string[] } };
      expect(options.responseConstraint.required).toEqual(['objetos']);
    });

    it('sin objetos devuelve una lista vacía', async () => {
      const model = fakeLanguageModel();
      model.answers = ['{"objetos":[]}', '{}'];
      const ai = await setup();
      expect(await ai.recognize(image)).toEqual([]);
      expect(await ai.recognize(image)).toEqual([]);
    });

    it('rechaza una respuesta que no es JSON', async () => {
      const model = fakeLanguageModel();
      model.answers = ['Veo un taladro y unos cables.'];
      const ai = await setup();
      await expect(ai.recognize(image)).rejects.toThrow('no ha dado una respuesta');
    });
  });

  it('compara nombres sin mayúsculas, acentos ni plurales', () => {
    expect(comparableName('Cables USB')).toBe(comparableName('cable usb'));
    expect(comparableName('Árboles')).toBe(comparableName('arbol'));
    expect(comparableName('Pilas AA')).toBe(comparableName('pila aa'));
    expect(comparableName('Taladro')).not.toBe(comparableName('Martillo'));
    expect(comparableName('Gas')).toBe('gas'); // las palabras cortas no se tocan
    expect(comparableName('Llaves')).toBe(comparableName('llave'));
  });
});
