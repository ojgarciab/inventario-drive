import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AuthService } from '../../core/auth/auth-service';
import { Home } from './home';

describe('Home', () => {
  it('muestra la cuenta con la que se ha iniciado sesión', async () => {
    const user = signal({ name: 'Casa', email: 'casa@example.com', photoUrl: null });
    await TestBed.configureTestingModule({
      imports: [Home],
      providers: [{ provide: AuthService, useValue: { user } }],
    }).compileComponents();
    const fixture = TestBed.createComponent(Home);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="cuenta"]')?.textContent).toContain('casa@example.com');
  });
});
