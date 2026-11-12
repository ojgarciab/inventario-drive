import { TestBed } from '@angular/core/testing';
import { ThemeService } from './theme-service';

describe('ThemeService', () => {
  const root = document.documentElement;

  beforeEach(() => {
    localStorage.clear();
    root.removeAttribute('data-theme');
  });
  afterEach(() => root.removeAttribute('data-theme'));

  it('por defecto sigue el tema del dispositivo', () => {
    const theme = TestBed.inject(ThemeService);
    expect(theme.preference()).toBe('auto');
    expect(root.hasAttribute('data-theme')).toBe(false);
  });

  it('fuerza el tema elegido y lo recuerda en este dispositivo', () => {
    const theme = TestBed.inject(ThemeService);

    theme.set('light');

    expect(theme.preference()).toBe('light');
    expect(root.getAttribute('data-theme')).toBe('light');
    expect(localStorage.getItem('inventario.tema')).toBe('light');
  });

  it('aplica al arrancar el tema guardado', () => {
    localStorage.setItem('inventario.tema', 'dark');
    const theme = TestBed.inject(ThemeService);
    expect(theme.preference()).toBe('dark');
    expect(root.getAttribute('data-theme')).toBe('dark');
  });

  it('al volver a automático deja de forzarlo', () => {
    const theme = TestBed.inject(ThemeService);
    theme.set('dark');

    theme.set('auto');

    expect(root.hasAttribute('data-theme')).toBe(false);
    expect(localStorage.getItem('inventario.tema')).toBeNull();
  });

  it('ignora un valor guardado que no reconoce', () => {
    localStorage.setItem('inventario.tema', 'sepia');
    expect(TestBed.inject(ThemeService).preference()).toBe('auto');
  });
});
