import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import {
  AuthError,
  AuthService,
  DRIVE_SCOPE,
  GOOGLE_CLIENT_ID,
  PAGE_REDIRECT,
} from './auth-service';
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
      { provide: PAGE_REDIRECT, useValue: vi.fn() },
    ],
  });
  return {
    auth: TestBed.inject(AuthService),
    http: TestBed.inject(HttpTestingController),
    go: TestBed.inject(PAGE_REDIRECT) as ReturnType<typeof vi.fn>,
  };
}

const tick = () => new Promise((resolve) => setTimeout(resolve));
const CLIENT = 'test.apps.googleusercontent.com';
const casaSession = (expiresAt: number) =>
  JSON.stringify({
    accessToken: 'viejo',
    expiresAt,
    user: { name: 'Casa', email: 'casa@example.com', photoUrl: null },
  });

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

  it('al reanudar abre una sola ventana aunque coincidan varias peticiones', async () => {
    const requests = fakeGis([token('t1', 30), token('t2')]);
    const { auth, http } = setup();
    await signIn(auth, http);

    // El toque que reanuda la sesión puede lanzar además una llamada a Drive.
    const resumed = Promise.all([auth.signIn(), auth.signIn(), auth.validToken()]);
    await new Promise((resolve) => setTimeout(resolve));
    http
      .expectOne((r) => r.url.endsWith('/about'))
      .flush({ user: { displayName: 'Casa', emailAddress: 'casa@example.com' } });

    expect((await resumed)[2]).toBe('t2');
    expect(requests.length).toBe(2);
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

  describe('renovación por redirección', () => {
    afterEach(() => history.replaceState(null, '', '/'));

    /** Deja la página como al volver de Google tras una ida con ese `state`. */
    function comeBack(fragment: string, pending = { state: 's1', returnUrl: '/c/caja?x=1' }) {
      sessionStorage.setItem('inventario.redireccion', JSON.stringify(pending));
      history.replaceState(null, '', `/#${fragment}`);
    }

    it('recuerda en este dispositivo el modo elegido', () => {
      const first = setup();
      expect(first.auth.redirectMode()).toBe(false);
      first.auth.setRedirectMode(true);
      expect(localStorage.getItem('inventario.renovacion')).toBe('redirect');

      TestBed.resetTestingModule();
      const reopened = setup();
      expect(reopened.auth.redirectMode()).toBe(true);
      reopened.auth.setRedirectMode(false);
      expect(localStorage.getItem('inventario.renovacion')).toBeNull();
    });

    it('al iniciar sesión lleva la página a Google y anota a dónde volver', () => {
      history.replaceState(null, '', '/c/caja?x=1');
      const { auth, go } = setup();
      auth.setRedirectMode(true);

      void auth.signIn();

      const url = new URL(go.mock.calls[0][0] as string);
      expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
      expect(url.searchParams.get('client_id')).toBe(CLIENT);
      expect(url.searchParams.get('response_type')).toBe('token');
      expect(url.searchParams.get('scope')).toBe(DRIVE_SCOPE);
      expect(url.searchParams.get('redirect_uri')).toBe(auth.redirectUri());
      expect(url.searchParams.has('prompt')).toBe(false);
      const pending = JSON.parse(sessionStorage.getItem('inventario.redireccion') as string);
      expect(pending).toEqual({ state: url.searchParams.get('state'), returnUrl: '/c/caja?x=1' });
    });

    it('se puede forzar la ventana emergente aunque el modo sea redirección', async () => {
      fakeGis([token('t1')]);
      const { auth, http, go } = setup();
      auth.setRedirectMode(true);

      const done = auth.signIn({ popup: true });
      await tick();
      http
        .expectOne((r) => r.url.endsWith('/about'))
        .flush({
          user: { displayName: 'Casa', emailAddress: 'casa@example.com' },
        });
      await done;

      expect(go).not.toHaveBeenCalled();
      expect(auth.status()).toBe('signedIn');
    });

    it('al volver de Google comprueba el token, inicia la sesión y limpia la dirección', async () => {
      comeBack(`access_token=nuevo&expires_in=3600&state=s1&scope=${DRIVE_SCOPE}`);
      const { auth, http } = setup();

      const done = auth.completeRedirect();
      // El token ya no está en la dirección y se vuelve a la pantalla anterior.
      expect(location.pathname + location.search + location.hash).toBe('/c/caja?x=1');
      const info = http.expectOne((r) => r.url.endsWith('/tokeninfo'));
      expect(info.request.params.get('access_token')).toBe('nuevo');
      info.flush({ aud: CLIENT, scope: DRIVE_SCOPE });
      await tick();
      http
        .expectOne((r) => r.url.endsWith('/about'))
        .flush({
          user: { displayName: 'Casa', emailAddress: 'casa@example.com' },
        });
      await done;

      expect(auth.status()).toBe('signedIn');
      expect(await auth.validToken()).toBe('nuevo');
      expect(auth.redirectError()).toBeNull();
      expect(sessionStorage.getItem('inventario.redireccion')).toBeNull();
    });

    it('al renovar una sesión que ya existía no vuelve a pedir el perfil', async () => {
      localStorage.setItem('inventario.sesion', casaSession(Date.now() - 1000));
      comeBack(`access_token=nuevo&expires_in=3600&state=s1&scope=${DRIVE_SCOPE}`);
      const { auth, http } = setup();
      expect(auth.status()).toBe('expired');

      const done = auth.completeRedirect();
      http
        .expectOne((r) => r.url.endsWith('/tokeninfo'))
        .flush({ aud: CLIENT, scope: DRIVE_SCOPE });
      await done;

      http.expectNone((r) => r.url.endsWith('/about'));
      expect(auth.status()).toBe('signedIn');
      expect(await auth.validToken()).toBe('nuevo');
    });

    it('rechaza un token emitido para otra aplicación', async () => {
      comeBack(`access_token=ajeno&expires_in=3600&state=s1&scope=${DRIVE_SCOPE}`);
      const { auth, http } = setup();

      const done = auth.completeRedirect();
      http
        .expectOne((r) => r.url.endsWith('/tokeninfo'))
        .flush({ aud: 'otra', scope: DRIVE_SCOPE });
      await done;

      expect(auth.status()).toBe('signedOut');
      expect(auth.redirectError()).toBe('no_token');
    });

    it('ignora una respuesta que no corresponde a la ida anotada, sin dejar el token a la vista', async () => {
      comeBack(`access_token=colado&expires_in=3600&state=otro&scope=${DRIVE_SCOPE}`);
      const { auth, http } = setup();

      await auth.completeRedirect();

      http.expectNone((r) => r.url.endsWith('/tokeninfo'));
      expect(location.hash).toBe('');
      expect(auth.status()).toBe('signedOut');
      expect(auth.redirectError()).toBe('redirect_failed');
    });

    it('ignora un token en la dirección si no se había ido a Google', async () => {
      history.replaceState(null, '', '/#access_token=colado&state=s1');
      const { auth, http } = setup();

      await auth.completeRedirect();

      http.expectNone((r) => r.url.endsWith('/tokeninfo'));
      expect(location.hash).toBe('');
      expect(auth.status()).toBe('signedOut');
      expect(auth.redirectError()).toBeNull();
    });

    it('si Google pide intervención, la sesión queda caducada con su motivo', async () => {
      localStorage.setItem('inventario.sesion', casaSession(Date.now() - 1000));
      localStorage.setItem('inventario.renovacion', 'redirect');
      comeBack('error=interaction_required&state=s1');
      const { auth, go } = setup();

      await auth.completeRedirect();

      expect(auth.status()).toBe('expired');
      expect(auth.redirectError()).toBe('interaction_required');
      expect(go).not.toHaveBeenCalled(); // no se insiste
    });

    it('al abrir con la sesión caducada la renueva sola, sin pedir nada al usuario', () => {
      localStorage.setItem('inventario.sesion', casaSession(Date.now() - 1000));
      localStorage.setItem('inventario.renovacion', 'redirect');
      const { auth, go } = setup();

      void auth.completeRedirect();

      const url = new URL(go.mock.calls[0][0] as string);
      expect(url.searchParams.get('prompt')).toBe('none');
      expect(url.searchParams.get('login_hint')).toBe('casa@example.com');
    });

    it('no va a Google al abrir si la sesión sigue vigente o el modo no está elegido', async () => {
      localStorage.setItem('inventario.sesion', casaSession(Date.now() + 3_000_000));
      localStorage.setItem('inventario.renovacion', 'redirect');
      const vigente = setup();
      await vigente.auth.completeRedirect();
      expect(vigente.go).not.toHaveBeenCalled();

      TestBed.resetTestingModule();
      localStorage.setItem('inventario.sesion', casaSession(Date.now() - 1000));
      localStorage.removeItem('inventario.renovacion');
      const emergente = setup();
      await emergente.auth.completeRedirect();
      expect(emergente.go).not.toHaveBeenCalled();
    });

    it('si se fue a Google y no se volvió con respuesta, no lo reintenta solo', async () => {
      localStorage.setItem('inventario.sesion', casaSession(Date.now() - 1000));
      localStorage.setItem('inventario.renovacion', 'redirect');
      sessionStorage.setItem(
        'inventario.redireccion',
        JSON.stringify({ state: 's1', returnUrl: '/' }),
      );
      const { auth, go } = setup();

      await auth.completeRedirect();

      expect(go).not.toHaveBeenCalled();
      expect(auth.redirectError()).toBe('redirect_failed');
      expect(auth.status()).toBe('expired');
    });
  });

  it('anota que el navegador bloqueó la ventana de Google y lo olvida cuando vuelve a abrirse', async () => {
    fakeGis([token('t1', 30), { error: { type: 'popup_failed_to_open' } }, token('t3')]);
    const { auth, http } = setup();
    await signIn(auth, http);
    expect(auth.popupBlocked()).toBe(false);

    await expect(auth.validToken()).rejects.toMatchObject({ code: 'popup_failed_to_open' });
    expect(auth.popupBlocked()).toBe(true);
    expect(localStorage.getItem('inventario.emergentes')).not.toBeNull();

    await signIn(auth, http);
    expect(auth.popupBlocked()).toBe(false);
    expect(localStorage.getItem('inventario.emergentes')).toBeNull();
  });
});
