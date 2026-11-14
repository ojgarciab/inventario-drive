import { Routes } from '@angular/router';
import { authGuard, guestGuard } from './core/auth/auth-guard';

const browse = () => import('./features/browse/browse').then((m) => m.Browse);
const entityForm = () => import('./features/entity-form/entity-form').then((m) => m.EntityForm);

export const routes: Routes = [
  {
    path: 'login',
    title: 'Iniciar sesión',
    canActivate: [guestGuard],
    loadComponent: () => import('./features/login/login').then((m) => m.Login),
  },
  {
    path: '',
    canActivate: [authGuard],
    children: [
      { path: '', pathMatch: 'full', loadComponent: browse },
      { path: 'c/:id', loadComponent: browse },
      {
        path: 'c/:id/editar',
        loadComponent: entityForm,
        data: { kind: 'container' },
        title: 'Editar contenedor',
      },
      {
        path: 'o/:id',
        loadComponent: () => import('./features/item-detail/item-detail').then((m) => m.ItemDetail),
      },
      {
        path: 'o/:id/editar',
        loadComponent: entityForm,
        data: { kind: 'item' },
        title: 'Editar objeto',
      },
      {
        path: 'nuevo/contenedor',
        loadComponent: entityForm,
        data: { kind: 'container' },
        title: 'Nuevo contenedor',
      },
      {
        path: 'nuevo/objeto',
        loadComponent: entityForm,
        data: { kind: 'item' },
        title: 'Nuevo objeto',
      },
      {
        path: 'mover/:id',
        title: 'Mover',
        loadComponent: () => import('./features/move/move').then((m) => m.Move),
      },
      {
        path: 'buscar',
        title: 'Buscar',
        loadComponent: () => import('./features/search/search').then((m) => m.Search),
      },
      {
        path: 'etiquetas',
        title: 'Etiquetas',
        loadComponent: () => import('./features/tags/tags').then((m) => m.Tags),
      },
      {
        path: 'almacenamiento',
        title: 'Almacenamiento',
        loadComponent: () => import('./features/storage/storage').then((m) => m.Storage),
      },
      {
        path: 'ajustes',
        title: 'Ajustes',
        loadComponent: () => import('./features/settings/settings').then((m) => m.Settings),
      },
      {
        path: 'papelera',
        title: 'Papelera',
        loadComponent: () => import('./features/trash/trash').then((m) => m.Trash),
      },
      {
        path: 'sin-ubicar',
        title: 'Sin ubicar',
        loadComponent: () => import('./features/unplaced/unplaced').then((m) => m.Unplaced),
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
