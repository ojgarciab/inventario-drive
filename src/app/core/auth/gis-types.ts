// Tipos mínimos de Google Identity Services (modelo de token) que usa la aplicación.

export interface GisTokenResponse {
  access_token?: string;
  expires_in?: number | string;
  scope?: string;
  error?: string;
  error_description?: string;
}

export interface GisClientError {
  type: string;
  message?: string;
}

export interface GisTokenRequest {
  prompt?: '' | 'none' | 'consent' | 'select_account';
  login_hint?: string;
}

export interface GisTokenClient {
  requestAccessToken(overrides?: GisTokenRequest): void;
}

export interface GisOauth2 {
  initTokenClient(config: {
    client_id: string;
    scope: string;
    callback: (response: GisTokenResponse) => void;
    error_callback?: (error: GisClientError) => void;
  }): GisTokenClient;
}

declare global {
  interface Window {
    google?: { accounts?: { oauth2?: GisOauth2 } };
  }
}
