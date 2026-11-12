import { NAME_MAX_LENGTH, NOTES_MAX_LENGTH, InventoryError, InventoryErrorCode } from './models';

const MESSAGES: Record<InventoryErrorCode, string> = {
  name_required: 'Escriba un nombre.',
  name_too_long: `El nombre no puede superar los ${NAME_MAX_LENGTH} caracteres.`,
  notes_too_long: `Las notas no pueden superar los ${NOTES_MAX_LENGTH} caracteres.`,
  tags_too_long: 'Hay demasiadas etiquetas o son demasiado largas.',
  invalid_quantity: 'La cantidad debe ser un número entero mayor que cero.',
  not_found: 'Ese elemento ya no existe.',
  invalid_parent: 'El contenedor de destino ya no existe.',
  cycle: 'Un contenedor no puede estar dentro de sí mismo.',
  not_empty: 'El contenedor no está vacío.',
  offline: 'No hay conexión. Los cambios no se pueden guardar hasta recuperarla.',
};

/** Texto para el usuario a partir de un error al guardar en el inventario. */
export function inventoryErrorMessage(error: unknown): string {
  if (error instanceof InventoryError) return MESSAGES[error.code];
  return 'No se ha podido guardar en Google Drive. Compruebe la conexión e inténtelo de nuevo.';
}
