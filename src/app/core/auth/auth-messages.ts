import { AuthError } from './auth-service';

const MESSAGES: Record<string, string> = {
  popup_closed: 'Se cerró la ventana de Google antes de terminar.',
  popup_failed_to_open:
    'El navegador ha bloqueado la ventana de Google. Permita las ventanas emergentes para este sitio.',
  access_denied: 'No se concedió el permiso. Sin él la aplicación no puede guardar el inventario.',
  scope_not_granted:
    'No se concedió el permiso. Sin él la aplicación no puede guardar el inventario.',
  redirect_failed:
    'No se ha podido completar el inicio de sesión por redirección. Pruebe con la ventana emergente.',
  interaction_required: 'Google necesita que confirme la cuenta. Pulse para continuar.',
  login_required: 'Google necesita que vuelva a identificarse. Pulse para continuar.',
  consent_required: 'Google necesita que confirme el permiso. Pulse para continuar.',
  not_configured: 'La aplicación no tiene configurado el identificador de cliente de Google.',
  gis_unavailable: 'No se ha podido cargar el inicio de sesión de Google. Compruebe la conexión.',
  no_profile: 'No se han podido leer los datos de la cuenta.',
};

/** Texto para el usuario a partir de un error de inicio de sesión. */
export function authErrorMessage(error: unknown): string {
  if (typeof error === 'string') error = new AuthError(error);
  if (error instanceof AuthError && MESSAGES[error.code]) return MESSAGES[error.code];
  return 'No se ha podido iniciar sesión. Inténtelo de nuevo.';
}
