import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, InjectionToken, inject } from '@angular/core';
import { Observable, firstValueFrom, retry, throwError, timer } from 'rxjs';

const API = 'https://www.googleapis.com/drive/v3';
const SPACE = 'appDataFolder';
const FILE_FIELDS = 'id,name,description,appProperties,createdTime,modifiedTime';
const MAX_RETRIES = 4;

/** Espera base de los reintentos, en milisegundos (se duplica en cada intento). */
export const DRIVE_RETRY_BASE_MS = new InjectionToken<number>('DRIVE_RETRY_BASE_MS', {
  providedIn: 'root',
  factory: () => 1000,
});

/** Metadatos de un archivo de Drive tal y como los usa la aplicación. */
export interface DriveFile {
  id: string;
  name: string;
  description?: string;
  appProperties?: Record<string, string>;
  createdTime: string;
  modifiedTime: string;
}

/** Cambios de metadatos; una propiedad a `null` la elimina. */
export interface DriveFilePatch {
  name?: string;
  description?: string;
  appProperties?: Record<string, string | null>;
}

export interface DriveChange {
  fileId: string;
  removed: boolean;
  file?: DriveFile;
}

export interface DriveChanges {
  changes: DriveChange[];
  /** Token con el que pedir los cambios posteriores a estos. */
  nextToken: string;
}

interface FileList {
  nextPageToken?: string;
  files?: DriveFile[];
}

interface ChangeList {
  nextPageToken?: string;
  newStartPageToken?: string;
  changes?: DriveChange[];
}

/** Envoltorio fino de la API REST v3 de Drive, limitado a `appDataFolder`. */
@Injectable({ providedIn: 'root' })
export class DriveApi {
  private readonly http = inject(HttpClient);
  private readonly retryBaseMs = inject(DRIVE_RETRY_BASE_MS);

  /** Devuelve los metadatos de todos los archivos de la aplicación. */
  async listAll(): Promise<DriveFile[]> {
    const files: DriveFile[] = [];
    let pageToken: string | undefined;
    do {
      const page = await this.send(
        this.http.get<FileList>(`${API}/files`, {
          params: {
            spaces: SPACE,
            pageSize: 1000,
            fields: `nextPageToken,files(${FILE_FIELDS})`,
            ...(pageToken ? { pageToken } : {}),
          },
        }),
      );
      files.push(...(page.files ?? []));
      pageToken = page.nextPageToken;
    } while (pageToken);
    return files;
  }

  /** Crea un archivo sin contenido: todos sus datos van en los metadatos. */
  create(metadata: {
    name: string;
    description?: string;
    appProperties: Record<string, string>;
  }): Promise<DriveFile> {
    return this.send(
      this.http.post<DriveFile>(
        `${API}/files`,
        { ...metadata, parents: [SPACE] },
        { params: { fields: FILE_FIELDS } },
      ),
    );
  }

  /** Cambia metadatos. Drive fusiona `appProperties` clave a clave. */
  update(id: string, patch: DriveFilePatch): Promise<DriveFile> {
    return this.send(
      this.http.patch<DriveFile>(`${API}/files/${encodeURIComponent(id)}`, patch, {
        params: { fields: FILE_FIELDS },
      }),
    );
  }

  /** Borra definitivamente: `appDataFolder` no tiene papelera. */
  async delete(id: string): Promise<void> {
    await this.send(this.http.delete(`${API}/files/${encodeURIComponent(id)}`));
  }

  async startPageToken(): Promise<string> {
    const response = await this.send(
      this.http.get<{ startPageToken: string }>(`${API}/changes/startPageToken`),
    );
    return response.startPageToken;
  }

  /** Devuelve todos los cambios ocurridos desde `pageToken`. */
  async listChanges(pageToken: string): Promise<DriveChanges> {
    const changes: DriveChange[] = [];
    let token = pageToken;
    for (;;) {
      const page = await this.send(
        this.http.get<ChangeList>(`${API}/changes`, {
          params: {
            pageToken: token,
            spaces: SPACE,
            pageSize: 1000,
            fields: `nextPageToken,newStartPageToken,changes(fileId,removed,file(${FILE_FIELDS}))`,
          },
        }),
      );
      changes.push(...(page.changes ?? []));
      if (!page.nextPageToken) return { changes, nextToken: page.newStartPageToken ?? token };
      token = page.nextPageToken;
    }
  }

  /** Ejecuta la petición reintentando con espera exponencial los errores transitorios. */
  private send<T>(request: Observable<T>): Promise<T> {
    return firstValueFrom(
      request.pipe(
        retry({
          count: MAX_RETRIES,
          delay: (error: unknown, attempt) =>
            isTransient(error)
              ? timer(this.retryBaseMs * 2 ** (attempt - 1) + Math.random() * this.retryBaseMs)
              : throwError(() => error),
        }),
      ),
    );
  }
}

/** Errores que merece la pena reintentar: límites de cuota y fallos del servidor o de red. */
export function isTransient(error: unknown): boolean {
  if (!(error instanceof HttpErrorResponse)) return false;
  if (error.status === 0 || error.status === 429 || error.status >= 500) return true;
  if (error.status !== 403) return false;
  const reason = (error.error as { error?: { errors?: { reason?: string }[] } } | null)?.error
    ?.errors?.[0]?.reason;
  return reason === 'rateLimitExceeded' || reason === 'userRateLimitExceeded';
}
