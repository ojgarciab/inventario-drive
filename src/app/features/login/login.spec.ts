import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { AuthError, AuthService } from '../../core/auth/auth-service';
import { Login } from './login';

describe('Login', () => {
  async function render(signIn: () => Promise<void>) {
    await TestBed.configureTestingModule({
      imports: [Login],
      providers: [provideRouter([]), { provide: AuthService, useValue: { signIn } }],
    }).compileComponents();
    const fixture = TestBed.createComponent(Login);
    await fixture.whenStable();
    return fixture;
  }

  it('inicia sesión y entra en la aplicación', async () => {
    const fixture = await render(() => Promise.resolve());
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    (fixture.nativeElement as HTMLElement).querySelector('button')?.click();
    await fixture.whenStable();
    expect(navigate).toHaveBeenCalledWith('/');
  });

  it('explica el error si se cierra la ventana de Google', async () => {
    const fixture = await render(() => Promise.reject(new AuthError('popup_closed')));
    const el = fixture.nativeElement as HTMLElement;
    el.querySelector('button')?.click();
    await fixture.whenStable();
    expect(el.querySelector('[role="alert"]')?.textContent).toContain('Se cerró la ventana');
    expect(el.querySelector('button')?.disabled).toBe(false);
  });
});
