import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { authInterceptor } from './auth-interceptor';
import { AuthService } from './auth-service';

const URL = 'https://www.googleapis.com/drive/v3/files';
const tick = () => new Promise((resolve) => setTimeout(resolve));

describe('authInterceptor', () => {
  let http: HttpClient;
  let backend: HttpTestingController;
  let auth: { validToken: ReturnType<typeof vi.fn>; renew: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    auth = {
      validToken: vi.fn().mockResolvedValue('t1'),
      renew: vi.fn().mockResolvedValue('t2'),
    };
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: auth },
      ],
    });
    http = TestBed.inject(HttpClient);
    backend = TestBed.inject(HttpTestingController);
  });

  afterEach(() => backend.verify());

  it('añade el token a las llamadas a las API de Google', async () => {
    http.get(URL).subscribe();
    await tick();
    const req = backend.expectOne(URL);
    expect(req.request.headers.get('Authorization')).toBe('Bearer t1');
    req.flush({});
  });

  it('no toca las llamadas a otros servidores', () => {
    http.get('/manifest.webmanifest').subscribe();
    const req = backend.expectOne('/manifest.webmanifest');
    expect(req.request.headers.has('Authorization')).toBe(false);
    expect(auth.validToken).not.toHaveBeenCalled();
    req.flush({});
  });

  it('renueva el token y reintenta una vez ante un 401', async () => {
    let result: unknown;
    http.get(URL).subscribe((value) => (result = value));
    await tick();
    backend.expectOne(URL).flush(null, { status: 401, statusText: 'Unauthorized' });
    await tick();
    const retry = backend.expectOne(URL);
    expect(retry.request.headers.get('Authorization')).toBe('Bearer t2');
    retry.flush({ ok: true });
    expect(result).toEqual({ ok: true });
    expect(auth.renew).toHaveBeenCalledTimes(1);
  });

  it('no reintenta más de una vez', async () => {
    let status = 0;
    http.get(URL).subscribe({ error: (e) => (status = e.status) });
    await tick();
    backend.expectOne(URL).flush(null, { status: 401, statusText: 'Unauthorized' });
    await tick();
    backend.expectOne(URL).flush(null, { status: 401, statusText: 'Unauthorized' });
    await tick();
    expect(status).toBe(401);
    expect(auth.renew).toHaveBeenCalledTimes(1);
  });

  it('propaga los demás errores sin renovar', async () => {
    let status = 0;
    http.get(URL).subscribe({ error: (e) => (status = e.status) });
    await tick();
    backend.expectOne(URL).flush(null, { status: 404, statusText: 'Not Found' });
    expect(status).toBe(404);
    expect(auth.renew).not.toHaveBeenCalled();
  });
});
