import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { InMemoryInventoryRepository } from '../inventory/in-memory-inventory-repository';
import { InventoryRepository } from '../inventory/inventory-repository';
import { InventoryStore } from '../inventory/inventory-store';
import { Connectivity } from '../pwa/connectivity';
import { AgentTool, AgentTools } from './agent-tools';

interface Target {
  modelContext?: unknown;
}

describe('AgentTools (WebMCP)', () => {
  const online = signal(true);

  async function setup({ load = true } = {}) {
    online.set(true);
    TestBed.configureTestingModule({
      providers: [
        { provide: InventoryRepository, useValue: new InMemoryInventoryRepository() },
        { provide: Connectivity, useValue: { online } },
      ],
    });
    const store = TestBed.inject(InventoryStore);
    if (load) await store.load();
    const agent = TestBed.inject(AgentTools);
    const tools = new Map(agent.tools().map((tool) => [tool.name, tool]));
    /** Llama a una herramienta como lo haría el agente y devuelve su resultado. */
    const call = async (name: string, input: Record<string, unknown> = {}) => {
      const tool = tools.get(name);
      if (!tool) throw new Error(`No existe la herramienta ${name}`);
      const result = await tool.execute(input);
      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('text');
      return JSON.parse(result.content[0].text);
    };
    return { store, agent, tools, call };
  }

  /** Simula un navegador con WebMCP en `document` o en `navigator`. */
  function fakeModelContext(target: Target) {
    const registered: { tool: AgentTool; signal?: AbortSignal }[] = [];
    target.modelContext = {
      registerTool: (tool: AgentTool, options?: { signal?: AbortSignal }) => {
        registered.push({ tool, signal: options?.signal });
        return Promise.resolve();
      },
    };
    return registered;
  }

  afterEach(() => {
    delete (document as Target).modelContext;
    delete (navigator as Target).modelContext;
  });

  describe('registro', () => {
    it('ofrece las herramientas al agente del navegador', async () => {
      const registered = fakeModelContext(document as Target);
      const { agent } = await setup();

      agent.start();

      expect(registered.map((r) => r.tool.name)).toEqual([
        'inventario_buscar',
        'inventario_listar_contenido',
        'inventario_ver_elemento',
        'inventario_listar_tipos',
        'inventario_crear_contenedor',
        'inventario_crear_objeto',
        'inventario_editar_elemento',
        'inventario_mover_elemento',
        'inventario_eliminar_elemento',
        'inventario_restaurar_elemento',
      ]);
    });

    it('cada herramienta lleva descripción y un esquema de parámetros válido', async () => {
      const { tools } = await setup();
      for (const tool of tools.values()) {
        expect(tool.description.length).toBeGreaterThan(20);
        expect(tool.inputSchema['type']).toBe('object');
        const properties = tool.inputSchema['properties'] as Record<string, unknown>;
        for (const name of tool.inputSchema['required'] as string[]) {
          expect(properties[name], `${tool.name}.${name}`).toBeDefined();
        }
      }
      expect(tools.get('inventario_buscar')?.annotations?.readOnlyHint).toBe(true);
      expect(tools.get('inventario_crear_objeto')?.annotations).toBeUndefined();
    });

    it('funciona también con la API en navigator, como en los primeros borradores', async () => {
      const registered = fakeModelContext(navigator as Target);
      const { agent } = await setup();
      agent.start();
      expect(registered.length).toBe(10);
    });

    it('no hace nada en un navegador sin WebMCP, ni se registra dos veces', async () => {
      const { agent } = await setup();
      expect(() => agent.start()).not.toThrow();

      const registered = fakeModelContext(document as Target);
      agent.start();
      agent.start();
      expect(registered.length).toBe(10);
    });

    it('retira las herramientas al cerrarse la aplicación', async () => {
      const registered = fakeModelContext(document as Target);
      const { agent } = await setup();
      agent.start();
      expect(registered[0].signal?.aborted).toBe(false);

      TestBed.resetTestingModule();
      expect(registered.every((r) => r.signal?.aborted)).toBe(true);
    });

    it('un navegador con una versión incompatible no rompe la aplicación', async () => {
      (document as Target).modelContext = {
        registerTool: () => {
          throw new TypeError('firma distinta');
        },
      };
      const { agent } = await setup();
      expect(() => agent.start()).not.toThrow();
    });
  });

  describe('uso', () => {
    it('monta un inventario anidado y lo consulta', async () => {
      const { call } = await setup();
      const tipos = await call('inventario_listar_tipos');
      expect(tipos.map((t: { nombre: string }) => t.nombre)).toEqual([
        'Casa',
        'Habitación',
        'Armario',
        'Caja',
      ]);

      const casa = await call('inventario_crear_contenedor', {
        nombre: 'Casa',
        tipo_id: tipos[0].id,
      });
      const salon = await call('inventario_crear_contenedor', {
        nombre: 'Salón',
        contenedor_id: casa.id,
      });
      const pilas = await call('inventario_crear_objeto', {
        nombre: 'Pilas',
        contenedor_id: salon.id,
        cantidad: 8,
        etiquetas: ['AA'],
        notas: 'Recargables',
      });

      expect(casa).toMatchObject({ clase: 'contenedor', tipo: 'Casa', ubicacion: 'Inicio' });
      expect(pilas).toMatchObject({
        clase: 'objeto',
        nombre: 'Pilas',
        cantidad: 8,
        ubicacion: 'Casa › Salón',
        contenedor_id: salon.id,
        etiquetas: ['AA'],
        notas: 'Recargables',
        fotos: 0,
      });
      expect(pilas.enlace).toMatch(new RegExp(`/o/${pilas.id}$`));

      const raiz = await call('inventario_listar_contenido');
      expect(raiz.contenedor).toBeNull();
      expect(raiz.contenido.map((e: { nombre: string }) => e.nombre)).toEqual(['Casa']);
      const dentro = await call('inventario_listar_contenido', { contenedor_id: salon.id });
      expect(dentro.contenedor.nombre).toBe('Salón');
      expect(dentro.contenido.map((e: { nombre: string }) => e.nombre)).toEqual(['Pilas']);
      expect((await call('inventario_ver_elemento', { id: salon.id })).elementos).toBe(1);
    });

    it('busca sin distinguir acentos y limita el número de resultados', async () => {
      const { call, store } = await setup();
      await store.addItem({ name: 'Árbol de Navidad' });
      for (let i = 0; i < 55; i++) await store.addItem({ name: `Tornillo ${i}` });

      const arbol = await call('inventario_buscar', { texto: 'arbol' });
      expect(arbol).toMatchObject({ total: 1, resultados: [{ nombre: 'Árbol de Navidad' }] });

      const muchos = await call('inventario_buscar', { texto: 'tornillo' });
      expect(muchos.total).toBe(55);
      expect(muchos.resultados.length).toBe(50);
    });

    it('edita solo los campos indicados', async () => {
      const { call, store } = await setup();
      const item = await store.addItem({ name: 'Taladro', quantity: 2, notes: 'Con maletín' });

      const edited = await call('inventario_editar_elemento', {
        id: item.id,
        nombre: 'Taladro percutor',
      });

      expect(edited).toMatchObject({
        nombre: 'Taladro percutor',
        cantidad: 2,
        notas: 'Con maletín',
      });
      const again = await call('inventario_editar_elemento', {
        id: item.id,
        etiquetas: [],
        cantidad: 3,
      });
      expect(again).toMatchObject({ nombre: 'Taladro percutor', cantidad: 3, etiquetas: [] });
    });

    it('mueve un contenedor con su contenido, y al inicio con null', async () => {
      const { call, store } = await setup();
      const armario = await store.addContainer({ name: 'Armario', typeId: null });
      const aparador = await store.addContainer({ name: 'Aparador', typeId: null });
      const caja = await store.addContainer({ name: 'Caja', typeId: null, parentId: armario.id });
      const item = await store.addItem({ name: 'Adornos', parentId: caja.id });

      await call('inventario_mover_elemento', { id: caja.id, contenedor_id: aparador.id });
      expect((await call('inventario_ver_elemento', { id: item.id })).ubicacion).toBe(
        'Aparador › Caja',
      );

      const moved = await call('inventario_mover_elemento', { id: item.id, contenedor_id: null });
      expect(moved).toMatchObject({ ubicacion: 'Inicio', contenedor_id: null });
    });

    it('elimina a la papelera y restaura', async () => {
      const { call, store } = await setup();
      const item = await store.addItem({ name: 'Pilas' });

      expect(await call('inventario_eliminar_elemento', { id: item.id })).toEqual({
        id: item.id,
        nombre: 'Pilas',
        en_la_papelera: true,
      });
      expect(store.get(item.id)).toBeUndefined();
      expect(store.trash().length).toBe(1); // sigue pudiéndose recuperar

      expect((await call('inventario_restaurar_elemento', { id: item.id })).nombre).toBe('Pilas');
      expect(store.get(item.id)).toBeDefined();
    });
  });

  describe('errores que el agente puede entender', () => {
    it('rechaza las operaciones imposibles con el mismo mensaje que vería el usuario', async () => {
      const { call, store } = await setup();
      const caja = await store.addContainer({ name: 'Caja', typeId: null });
      const dentro = await store.addContainer({ name: 'Dentro', typeId: null, parentId: caja.id });
      const item = await store.addItem({ name: 'Pilas' });

      await expect(call('inventario_ver_elemento', { id: 'no-existe' })).rejects.toThrow(
        'Ese elemento ya no existe.',
      );
      await expect(
        call('inventario_mover_elemento', { id: caja.id, contenedor_id: dentro.id }),
      ).rejects.toThrow('Un contenedor no puede estar dentro de sí mismo.');
      await expect(
        call('inventario_crear_objeto', { nombre: 'x', contenedor_id: item.id }),
      ).rejects.toThrow('El contenedor de destino ya no existe.');
      await expect(call('inventario_crear_objeto', { nombre: '  ' })).rejects.toThrow(
        'Escriba un nombre.',
      );
      await expect(call('inventario_crear_objeto', { nombre: 'x', cantidad: 0 })).rejects.toThrow(
        'La cantidad debe ser un número entero mayor que cero.',
      );
      await expect(
        call('inventario_crear_contenedor', { nombre: 'x', tipo_id: 'no-existe' }),
      ).rejects.toThrow('Ese elemento ya no existe.');
      expect(store.counts()).toEqual({ containers: 2, items: 1 });
    });

    it('sin sesión o sin inventario cargado explica qué hace falta', async () => {
      const { call } = await setup({ load: false });
      await expect(call('inventario_buscar', { texto: 'x' })).rejects.toThrow(
        'hay que iniciar sesión',
      );
    });

    it('sin conexión deja consultar pero no modificar', async () => {
      const { call, store } = await setup();
      await store.addItem({ name: 'Pilas' });
      online.set(false);

      expect((await call('inventario_buscar', { texto: 'pilas' })).total).toBe(1);
      await expect(call('inventario_crear_objeto', { nombre: 'x' })).rejects.toThrow(
        'No hay conexión',
      );
    });
  });
});
