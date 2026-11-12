import { HttpErrorResponse, HttpInterceptorFn, HttpRequest } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, from, switchMap, throwError } from 'rxjs';
import { AuthService } from './auth-service';

const GOOGLE_APIS = 'https://www.googleapis.com/';

/**
 * Añade el token de acceso a las llamadas a las API de Google. Si la API
 * responde 401, renueva el token en silencio y reintenta una sola vez.
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  if (!req.url.startsWith(GOOGLE_APIS) || req.headers.has('Authorization')) {
    return next(req);
  }
  const auth = inject(AuthService);
  const send = (token: string) => next(withToken(req, token));

  return from(auth.validToken()).pipe(
    switchMap(send),
    catchError((error: unknown) =>
      error instanceof HttpErrorResponse && error.status === 401
        ? from(auth.renew()).pipe(switchMap(send))
        : throwError(() => error),
    ),
  );
};

function withToken(req: HttpRequest<unknown>, token: string): HttpRequest<unknown> {
  return req.clone({ setHeaders: { Authorization: `Bearer ${token}` } });
}
