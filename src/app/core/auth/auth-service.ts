import { HttpClient } from '@angular/common/http';
import { Injectable, InjectionToken, computed, inject, signal } from '@angular/core';
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
const SESSION_KEY = 'inventario.sesion';
const HINT_KEY = 'inventario.cuenta';
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
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly clientId = inject(GOOGLE_CLIENT_ID);

  private readonly session = signal<Session | null>(this.restore());
  private readonly needsResume = signal(this.isExpired(this.session()));
  private renewal: Promise<string> | null = null;
  private gis: Promise<GisOauth2> | null = null;

  readonly user = computed(() => this.session()?.user ?? null);
  readonly status = computed<AuthStatus>(() => {
    if (!this.session()) return 'signedOut';
    return this.needsResume() ? 'expired' : 'signedIn';
  });
  readonly isConfigured = this.clientId !== '';

  /** Inicia o reanuda la sesión. Debe llamarse desde un gesto del usuario. */
  async signIn(): Promise<void> {
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
            resolve(response);
          }
        },
        error_callback: (error) => reject(new AuthError(error.type)),
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
    try {
      return localStorage.getItem(HINT_KEY);
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
