import { HttpClient } from '@angular/common/http';
import { DOCUMENT, Injectable, InjectionToken, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { GisOauth2, GisTokenRequest, GisTokenResponse } from './gis-types';

export const GOOGLE_CLIENT_ID = new InjectionToken<string>('GOOGLE_CLIENT_ID', {
  providedIn: 'root',
  factory: () => environment.googleClientId,
});

export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
export const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const GIS_URL = 'https://accounts.google.com/gsi/client';
const AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_INFO_URL = 'https://www.googleapis.com/oauth2/v3/tokeninfo';
const SESSION_KEY = 'inventario.sesion';
const HINT_KEY = 'inventario.cuenta';
/** Preferencia de este dispositivo; solo se anota cuando se renueva por redirección. */
const MODE_KEY = 'inventario.renovacion';
/** Anotación de que el navegador bloqueó la última ventana de Google. */
const BLOCKED_KEY = 'inventario.emergentes';
/** Ida a Google en curso (redirección): con qué `state` se fue y a dónde volver. */
const PENDING_KEY = 'inventario.redireccion';
/** Margen con el que un token se considera caducado antes de su hora real. */
const EXPIRY_MARGIN_MS = 60_000;

export type AuthStatus = 'signedOut' | 'signedIn' | 'expired';

export interface UserProfile {
  name: string;
  email: string;
  photoUrl: string | null;
}

interface Session {
  accessToken: string;
  expiresAt: number;
  user: UserProfile;
}

interface PendingRedirect {
  state: string;
  /** Ruta de la aplicación en la que se estaba al ir a Google. */
  returnUrl: string;
}

interface TokenInfo {
  aud?: string;
  scope?: string;
}

/** Lleva el navegador a otra página; se puede sustituir en las pruebas. */
export const PAGE_REDIRECT = new InjectionToken<(url: string) => void>('PAGE_REDIRECT', {
  providedIn: 'root',
  factory: () => (url) => window.location.assign(url),
});

interface AboutResponse {
  user?: { displayName?: string; emailAddress?: string; photoLink?: string };
}

/** Error de inicio de sesión; `code` es el código de Google o uno propio. */
export class AuthError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'AuthError';
  }
}

/**
 * Sesión con Google mediante el modelo de token de Google Identity Services.
 *
 * La sesión se guarda en `localStorage` para que sobreviva a que el sistema
 * cierre el navegador (en el móvil ocurre a menudo en segundo plano): al
 * volver se sigue dentro, y solo si el token ya ha caducado hay que reanudarla.
 *
 * El token de acceso dura una hora y no hay token de refresco: al caducar se
 * pide otro en silencio indicando la cuenta (`login_hint`). Si el navegador
 * bloquea esa petición por no venir de un gesto del usuario, la sesión pasa a
 * `expired` y la interfaz ofrece reanudarla.
 *
 * Si el navegador bloquea las ventanas emergentes se puede elegir, en cada
 * dispositivo, renovar por redirección: la página va a Google y vuelve con
 * el token en la dirección (flujo implícito de OAuth 2.0). No necesita gesto
 * del usuario, así que al abrir la aplicación con la sesión caducada se
 * renueva sola. Requiere que la dirección de la aplicación esté entre los
 * URI de redirección autorizados del cliente OAuth.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly clientId = inject(GOOGLE_CLIENT_ID);
  private readonly document = inject(DOCUMENT);
  private readonly go = inject(PAGE_REDIRECT);

  private readonly session = signal<Session | null>(this.restore());
  private readonly needsResume = signal(this.isExpired(this.session()));
  private renewal: Promise<string> | null = null;
  private signingIn: Promise<void> | null = null;
  private gis: Promise<GisOauth2> | null = null;

  readonly user = computed(() => this.session()?.user ?? null);
  readonly status = computed<AuthStatus>(() => {
    if (!this.session()) return 'signedOut';
    return this.needsResume() ? 'expired' : 'signedIn';
  });
  readonly isConfigured = this.clientId !== '';

  private readonly redirecting = signal(this.read(localStorage, MODE_KEY) === 'redirect');
  private readonly blocked = signal(this.read(localStorage, BLOCKED_KEY) !== null);
  private readonly failure = signal<string | null>(null);
  /** En este dispositivo la sesión se renueva por redirección, sin ventana emergente. */
  readonly redirectMode = this.redirecting.asReadonly();
  /** El navegador bloqueó la última ventana de Google que se intentó abrir. */
  readonly popupBlocked = this.blocked.asReadonly();
  /** Código del error con el que volvió de Google la última redirección, si falló. */
  readonly redirectError = this.failure.asReadonly();

  setRedirectMode(enabled: boolean): void {
    this.redirecting.set(enabled);
    if (enabled) this.write(localStorage, MODE_KEY, 'redirect');
    else this.remove(localStorage, MODE_KEY);
  }

  /**
   * Inicia o reanuda la sesión. Debe llamarse desde un gesto del usuario.
   * Las llamadas simultáneas comparten la petición: solo se abre una ventana.
   * En modo de redirección la página se va a Google (la promesa no termina);
   * `popup` fuerza la ventana emergente aunque ese modo esté elegido.
   */
  signIn(options: { popup?: boolean } = {}): Promise<void> {
    this.failure.set(null);
    if (this.redirecting() && !options.popup) {
      const hint = this.session()?.user.email ?? this.readHint();
      return this.redirect(hint ? { login_hint: hint } : {});
    }
    this.signingIn ??= this.signInOnce().finally(() => (this.signingIn = null));
    return this.signingIn;
  }

  /**
   * Termina, al arrancar, lo que tenga que ver con la redirección a Google:
   * recoge el token si se vuelve de allí y, en modo de redirección, renueva
   * la sesión caducada sin esperar a que el usuario lo pida.
   */
  async completeRedirect(): Promise<void> {
    const location = this.document.location;
    const pending = this.takePending();
    const response = new URLSearchParams(location.hash.replace(/^#/, ''));
    const fromGoogle = response.has('access_token') || response.has('error');
    if (fromGoogle) {
      // El token no se deja en la dirección ni en el historial, y se vuelve
      // a la pantalla en la que se estaba.
      const returnUrl = pending?.returnUrl ?? location.pathname + location.search;
      this.document.defaultView?.history.replaceState(null, '', returnUrl);
    }
    if (fromGoogle && pending && response.get('state') === pending.state) {
      await this.acceptResponse(response);
      return;
    }
    if (pending) {
      // Se fue a Google y no se ha vuelto con una respuesta: algo falló allí
      // (por ejemplo, la dirección no está autorizada). No se insiste.
      this.failure.set('redirect_failed');
      return;
    }
    if (
      !fromGoogle &&
      this.redirecting() &&
      this.isConfigured &&
      this.needsResume() &&
      this.document.defaultView?.navigator.onLine !== false
    ) {
      const email = (this.session() as Session).user.email;
      await this.redirect({ login_hint: email, prompt: 'none' });
    }
  }

  private async acceptResponse(response: URLSearchParams): Promise<void> {
    try {
      const accessToken = response.get('access_token');
      if (!accessToken) throw new AuthError(response.get('error') ?? 'no_token');
      // El token llega por la dirección: se comprueba que Google lo emitió
      // para esta aplicación y con el permiso que necesita.
      const info = await firstValueFrom(
        this.http.get<TokenInfo>(TOKEN_INFO_URL, {
          params: { access_token: accessToken },
          headers: { Authorization: `Bearer ${accessToken}` },
        }),
      );
      if (info.aud !== this.clientId) throw new AuthError('no_token');
      if (!info.scope?.split(' ').includes(DRIVE_SCOPE)) throw new AuthError('scope_not_granted');
      const expiresAt = Date.now() + Number(response.get('expires_in') ?? 3600) * 1000;
      const user = this.session()?.user ?? (await this.loadProfile(accessToken));
      this.store({ accessToken, expiresAt, user });
    } catch (error) {
      this.failure.set(error instanceof AuthError ? error.code : 'redirect_failed');
    }
  }

  /** Lleva la página a Google para pedir un token; no vuelve a esta ejecución. */
  private redirect(request: { login_hint?: string; prompt?: 'none' }): Promise<never> {
    if (!this.isConfigured) return Promise.reject(new AuthError('not_configured'));
    const window = this.document.defaultView as Window;
    const location = this.document.location;
    const state = crypto.randomUUID();
    const pending: PendingRedirect = {
      state,
      returnUrl: location.pathname + location.search,
    };
    this.write(sessionStorage, PENDING_KEY, JSON.stringify(pending));
    const url = new URL(AUTHORIZE_URL);
    url.search = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.redirectUri(),
      response_type: 'token',
      scope: DRIVE_SCOPE,
      state,
      ...request,
    }).toString();
    // Si se vuelve con «atrás» y el navegador restaura la página congelada,
    // se recarga para que arranque de nuevo.
    window.addEventListener('pageshow', (event) => {
      if (event.persisted) location.reload();
    });
    this.go(url.toString());
    return new Promise<never>(() => undefined);
  }

  /** Dirección a la que Google devuelve el token: la raíz de la aplicación. */
  redirectUri(): string {
    const base = new URL(this.document.baseURI);
    return base.origin + base.pathname;
  }

  private takePending(): PendingRedirect | null {
    const raw = this.read(sessionStorage, PENDING_KEY);
    this.remove(sessionStorage, PENDING_KEY);
    try {
      const value = raw ? (JSON.parse(raw) as Partial<PendingRedirect>) : null;
      if (value?.state && typeof value.returnUrl === 'string') return value as PendingRedirect;
    } catch {
      // Contenido dañado: como si no se hubiera ido a Google.
    }
    return null;
  }

  /**
   * Deja cargada la biblioteca de Google para que la ventana de inicio de
   * sesión se abra al instante, dentro del gesto del usuario.
   */
  prepare(): void {
    if (this.isConfigured) this.loadGis().catch(() => undefined);
  }

  private async signInOnce(): Promise<void> {
    const hint = this.session()?.user.email ?? this.readHint();
    const response = await this.requestToken(hint ? { prompt: '', login_hint: hint } : {});
    const accessToken = response.access_token as string;
    const expiresAt = Date.now() + Number(response.expires_in ?? 3600) * 1000;
    const user = await this.loadProfile(accessToken);
    this.store({ accessToken, expiresAt, user });
  }

  /**
   * Cierra la sesión en este dispositivo. No se revoca el permiso en Google:
   * la cuenta es compartida y revocarlo cerraría la sesión en los demás.
   */
  signOut(): void {
    this.session.set(null);
    this.needsResume.set(false);
    this.remove(localStorage, SESSION_KEY);
    this.remove(localStorage, HINT_KEY);
  }

  /** Devuelve un token vigente, renovándolo en silencio si ha caducado. */
  async validToken(): Promise<string> {
    const session = this.session();
    if (!session) throw new AuthError('signed_out');
    return this.isExpired(session) ? this.renew() : session.accessToken;
  }

  /** Pide un token nuevo sin interacción. Las llamadas simultáneas comparten petición. */
  renew(): Promise<string> {
    // Si ya se está reanudando la sesión, se espera a ese token en lugar de pedir otro.
    const signingIn = this.signingIn;
    if (signingIn && this.session()) {
      return signingIn.then(() => (this.session() as Session).accessToken);
    }
    this.renewal ??= this.renewOnce().finally(() => (this.renewal = null));
    return this.renewal;
  }

  private async renewOnce(): Promise<string> {
    const session = this.session();
    if (!session) throw new AuthError('signed_out');
    try {
      const response = await this.requestToken({ prompt: '', login_hint: session.user.email });
      const accessToken = response.access_token as string;
      const expiresAt = Date.now() + Number(response.expires_in ?? 3600) * 1000;
      this.store({ ...session, accessToken, expiresAt });
      return accessToken;
    } catch (error) {
      this.needsResume.set(true);
      throw error;
    }
  }

  private async requestToken(request: GisTokenRequest): Promise<GisTokenResponse> {
    if (!this.isConfigured) throw new AuthError('not_configured');
    const oauth2 = await this.loadGis();
    return new Promise<GisTokenResponse>((resolve, reject) => {
      const client = oauth2.initTokenClient({
        client_id: this.clientId,
        scope: DRIVE_SCOPE,
        callback: (response) => {
          if (response.error || !response.access_token) {
            reject(new AuthError(response.error ?? 'no_token'));
          } else if (!response.scope?.split(' ').includes(DRIVE_SCOPE)) {
            reject(new AuthError('scope_not_granted'));
          } else {
            this.notePopup(false);
            resolve(response);
          }
        },
        error_callback: (error) => {
          if (error.type === 'popup_failed_to_open') this.notePopup(true);
          reject(new AuthError(error.type));
        },
      });
      client.requestAccessToken(request);
    });
  }

  private loadGis(): Promise<GisOauth2> {
    const loaded = window.google?.accounts?.oauth2;
    if (loaded) return Promise.resolve(loaded);
    this.gis ??= new Promise<GisOauth2>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = GIS_URL;
      script.async = true;
      script.onload = () => {
        const oauth2 = window.google?.accounts?.oauth2;
        if (oauth2) resolve(oauth2);
        else reject(new AuthError('gis_unavailable'));
      };
      script.onerror = () => {
        this.gis = null;
        script.remove();
        reject(new AuthError('gis_unavailable'));
      };
      document.head.appendChild(script);
    });
    return this.gis;
  }

  private async loadProfile(accessToken: string): Promise<UserProfile> {
    // La cabecera se pone a mano porque la sesión todavía no está guardada.
    const about = await firstValueFrom(
      this.http.get<AboutResponse>(`${DRIVE_API}/about`, {
        params: { fields: 'user(displayName,emailAddress,photoLink)' },
        headers: { Authorization: `Bearer ${accessToken}` },
      }),
    );
    const email = about.user?.emailAddress;
    if (!email) throw new AuthError('no_profile');
    return {
      name: about.user?.displayName || email,
      email,
      photoUrl: about.user?.photoLink ?? null,
    };
  }

  private isExpired(session: Session | null): boolean {
    return session !== null && session.expiresAt - EXPIRY_MARGIN_MS <= Date.now();
  }

  private store(session: Session): void {
    this.session.set(session);
    this.needsResume.set(false);
    this.write(localStorage, SESSION_KEY, JSON.stringify(session));
    this.write(localStorage, HINT_KEY, session.user.email);
  }

  private restore(): Session | null {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      const value = raw ? (JSON.parse(raw) as Partial<Session>) : null;
      if (value?.accessToken && typeof value.expiresAt === 'number' && value.user?.email) {
        return value as Session;
      }
    } catch {
      // Almacenamiento no disponible o contenido dañado: se empieza sin sesión.
    }
    return null;
  }

  private readHint(): string | null {
    return this.read(localStorage, HINT_KEY);
  }

  /** Anota si el navegador ha bloqueado o no la ventana de Google. */
  private notePopup(blocked: boolean): void {
    this.blocked.set(blocked);
    if (blocked) this.write(localStorage, BLOCKED_KEY, 'bloqueadas');
    else this.remove(localStorage, BLOCKED_KEY);
  }

  private read(storage: Storage, key: string): string | null {
    try {
      return storage.getItem(key);
    } catch {
      return null;
    }
  }

  private write(storage: Storage, key: string, value: string): void {
    try {
      storage.setItem(key, value);
    } catch {
      // Sin almacenamiento la sesión vive solo en memoria.
    }
  }

  private remove(storage: Storage, key: string): void {
    try {
      storage.removeItem(key);
    } catch {
      // Nada que borrar.
    }
  }
}
