import { DOCUMENT, DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { normalizeText } from '../inventory/tree-utils';

// Inteligencia artificial en el dispositivo mediante la Prompt API de Chrome
// (https://developer.chrome.com/docs/ai/prompt-api): un modelo de lenguaje que
// Chrome descarga y ejecuta en el propio ordenador. Las fotos que analiza no
// salen del dispositivo. Es experimental y solo existe en Chrome de
// escritorio con equipos potentes, así que todo lo que depende de ella es
// opcional y está desactivado hasta que el usuario lo activa en Ajustes.

/** Estado del modelo en este navegador. */
export type AiAvailability =
  /** El navegador no tiene la Prompt API. */
  | 'unsupported'
  /** La tiene, pero el equipo no cumple los requisitos. */
  | 'unavailable'
  /** Se puede usar, pero antes hay que descargar el modelo. */
  | 'downloadable'
  | 'downloading'
  | 'available';

/** Error con un mensaje que se puede mostrar tal cual al usuario. */
export class LocalAiError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'LocalAiError';
  }
}

/** Parte de la Prompt API que usa la aplicación. */
interface LanguageModelApi {
  availability(options: object): Promise<string>;
  create(options: object): Promise<LanguageModelSession>;
}

interface LanguageModelSession {
  prompt(input: unknown, options?: object): Promise<string>;
  destroy(): void;
}

const ENABLED_KEY = 'inventario.ia';
/**
 * Lo que se le va a pedir al modelo, de la opción preferida a la más básica.
 * Lo ideal es declarar español; pero hay versiones de Chrome que con ese
 * idioma responden «no disponible» aunque el modelo sí pueda usarse (visto
 * en Chrome 152), así que se prueba después con inglés y sin declarar idioma.
 * Las instrucciones van siempre en español.
 */
const MODEL_PROFILES: { spanish: boolean; options: object }[] = [
  {
    spanish: true,
    options: {
      expectedInputs: [{ type: 'text', languages: ['es'] }, { type: 'image' }],
      expectedOutputs: [{ type: 'text', languages: ['es'] }],
    },
  },
  {
    spanish: false,
    options: {
      expectedInputs: [{ type: 'text', languages: ['en'] }, { type: 'image' }],
      expectedOutputs: [{ type: 'text', languages: ['en'] }],
    },
  },
  { spanish: false, options: { expectedInputs: [{ type: 'text' }, { type: 'image' }] } },
];
/** Cada cuánto se vuelve a preguntar a Chrome mientras descarga el modelo por su cuenta. */
const DOWNLOAD_POLL_MS = 5000;
const NO_TEXT = 'SIN_TEXTO';
const MAX_OBJECTS = 20;
const MAX_NAME_LENGTH = 80;

const TRANSCRIBE_PROMPT =
  'Transcribe literalmente todo el texto legible de esta imagen: etiquetas, rótulos, marcas, ' +
  'números de modelo y de serie. Conserva los saltos de línea y no corrijas ni traduzcas nada. ' +
  `No añadas explicaciones. Si no hay texto legible, responde exactamente ${NO_TEXT}.`;

const RECOGNIZE_PROMPT =
  'Esta fotografía muestra el interior de un contenedor de una casa (una caja, un cajón, un ' +
  'armario). Enumera los objetos distintos que se ven, con nombres cortos y concretos en ' +
  `español. No repitas objetos, no incluyas el propio contenedor ni el fondo, y no pases de ${MAX_OBJECTS}.`;

const OBJECTS_SCHEMA = {
  type: 'object',
  properties: { objetos: { type: 'array', items: { type: 'string' }, maxItems: MAX_OBJECTS } },
  required: ['objetos'],
  additionalProperties: false,
};

@Injectable({ providedIn: 'root' })
export class LocalAi {
  private readonly window = inject(DOCUMENT).defaultView;

  private readonly enabledState = signal(readEnabled());
  private readonly state = signal<AiAvailability>('unsupported');
  private readonly downloaded = signal<number | null>(null);
  /** Opciones con las que este navegador admite el modelo. */
  private profile = MODEL_PROFILES[0];
  private readonly spanishState = signal(true);
  private pollTimer: ReturnType<typeof setTimeout> | undefined;

  /** Si el usuario ha activado las funciones de IA en este dispositivo. */
  readonly enabled = this.enabledState.asReadonly();
  readonly availability = this.state.asReadonly();
  /** Avance de la descarga del modelo, de 0 a 1; `null` si no se está descargando. */
  readonly downloadProgress = this.downloaded.asReadonly();
  /**
   * Indica si el navegador admite el modelo declarando español. Si no, se usa
   * igualmente, pero las respuestas pueden salir en inglés o ser peores.
   */
  readonly spanish = this.spanishState.asReadonly();
  /** Las funciones de IA se pueden usar ahora mismo. */
  readonly ready = computed(() => this.enabledState() && this.state() === 'available');

  constructor() {
    inject(DestroyRef).onDestroy(() => clearTimeout(this.pollTimer));
    void this.refresh();
  }

  /** Activa o desactiva las funciones de IA. Es una preferencia de este dispositivo. */
  setEnabled(enabled: boolean): void {
    this.enabledState.set(enabled);
    try {
      if (enabled) localStorage.setItem(ENABLED_KEY, 'on');
      else localStorage.removeItem(ENABLED_KEY);
    } catch {
      // Sin almacenamiento la preferencia dura lo que dure la página.
    }
    if (enabled) void this.refresh();
  }

  /** Vuelve a preguntar al navegador si puede usar el modelo. */
  async refresh(): Promise<void> {
    const api = this.api();
    if (!api) {
      this.state.set('unsupported');
      return;
    }
    if (this.state() === 'downloading' && this.downloaded() !== null) return;
    // Se queda con la primera combinación de opciones que el navegador admita.
    for (const profile of MODEL_PROFILES) {
      let availability: AiAvailability;
      try {
        availability = toAvailability(await api.availability(profile.options));
      } catch {
        availability = 'unavailable';
      }
      if (availability !== 'unavailable') {
        this.profile = profile;
        this.spanishState.set(profile.spanish);
        this.state.set(availability);
        // Chrome descarga el modelo en segundo plano y no avisa al terminar si
        // la descarga no se pidió desde esta página (o si se recargó): se le
        // vuelve a preguntar hasta que acabe.
        clearTimeout(this.pollTimer);
        if (availability === 'downloading') {
          this.pollTimer = setTimeout(() => void this.refresh(), DOWNLOAD_POLL_MS);
        }
        return;
      }
    }
    this.state.set('unavailable');
  }

  /**
   * Descarga el modelo, o se suma a la descarga que Chrome ya tenga en curso
   * (pedida desde otra pestaña o antes de recargar) para poder mostrar su
   * avance. Chrome exige que se pida desde una acción del usuario (una
   * pulsación), así que debe llamarse directamente desde un botón.
   */
  async download(): Promise<void> {
    const api = this.api();
    if (!api) throw new LocalAiError('Este navegador no tiene inteligencia artificial integrada.');
    clearTimeout(this.pollTimer);
    this.state.set('downloading');
    this.downloaded.set(0);
    let failure: unknown = null;
    try {
      const session = await api.create({
        ...this.profile.options,
        monitor: (monitor: EventTarget) =>
          monitor.addEventListener('downloadprogress', (event) => {
            const loaded = (event as Event & { loaded?: number }).loaded;
            if (typeof loaded === 'number') this.downloaded.set(Math.min(1, Math.max(0, loaded)));
          }),
      });
      session.destroy();
    } catch (error) {
      failure = error ?? new Error('fallo desconocido');
    }
    this.downloaded.set(null);
    if (failure === null) {
      this.state.set('available');
      return;
    }
    // Que esta petición falle no significa que no haya descarga: puede seguir
    // la que Chrome tenía en marcha. Se le pregunta cuál es el estado real.
    this.state.set('downloadable');
    await this.refresh();
    throw new LocalAiError('No se ha podido descargar el modelo. Inténtelo de nuevo.', {
      cause: failure,
    });
  }

  /** Lee el texto que aparece en una imagen. Devuelve una cadena vacía si no hay ninguno. */
  async transcribe(image: Blob): Promise<string> {
    const answer = (await this.ask(image, TRANSCRIBE_PROMPT)).trim();
    return answer === NO_TEXT || answer.replace(/[^\p{L}\p{N}_]/gu, '') === NO_TEXT ? '' : answer;
  }

  /** Enumera los objetos que se reconocen en la foto del interior de un contenedor. */
  async recognize(image: Blob): Promise<string[]> {
    const answer = await this.ask(image, RECOGNIZE_PROMPT, { responseConstraint: OBJECTS_SCHEMA });
    let parsed: unknown;
    try {
      parsed = JSON.parse(answer);
    } catch (error) {
      throw new LocalAiError('El modelo no ha dado una respuesta que se pueda interpretar.', {
        cause: error,
      });
    }
    const list = (parsed as { objetos?: unknown } | null)?.objetos;
    const names = new Map<string, string>();
    for (const item of Array.isArray(list) ? list : []) {
      if (typeof item !== 'string') continue;
      const name = item.trim().replace(/\s+/g, ' ').slice(0, MAX_NAME_LENGTH);
      const key = comparableName(name);
      if (name && !names.has(key)) names.set(key, name.charAt(0).toUpperCase() + name.slice(1));
    }
    return [...names.values()].slice(0, MAX_OBJECTS);
  }

  /** Envía al modelo una imagen con una instrucción y devuelve su respuesta. */
  private async ask(image: Blob, instruction: string, options?: object): Promise<string> {
    const api = this.api();
    if (!api || this.state() !== 'available') {
      throw new LocalAiError('La inteligencia artificial no está disponible en este dispositivo.');
    }
    let session: LanguageModelSession | undefined;
    try {
      session = await api.create(this.profile.options);
      return await session.prompt(
        [
          {
            role: 'user',
            content: [
              { type: 'text', value: instruction },
              { type: 'image', value: image },
            ],
          },
        ],
        options,
      );
    } catch (error) {
      throw new LocalAiError('El modelo no ha podido analizar la imagen. Inténtelo de nuevo.', {
        cause: error,
      });
    } finally {
      session?.destroy();
    }
  }

  private api(): LanguageModelApi | null {
    const api = (this.window as { LanguageModel?: LanguageModelApi } | null)?.LanguageModel;
    return typeof api?.availability === 'function' && typeof api.create === 'function' ? api : null;
  }
}

/**
 * Forma de un nombre para comparar si dos se refieren a lo mismo: sin
 * mayúsculas ni acentos y con cada palabra reducida a una raíz común al
 * singular y al plural («cable» y «cables», «árbol» y «árboles»). Es
 * aproximada a propósito: solo decide qué casillas salen sin marcar.
 */
export function comparableName(name: string): string {
  return normalizeText(name)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .map((word) => (word.length > 3 ? word.replace(/s$/, '').replace(/e$/, '') : word))
    .join(' ');
}

function toAvailability(value: string): AiAvailability {
  return value === 'available' || value === 'downloadable' || value === 'downloading'
    ? value
    : 'unavailable';
}

function readEnabled(): boolean {
  try {
    return localStorage.getItem(ENABLED_KEY) === 'on';
  } catch {
    return false;
  }
}
