import { DOCUMENT, DestroyRef, Injectable, inject } from '@angular/core';
import { inventoryErrorMessage } from '../inventory/inventory-messages';
import { InventoryStore } from '../inventory/inventory-store';
import { Entity, EntityId, InventoryError } from '../inventory/models';

// Herramientas para agentes de IA mediante WebMCP (https://webmachinelearning.github.io/webmcp/):
// la página declara funciones con nombre, descripción y parámetros, y un
// agente que esté usando el navegador las llama directamente en lugar de
// simular pulsaciones y rellenar formularios. Cada herramienta usa la misma
// lógica que las pantallas, así que valen las mismas reglas y validaciones.
//
// La API es experimental y ha cambiado de sitio entre borradores
// (`navigator.modelContext` primero, `document.modelContext` después): se
// busca en ambos y, si el navegador no la tiene, no se hace nada.

/** Parte de la API de WebMCP que usa la aplicación. */
interface ModelContext {
  registerTool(tool: AgentTool, options?: { signal?: AbortSignal }): unknown;
}

/** Herramienta tal y como la espera `registerTool`. */
export interface AgentTool {
  name: string;
  description: string;
  /** Parámetros, como esquema JSON. */
  inputSchema: Record<string, unknown>;
  annotations?: { readOnlyHint?: boolean };
  execute(input: Record<string, unknown>): Promise<ToolResult>;
}

/** Respuesta con el formato habitual de MCP: un texto con el resultado en JSON. */
interface ToolResult {
  content: { type: 'text'; text: string }[];
}

/** Resultados que se devuelven como máximo en una búsqueda. */
const MAX_RESULTS = 50;

const ID = {
  type: 'string',
  description: 'Identificador del elemento, tal como lo devuelven las demás herramientas.',
};
const PARENT = {
  type: ['string', 'null'],
  description:
    'Identificador del contenedor en el que está. Omítalo o use null para el inicio (la raíz).',
};
const TAGS = { type: 'array', items: { type: 'string' }, description: 'Etiquetas, sin comas.' };
const NOTES = { type: 'string', description: 'Notas libres.' };

@Injectable({ providedIn: 'root' })
export class AgentTools {
  private readonly store = inject(InventoryStore);
  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);
  private started = false;

  /** Ofrece las herramientas al agente del navegador, si este admite WebMCP. */
  start(): void {
    const context = this.modelContext();
    if (this.started || !context) return;
    this.started = true;
    const abort = new AbortController();
    this.destroyRef.onDestroy(() => abort.abort());
    for (const tool of this.tools()) {
      try {
        // Según el borrador devuelve una promesa o nada; un fallo al
        // registrar una herramienta no debe afectar a la aplicación.
        Promise.resolve(context.registerTool(tool, { signal: abort.signal })).catch(
          () => undefined,
        );
      } catch {
        // Navegador con una versión incompatible de la API.
      }
    }
  }

  private modelContext(): ModelContext | null {
    const candidates = [
      (this.document as { modelContext?: ModelContext }).modelContext,
      (this.document.defaultView?.navigator as { modelContext?: ModelContext } | undefined)
        ?.modelContext,
    ];
    return candidates.find((context) => typeof context?.registerTool === 'function') ?? null;
  }

  /** Definición de todas las herramientas. */
  tools(): AgentTool[] {
    const read = (
      name: string,
      description: string,
      properties: Record<string, unknown>,
      required: string[],
      run: (input: Record<string, unknown>) => unknown,
    ): AgentTool => ({
      name,
      description,
      inputSchema: { type: 'object', properties, required },
      annotations: { readOnlyHint: true },
      execute: (input) => this.run(() => run(input ?? {})),
    });
    const write = (
      name: string,
      description: string,
      properties: Record<string, unknown>,
      required: string[],
      run: (input: Record<string, unknown>) => Promise<unknown>,
    ): AgentTool => ({
      name,
      description,
      inputSchema: { type: 'object', properties, required },
      execute: (input) => this.run(() => run(input ?? {})),
    });

    return [
      read(
        'inventario_buscar',
        'Busca contenedores y objetos del inventario de casa por nombre, notas o etiquetas (sin distinguir mayúsculas ni acentos; con varias palabras, deben aparecer todas). Devuelve cada resultado con su ubicación.',
        { texto: { type: 'string', description: 'Texto que buscar.' } },
        ['texto'],
        (input) => {
          const results = this.store.search(text(input['texto']));
          return {
            total: results.length,
            resultados: results.slice(0, MAX_RESULTS).map((entity) => this.describe(entity)),
          };
        },
      ),
      read(
        'inventario_listar_contenido',
        'Lista lo que hay directamente dentro de un contenedor (o en el inicio, si no se indica ninguno): primero los contenedores y después los objetos.',
        { contenedor_id: PARENT },
        [],
        (input) => {
          const parentId = optionalId(input['contenedor_id']);
          if (parentId) this.container(parentId);
          return {
            contenedor: parentId ? this.describe(this.container(parentId)) : null,
            contenido: this.store.children(parentId).map((entity) => this.describe(entity)),
          };
        },
      ),
      read(
        'inventario_ver_elemento',
        'Devuelve todos los datos de un contenedor o de un objeto, incluida su ubicación completa.',
        { id: ID },
        ['id'],
        (input) => this.describe(this.entity(text(input['id']))),
      ),
      read(
        'inventario_listar_tipos',
        'Lista los tipos de contenedor disponibles (casa, habitación, armario, caja…), con el identificador que se usa al crear o editar un contenedor.',
        {},
        [],
        () => this.store.types().map((type) => ({ id: type.id, nombre: type.name })),
      ),
      write(
        'inventario_crear_contenedor',
        'Crea un contenedor (una casa, una habitación, un armario, una caja…) en el inicio o dentro de otro contenedor. Los contenedores pueden anidarse sin límite.',
        {
          nombre: { type: 'string', description: 'Nombre del contenedor.' },
          contenedor_id: PARENT,
          tipo_id: {
            type: ['string', 'null'],
            description: 'Identificador del tipo, de inventario_listar_tipos. Opcional.',
          },
          notas: NOTES,
          etiquetas: TAGS,
        },
        ['nombre'],
        async (input) =>
          this.describe(
            await this.store.addContainer({
              name: text(input['nombre']),
              parentId: optionalId(input['contenedor_id']),
              typeId: this.typeId(input['tipo_id']),
              notes: text(input['notas']),
              tags: tags(input['etiquetas']),
            }),
          ),
      ),
      write(
        'inventario_crear_objeto',
        'Crea un objeto en el inicio o dentro de un contenedor.',
        {
          nombre: { type: 'string', description: 'Nombre del objeto.' },
          contenedor_id: PARENT,
          cantidad: { type: 'integer', minimum: 1, description: 'Unidades. Por defecto, 1.' },
          notas: NOTES,
          etiquetas: TAGS,
        },
        ['nombre'],
        async (input) =>
          this.describe(
            await this.store.addItem({
              name: text(input['nombre']),
              parentId: optionalId(input['contenedor_id']),
              quantity: input['cantidad'] === undefined ? 1 : Number(input['cantidad']),
              notes: text(input['notas']),
              tags: tags(input['etiquetas']),
            }),
          ),
      ),
      write(
        'inventario_editar_elemento',
        'Cambia datos de un contenedor o de un objeto. Solo se modifican los campos que se indiquen. Para cambiarlo de sitio use inventario_mover_elemento.',
        {
          id: ID,
          nombre: { type: 'string' },
          notas: NOTES,
          etiquetas: { ...TAGS, description: 'Sustituye a las etiquetas actuales.' },
          cantidad: { type: 'integer', minimum: 1, description: 'Solo para objetos.' },
          tipo_id: { type: ['string', 'null'], description: 'Solo para contenedores.' },
        },
        ['id'],
        async (input) => {
          const entity = this.entity(text(input['id']));
          const changes: Parameters<InventoryStore['update']>[1] = {};
          if (input['nombre'] !== undefined) changes.name = text(input['nombre']);
          if (input['notas'] !== undefined) changes.notes = text(input['notas']);
          if (input['etiquetas'] !== undefined) changes.tags = tags(input['etiquetas']);
          if (input['cantidad'] !== undefined && entity.kind === 'item') {
            changes.quantity = Number(input['cantidad']);
          }
          if (input['tipo_id'] !== undefined && entity.kind === 'container') {
            changes.typeId = this.typeId(input['tipo_id']);
          }
          return this.describe(await this.store.update(entity.id, changes));
        },
      ),
      write(
        'inventario_mover_elemento',
        'Traslada un contenedor (con todo su contenido) o un objeto a otro contenedor, o al inicio. Un contenedor no puede moverse dentro de sí mismo ni de algo que contenga.',
        {
          id: ID,
          contenedor_id: { ...PARENT, description: 'Contenedor de destino; null para el inicio.' },
        },
        ['id', 'contenedor_id'],
        async (input) =>
          this.describe(
            await this.store.move(
              this.entity(text(input['id'])).id,
              optionalId(input['contenedor_id']),
            ),
          ),
      ),
      write(
        'inventario_eliminar_elemento',
        'Envía un contenedor o un objeto a la papelera, de la que se puede recuperar durante 30 días con inventario_restaurar_elemento. Si es un contenedor con contenido, este pasa antes al contenedor superior y solo el contenedor va a la papelera.',
        { id: ID },
        ['id'],
        async (input) => {
          const removed = await this.store.remove(this.entity(text(input['id'])).id, {
            moveContents: true,
          });
          return { id: removed.id, nombre: removed.name, en_la_papelera: true };
        },
      ),
      write(
        'inventario_restaurar_elemento',
        'Recupera de la papelera un elemento eliminado.',
        { id: ID },
        ['id'],
        async (input) => this.describe(await this.store.restore(text(input['id']))),
      ),
    ];
  }

  /** Ejecuta una herramienta y da el resultado, o un error que el agente pueda entender. */
  private async run(action: () => unknown): Promise<ToolResult> {
    if (this.store.status() !== 'ready') {
      throw new Error(
        'El inventario no está disponible: hay que iniciar sesión en la aplicación y esperar a que cargue.',
      );
    }
    try {
      const result = await action();
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    } catch (error) {
      throw new Error(inventoryErrorMessage(error), { cause: error });
    }
  }

  private entity(id: EntityId): Entity {
    const entity = this.store.get(id);
    if (!entity) throw new InventoryError('not_found');
    return entity;
  }

  private container(id: EntityId): Entity {
    const entity = this.entity(id);
    if (entity.kind !== 'container') throw new InventoryError('invalid_parent');
    return entity;
  }

  /** Valida que el tipo exista; sin indicar, el contenedor queda sin tipo. */
  private typeId(value: unknown): EntityId | null {
    const id = optionalId(value);
    if (id && !this.store.types().some((type) => type.id === id)) {
      throw new InventoryError('not_found');
    }
    return id;
  }

  /** Datos de un elemento en la forma en que los recibe el agente. */
  private describe(entity: Entity) {
    const ancestors = this.store.path(entity.id).slice(0, -1);
    return {
      id: entity.id,
      clase: entity.kind === 'container' ? 'contenedor' : 'objeto',
      nombre: entity.name,
      // De fuera hacia dentro; vacío si está en el inicio.
      ubicacion: this.store.isUnplaced(entity.id)
        ? 'Sin ubicar'
        : ancestors.map((step) => step.name).join(' › ') || 'Inicio',
      contenedor_id: entity.parentId,
      ...(entity.kind === 'container'
        ? {
            tipo: this.store.typeOf(entity)?.name ?? null,
            elementos: this.store.children(entity.id).length,
          }
        : { cantidad: entity.quantity }),
      notas: entity.notes,
      etiquetas: entity.tags,
      fotos: this.store.photosOf(entity.id).length,
      enlace: `${this.document.location.origin}/${entity.kind === 'container' ? 'c' : 'o'}/${entity.id}`,
    };
  }
}

function text(value: unknown): string {
  return typeof value === 'string'
    ? value
    : value === undefined || value === null
      ? ''
      : String(value);
}

function optionalId(value: unknown): EntityId | null {
  const id = text(value).trim();
  return id === '' ? null : id;
}

function tags(value: unknown): string[] {
  return Array.isArray(value) ? value.map(text) : [];
}
