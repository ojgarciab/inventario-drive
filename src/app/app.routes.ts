import { Routes } from '@angular/router';
import { authGuard, guestGuard } from './core/auth/auth-guard';

const browse = () => import('./features/browse/browse').then((m) => m.Browse);
const entityForm = () => import('./features/entity-form/entity-form').then((m) => m.EntityForm);

export const routes: Routes = [
  {
    path: 'login',
    canActivate: [guestGuard],
    loadComponent: () => import('./features/login/login').then((m) => m.Login),
  },
  {
    path: '',
    canActivate: [authGuard],
    children: [
      { path: '', pathMatch: 'full', loadComponent: browse },
      { path: 'c/:id', loadComponent: browse },
      { path: 'c/:id/editar', loadComponent: entityForm, data: { kind: 'container' } },
      {
        path: 'o/:id',
        loadComponent: () => import('./features/item-detail/item-detail').then((m) => m.ItemDetail),
      },
      { path: 'o/:id/editar', loadComponent: entityForm, data: { kind: 'item' } },
      { path: 'nuevo/contenedor', loadComponent: entityForm, data: { kind: 'container' } },
      { path: 'nuevo/objeto', loadComponent: entityForm, data: { kind: 'item' } },
      {
        path: 'mover/:id',
        loadComponent: () => import('./features/move/move').then((m) => m.Move),
      },
      {
        path: 'buscar',
        loadComponent: () => import('./features/search/search').then((m) => m.Search),
      },
      {
        path: 'ajustes',
        loadComponent: () => import('./features/settings/settings').then((m) => m.Settings),
      },
      {
        path: 'papelera',
        loadComponent: () => import('./features/trash/trash').then((m) => m.Trash),
      },
      {
        path: 'sin-ubicar',
        loadComponent: () => import('./features/unplaced/unplaced').then((m) => m.Unplaced),
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
