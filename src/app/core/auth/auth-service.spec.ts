import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { AuthError, AuthService, DRIVE_SCOPE, GOOGLE_CLIENT_ID } from './auth-service';
import { GisClientError, GisTokenRequest, GisTokenResponse } from './gis-types';

type Answer = { response: GisTokenResponse } | { error: GisClientError };

/** Sustituye a Google Identity Services: responde a cada petición con la respuesta programada. */
function fakeGis(answers: Answer[]) {
  const requests: GisTokenRequest[] = [];
  window.google = {
    accounts: {
      oauth2: {
        initTokenClient: (config) => ({
          requestAccessToken: (request = {}) => {
            requests.push(request);
            const answer = answers.shift();
            queueMicrotask(() => {
              if (!answer) config.error_callback?.({ type: 'unexpected_request' });
              else if ('error' in answer) config.error_callback?.(answer.error);
              else config.callback(answer.response);
            });
          },
        }),
      },
    },
  };
  return requests;
}

const token = (value: string, expiresIn = 3600): Answer => ({
  response: { access_token: value, expires_in: expiresIn, scope: DRIVE_SCOPE },
});

function setup(clientId = 'test.apps.googleusercontent.com') {
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: GOOGLE_CLIENT_ID, useValue: clientId },
    ],
  });
  return { auth: TestBed.inject(AuthService), http: TestBed.inject(HttpTestingController) };
}

async function signIn(auth: AuthService, http: HttpTestingController) {
  const done = auth.signIn();
  await new Promise((resolve) => setTimeout(resolve));
  const req = http.expectOne((r) => r.url.endsWith('/about'));
  req.flush({ user: { displayName: 'Casa', emailAddress: 'casa@example.com' } });
  await done;
  return req;
}

describe('AuthService', () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });
  afterEach(() => {
    delete window.google;
  });

  it('empieza sin sesión', () => {
    const { auth } = setup();
    expect(auth.status()).toBe('signedOut');
    expect(auth.user()).toBeNull();
  });

  it('inicia sesión, carga el perfil y guarda la sesión', async () => {
    const requests = fakeGis([token('t1')]);
    const { auth, http } = setup();

    const req = await signIn(auth, http);

    expect(requests).toEqual([{}]);
    expect(req.request.headers.get('Authorization')).toBe('Bearer t1');
    expect(auth.status()).toBe('signedIn');
    expect(auth.user()).toEqual({ name: 'Casa', email: 'casa@example.com', photoUrl: null });
    expect(await auth.validToken()).toBe('t1');
    expect(localStorage.getItem('inventario.sesion')).toContain('t1');
  });

  it('recupera la sesión guardada al recargar', async () => {
    fakeGis([token('t1')]);
    const first = setup();
    await signIn(first.auth, first.http);

    TestBed.resetTestingModule();
    const { auth } = setup();

    expect(auth.status()).toBe('signedIn');
    expect(auth.user()?.email).toBe('casa@example.com');
  });

  it('renueva en silencio indicando la cuenta cuando el token ha caducado', async () => {
    const requests = fakeGis([token('t1', 30), token('t2')]);
    const { auth, http } = setup();
    await signIn(auth, http);

    expect(await auth.validToken()).toBe('t2');
    expect(requests[1]).toEqual({ prompt: '', login_hint: 'casa@example.com' });
    expect(auth.status()).toBe('signedIn');
  });

  it('comparte una sola renovación entre llamadas simultáneas', async () => {
    const requests = fakeGis([token('t1', 30), token('t2')]);
    const { auth, http } = setup();
    await signIn(auth, http);

    const tokens = await Promise.all([auth.validToken(), auth.validToken(), auth.renew()]);

    expect(tokens).toEqual(['t2', 't2', 't2']);
    expect(requests.length).toBe(2);
  });

  it('pasa a caducada si el navegador bloquea la renovación y se reanuda con un gesto', async () => {
    const requests = fakeGis([
      token('t1', 30),
      { error: { type: 'popup_failed_to_open' } },
      token('t3'),
    ]);
    const { auth, http } = setup();
    await signIn(auth, http);

    await expect(auth.validToken()).rejects.toMatchObject({ code: 'popup_failed_to_open' });
    expect(auth.status()).toBe('expired');
    expect(auth.user()?.email).toBe('casa@example.com');

    await signIn(auth, http);
    expect(requests[2]).toEqual({ prompt: '', login_hint: 'casa@example.com' });
    expect(auth.status()).toBe('signedIn');
  });

  it('conserva la sesión aunque el sistema cierre el navegador', async () => {
    fakeGis([token('t1')]);
    const first = setup();
    await signIn(first.auth, first.http);

    // Al cerrarse el navegador se pierde `sessionStorage`, pero no `localStorage`.
    sessionStorage.clear();
    TestBed.resetTestingModule();
    const reopened = setup();

    expect(reopened.auth.status()).toBe('signedIn');
    expect(await reopened.auth.validToken()).toBe('t1');
  });

  it('marca como caducada una sesión guardada cuyo token ya venció', () => {
    localStorage.setItem(
      'inventario.sesion',
      JSON.stringify({
        accessToken: 'viejo',
        expiresAt: Date.now() - 1000,
        user: { name: 'Casa', email: 'casa@example.com', photoUrl: null },
      }),
    );
    const { auth } = setup();
    expect(auth.status()).toBe('expired');
  });

  it('rechaza el inicio de sesión si no se concede el permiso', async () => {
    fakeGis([{ response: { error: 'access_denied' } }]);
    const { auth } = setup();
    await expect(auth.signIn()).rejects.toMatchObject({ code: 'access_denied' });
    expect(auth.status()).toBe('signedOut');
  });

  it('rechaza el inicio de sesión sin identificador de cliente', async () => {
    const { auth } = setup('');
    await expect(auth.signIn()).rejects.toBeInstanceOf(AuthError);
    expect(auth.isConfigured).toBe(false);
  });

  it('cierra la sesión solo en este dispositivo', async () => {
    fakeGis([token('t1')]);
    const { auth, http } = setup();
    await signIn(auth, http);

    auth.signOut();

    expect(auth.status()).toBe('signedOut');
    expect(localStorage.getItem('inventario.sesion')).toBeNull();
    expect(localStorage.getItem('inventario.cuenta')).toBeNull();
    http.verify(); // ninguna llamada de revocación
  });
});
