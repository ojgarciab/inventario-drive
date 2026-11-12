import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { clickOn, setupApp, texts, typeInto } from '../../testing';

const submit = (el: HTMLElement) =>
  el.querySelector('form')?.dispatchEvent(new Event('submit', { cancelable: true }));

describe('EntityForm', () => {
  it('crea un contenedor en la raíz y lo abre', async () => {
    const { open, settle, store } = await setupApp();
    const el = await open('/nuevo/contenedor');
    expect(el.querySelector('h1')?.textContent).toBe('Nuevo contenedor');

    typeInto(el, 'input[formControlName="name"]', ' Casa ');
    typeInto(el, 'textarea', 'La de la playa');
    typeInto(el, 'input[formControlName="tags"]', 'verano, playa');
    submit(el);
    const next = await settle();

    const [casa] = store.children(null);
    expect(casa).toMatchObject({
      kind: 'container',
      name: 'Casa',
      notes: 'La de la playa',
      tags: ['verano', 'playa'],
      parentId: null,
    });
    // En la raíz se propone el primer tipo.
    expect(store.typeOf(casa as never)?.name).toBe('Casa');
    expect(TestBed.inject(Router).url).toBe(`/c/${casa.id}`);
    expect(next.querySelector('h1')?.textContent).toBe('Casa');
  });

  it('propone el tipo siguiente al del contenedor padre', async () => {
    const { open, settle, store, typeId } = await setupApp();
    const casa = await store.addContainer({ name: 'Casa', typeId: typeId('Casa') });

    const el = await open(`/nuevo/contenedor?en=${casa.id}`);
    expect(texts(el, 'app-breadcrumb li')).toEqual(['Inicio', 'Casa']);
    typeInto(el, 'input[formControlName="name"]', 'Dormitorio');
    submit(el);
    await settle();

    const [dormitorio] = store.children(casa.id);
    expect(store.typeOf(dormitorio as never)?.name).toBe('Habitación');
  });

  it('crea un objeto dentro de un contenedor y vuelve a él', async () => {
    const { open, settle, store } = await setupApp();
    const caja = await store.addContainer({ name: 'Caja', typeId: null });

    const el = await open(`/nuevo/objeto?en=${caja.id}`);
    expect(el.querySelector('mat-select')).toBeNull();
    typeInto(el, 'input[formControlName="name"]', 'Pilas');
    typeInto(el, 'input[formControlName="quantity"]', '8');
    submit(el);
    await settle();

    expect(store.children(caja.id)).toMatchObject([{ kind: 'item', name: 'Pilas', quantity: 8 }]);
    expect(TestBed.inject(Router).url).toBe(`/c/${caja.id}`);
  });

  it('no guarda sin nombre ni con una cantidad inválida', async () => {
    const { open, settle, store } = await setupApp();
    const el = await open('/nuevo/objeto');

    typeInto(el, 'input[formControlName="name"]', '   ');
    submit(el);
    await settle();
    expect(store.counts().items).toBe(0);

    typeInto(el, 'input[formControlName="name"]', 'Pilas');
    typeInto(el, 'input[formControlName="quantity"]', '0');
    submit(el);
    await settle();
    expect(store.counts().items).toBe(0);
    expect(TestBed.inject(Router).url).toBe('/nuevo/objeto');
  });

  it('edita un objeto partiendo de sus datos actuales', async () => {
    const { open, settle, store } = await setupApp();
    const item = await store.addItem({ name: 'Taladro', quantity: 2, tags: ['bricolaje'] });

    const el = await open(`/o/${item.id}/editar`);
    expect(el.querySelector('h1')?.textContent).toBe('Editar objeto');
    const name = el.querySelector<HTMLInputElement>('input[formControlName="name"]');
    expect(name?.value).toBe('Taladro');
    expect(el.querySelector<HTMLInputElement>('input[formControlName="quantity"]')?.value).toBe(
      '2',
    );
    expect(el.querySelector<HTMLInputElement>('input[formControlName="tags"]')?.value).toBe(
      'bricolaje',
    );

    typeInto(el, 'input[formControlName="name"]', 'Taladro percutor');
    typeInto(el, 'input[formControlName="tags"]', '');
    submit(el);
    await settle();

    expect(store.get(item.id)).toMatchObject({ name: 'Taladro percutor', quantity: 2, tags: [] });
    expect(TestBed.inject(Router).url).toBe(`/o/${item.id}`);
  });

  it('muestra el error y permite reintentar si Drive falla', async () => {
    const { open, settle, store, repository } = await setupApp();
    vi.spyOn(repository, 'createItem').mockRejectedValueOnce(new Error('sin red'));
    const el = await open('/nuevo/objeto');

    typeInto(el, 'input[formControlName="name"]', 'Pilas');
    submit(el);
    await settle();
    expect(el.querySelector('[role="alert"]')?.textContent).toContain('No se ha podido guardar');
    expect(el.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(false);

    submit(el);
    await settle();
    expect(store.counts().items).toBe(1);
  });

  it('avisa si lo que se quiere editar no existe', async () => {
    const { open } = await setupApp();
    const el = await open('/c/no-existe/editar');
    expect(el.querySelector('[role="alert"]')?.textContent).toContain('ya no existe');
    expect(el.querySelector('form')).toBeNull();
  });

  describe('edición simultánea desde otro dispositivo', () => {
    it('guarda solo los campos cambiados y conserva lo que el otro cambió en los demás', async () => {
      const { open, settle, store, repository } = await setupApp();
      const item = await store.addItem({ name: 'Taladro', quantity: 1, notes: 'Antiguas' });
      const el = await open(`/o/${item.id}/editar`);
      const update = vi.spyOn(repository, 'updateEntity');

      // Mientras el formulario está abierto, otro dispositivo cambia la cantidad.
      await repository.updateEntity(item.id, { quantity: 5 });
      update.mockClear();
      typeInto(el, 'input[formControlName="name"]', 'Taladro percutor');
      submit(el);
      await settle();

      expect(update.mock.calls).toEqual([[item.id, { name: 'Taladro percutor' }]]);
      expect(store.get(item.id)).toMatchObject({
        name: 'Taladro percutor',
        quantity: 5,
        notes: 'Antiguas',
      });
      expect(el.querySelector('.conflict')).toBeNull();
    });

    it('avisa si ambos han cambiado el mismo campo y permite quedarse con el propio', async () => {
      const { open, settle, store, repository } = await setupApp();
      const item = await store.addItem({ name: 'Taladro' });
      const el = await open(`/o/${item.id}/editar`);

      await repository.updateEntity(item.id, { name: 'Taladro Bosch' });
      typeInto(el, 'input[formControlName="name"]', 'Taladro percutor');
      submit(el);
      await settle();

      expect(el.querySelector('.conflict')?.textContent).toContain('ha cambiado el nombre');
      expect(store.get(item.id)?.name).toBe('Taladro Bosch'); // todavía no se ha guardado
      expect(TestBed.inject(Router).url).toBe(`/o/${item.id}/editar`);

      clickOn('.conflict button', 'La mía');
      await settle();

      expect(store.get(item.id)?.name).toBe('Taladro percutor');
      expect(TestBed.inject(Router).url).toBe(`/o/${item.id}`);
    });

    it('permite adoptar la versión del otro dispositivo sin perder los demás cambios', async () => {
      const { open, settle, store, repository } = await setupApp();
      const item = await store.addItem({ name: 'Taladro' });
      const el = await open(`/o/${item.id}/editar`);

      await repository.updateEntity(item.id, { name: 'Taladro Bosch' });
      typeInto(el, 'input[formControlName="name"]', 'Taladro percutor');
      typeInto(el, 'textarea', 'Con maletín');
      submit(el);
      await settle();
      clickOn('.conflict button', 'La del otro dispositivo');
      await settle();

      const name = el.querySelector<HTMLInputElement>('input[formControlName="name"]');
      expect(name?.value).toBe('Taladro Bosch');
      expect(el.querySelector('.conflict')).toBeNull();

      submit(el);
      await settle();
      expect(store.get(item.id)).toMatchObject({ name: 'Taladro Bosch', notes: 'Con maletín' });
    });

    it('no molesta si el otro dispositivo dejó el mismo valor', async () => {
      const { open, settle, store, repository } = await setupApp();
      const item = await store.addItem({ name: 'Taladro' });
      const el = await open(`/o/${item.id}/editar`);

      await repository.updateEntity(item.id, { name: 'Taladro percutor' });
      typeInto(el, 'input[formControlName="name"]', 'Taladro percutor');
      submit(el);
      await settle();

      expect(TestBed.inject(Router).url).toBe(`/o/${item.id}`);
    });

    it('avisa si el elemento se eliminó mientras se editaba', async () => {
      const { open, settle, store, repository } = await setupApp();
      const item = await store.addItem({ name: 'Taladro' });
      const el = await open(`/o/${item.id}/editar`);

      await repository.purgeEntity(item.id);
      typeInto(el, 'input[formControlName="name"]', 'Otro');
      submit(el);
      await settle();

      expect(store.get(item.id)).toBeUndefined();
      expect(document.body.textContent).toContain('ya no existe');
    });
  });
});
