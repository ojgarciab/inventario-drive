import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { DRIVE_RETRY_BASE_MS, DriveApi, isTransient } from './drive-api';

const FILES = 'https://www.googleapis.com/drive/v3/files';
const CHANGES = 'https://www.googleapis.com/drive/v3/changes';
const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
const file = (id: string) => ({ id, name: id, createdTime: '', modifiedTime: '' });

describe('DriveApi', () => {
  let api: DriveApi;
  let backend: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: DRIVE_RETRY_BASE_MS, useValue: 1 },
      ],
    });
    api = TestBed.inject(DriveApi);
    backend = TestBed.inject(HttpTestingController);
  });

  afterEach(() => backend.verify());

  it('lista todos los archivos de appDataFolder recorriendo las páginas', async () => {
    const result = api.listAll();
    const first = backend.expectOne((r) => r.url === FILES);
    expect(first.request.params.get('spaces')).toBe('appDataFolder');
    expect(first.request.params.get('pageSize')).toBe('1000');
    expect(first.request.params.has('pageToken')).toBe(false);
    first.flush({ nextPageToken: 'p2', files: [file('a')] });
    await tick();
    const second = backend.expectOne((r) => r.url === FILES);
    expect(second.request.params.get('pageToken')).toBe('p2');
    second.flush({ files: [file('b')] });
    expect((await result).map((f) => f.id)).toEqual(['a', 'b']);
  });

  it('crea archivos solo con metadatos dentro de appDataFolder', async () => {
    const result = api.create({ name: 'Caja', appProperties: { k: 'c' } });
    const req = backend.expectOne((r) => r.url === FILES && r.method === 'POST');
    expect(req.request.body).toEqual({
      name: 'Caja',
      appProperties: { k: 'c' },
      parents: ['appDataFolder'],
    });
    req.flush(file('nuevo'));
    expect((await result).id).toBe('nuevo');
  });

  it('actualiza con PATCH y borra con DELETE', async () => {
    const updated = api.update('id 1', { appProperties: { p: null } });
    const patch = backend.expectOne((r) => r.method === 'PATCH');
    expect(patch.request.url).toBe(`${FILES}/id%201`);
    expect(patch.request.body).toEqual({ appProperties: { p: null } });
    patch.flush(file('id 1'));
    await updated;

    const deleted = api.delete('x');
    backend.expectOne((r) => r.method === 'DELETE' && r.url === `${FILES}/x`).flush(null);
    await deleted;
  });

  it('reúne los cambios de todas las páginas y devuelve el token siguiente', async () => {
    const result = api.listChanges('t0');
    const first = backend.expectOne((r) => r.url === CHANGES);
    expect(first.request.params.get('pageToken')).toBe('t0');
    expect(first.request.params.get('spaces')).toBe('appDataFolder');
    first.flush({
      nextPageToken: 't1',
      changes: [{ fileId: 'a', removed: false, file: file('a') }],
    });
    await tick();
    backend
      .expectOne((r) => r.url === CHANGES && r.params.get('pageToken') === 't1')
      .flush({ newStartPageToken: 't9', changes: [{ fileId: 'b', removed: true }] });
    expect(await result).toEqual({
      changes: [
        { fileId: 'a', removed: false, file: file('a') },
        { fileId: 'b', removed: true },
      ],
      nextToken: 't9',
    });
  });

  it('reintenta los errores transitorios', async () => {
    const result = api.startPageToken();
    backend
      .expectOne(`${CHANGES}/startPageToken`)
      .flush(null, { status: 503, statusText: 'Unavailable' });
    await tick(10);
    backend.expectOne(`${CHANGES}/startPageToken`).flush({ startPageToken: 't1' });
    expect(await result).toBe('t1');
  });

  it('no reintenta los errores definitivos', async () => {
    const result = api.delete('x');
    backend.expectOne(`${FILES}/x`).flush(null, { status: 404, statusText: 'Not Found' });
    await expect(result).rejects.toMatchObject({ status: 404 });
  });

  it('distingue los errores transitorios de los definitivos', () => {
    const error = (status: number, reason?: string) =>
      new HttpErrorResponse({
        status,
        error: reason ? { error: { errors: [{ reason }] } } : null,
      });
    expect(isTransient(error(429))).toBe(true);
    expect(isTransient(error(500))).toBe(true);
    expect(isTransient(error(0))).toBe(true);
    expect(isTransient(error(403, 'userRateLimitExceeded'))).toBe(true);
    expect(isTransient(error(403, 'insufficientPermissions'))).toBe(false);
    expect(isTransient(error(401))).toBe(false);
    expect(isTransient(new Error('otro'))).toBe(false);
  });
});
