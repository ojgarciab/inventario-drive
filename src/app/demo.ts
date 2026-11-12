import { Provider, isDevMode, signal } from '@angular/core';
import { AuthService, AuthStatus, UserProfile } from './core/auth/auth-service';
import { InMemoryInventoryRepository } from './core/inventory/in-memory-inventory-repository';
import { InventoryRepository } from './core/inventory/inventory-repository';

const FLAG = 'inventario.demo';

/**
 * Modo de demostración, solo en desarrollo: abriendo `/?demo` la aplicación
 * funciona sin cuenta de Google, con un inventario de ejemplo en memoria que
 * se pierde al recargar. «Cerrar sesión» sale del modo.
 */
export function demoProviders(): Provider[] {
  if (!isDevMode() || !isDemoRequested()) return [];
  const status = signal<AuthStatus>('signedIn');
  const user = signal<UserProfile | null>({
    name: 'Demostración',
    email: 'sin cuenta de Google',
    photoUrl: null,
  });
  const auth: Partial<AuthService> = {
    status,
    user,
    isConfigured: true,
    signIn: async () => undefined,
    validToken: async () => 'demo',
    renew: async () => 'demo',
    signOut: () => {
      sessionStorage.removeItem(FLAG);
      status.set('signedOut');
      user.set(null);
    },
  };
  return [
    { provide: AuthService, useValue: auth },
    { provide: InventoryRepository, useFactory: seededRepository },
  ];
}

function isDemoRequested(): boolean {
  try {
    if (new URLSearchParams(location.search).has('demo')) sessionStorage.setItem(FLAG, '1');
    return sessionStorage.getItem(FLAG) === '1';
  } catch {
    return false;
  }
}

/** Repositorio en memoria que no entrega la primera carga hasta estar sembrado. */
class DemoRepository extends InMemoryInventoryRepository {
  private readonly seeded = seed(this);

  override async loadAll() {
    await this.seeded;
    return super.loadAll();
  }
}

function seededRepository(): InventoryRepository {
  return new DemoRepository();
}

async function seed(repository: InMemoryInventoryRepository): Promise<void> {
  const type = async (slug: string, name: string, icon: string, order: number) =>
    (await repository.createType({ slug, name, icon, order })).id;
  const casaT = await type('casa', 'Casa', 'home', 10);
  const habitacionT = await type('habitacion', 'Habitación', 'meeting_room', 20);
  const armarioT = await type('armario', 'Armario', 'door_sliding', 30);
  const cajaT = await type('caja', 'Caja', 'package_2', 40);

  const box = async (name: string, typeId: string, parentId: string | null, notes = '') =>
    (await repository.createContainer({ name, typeId, parentId, notes })).id;
  const casa = await box('Casa', casaT, null);
  const dormitorio = await box('Dormitorio', habitacionT, casa, 'Planta alta, al fondo.');
  const salon = await box('Salón', habitacionT, casa);
  const armario = await box('Armario empotrado', armarioT, dormitorio);
  await box('Aparador', armarioT, salon);
  const caja = await box('Caja de cartón', cajaT, armario, 'Marcada con una N roja.');

  await repository.createItem({
    name: 'Adornos de Navidad',
    parentId: caja,
    quantity: 24,
    tags: ['navidad', 'frágil'],
  });
  await repository.createItem({
    name: 'Luces del árbol',
    parentId: caja,
    quantity: 2,
    tags: ['navidad'],
  });
  await repository.createItem({ name: 'Maleta azul', parentId: armario });
  await repository.createItem({ name: 'Lámpara de pie', parentId: salon });
}
