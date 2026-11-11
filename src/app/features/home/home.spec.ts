import { TestBed } from '@angular/core/testing';
import { Home } from './home';

describe('Home', () => {
  it('indica que el service worker está inactivo fuera de producción', async () => {
    await TestBed.configureTestingModule({ imports: [Home] }).compileComponents();
    const fixture = TestBed.createComponent(Home);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="sw"]')?.textContent).toContain('Inactivo');
  });
});
