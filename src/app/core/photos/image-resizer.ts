import { InjectionToken } from '@angular/core';
import { cleanRotation } from '../inventory/drive-mapping';

/** Lado mayor máximo de las fotografías guardadas, en píxeles. */
export const PHOTO_MAX_SIDE = 1600;
const JPEG_QUALITY = 0.8;

/** Convierte la imagen elegida por el usuario en el JPEG reducido que se guarda. */
export type ImageResizer = (image: Blob) => Promise<Blob>;

export const IMAGE_RESIZER = new InjectionToken<ImageResizer>('IMAGE_RESIZER', {
  providedIn: 'root',
  factory: () => resizeImage,
});

/** Tamaño resultante de ajustar una imagen al lado máximo, sin ampliarla nunca. */
export function fitWithin(width: number, height: number, maxSide: number) {
  const scale = Math.min(1, maxSide / Math.max(width, height));
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

async function resizeImage(image: Blob): Promise<Blob> {
  // `from-image` aplica la orientación EXIF: las fotos del móvil no salen giradas.
  const bitmap = await createImageBitmap(image, { imageOrientation: 'from-image' });
  try {
    const { width, height } = fitWithin(bitmap.width, bitmap.height, PHOTO_MAX_SIDE);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Sin contexto de dibujo');
    // Fondo blanco: el JPEG no tiene transparencia.
    context.fillStyle = '#fff';
    context.fillRect(0, 0, width, height);
    context.drawImage(bitmap, 0, 0, width, height);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('No se pudo codificar la imagen'))),
        'image/jpeg',
        JPEG_QUALITY,
      ),
    );
  } finally {
    bitmap.close();
  }
}

/**
 * Calidad de la versión girada que se genera para mostrar o exportar. El
 * archivo guardado en Drive es siempre el original, así que girar varias
 * veces no acumula pérdida.
 */
const ROTATED_JPEG_QUALITY = 0.92;

/** Gira una imagen en pasos de 90°: positivos a la derecha, negativos a la izquierda. */
export type ImageRotator = (image: Blob, quarterTurns: number) => Promise<Blob>;

export const IMAGE_ROTATOR = new InjectionToken<ImageRotator>('IMAGE_ROTATOR', {
  providedIn: 'root',
  factory: () => rotateImage,
});

async function rotateImage(image: Blob, quarterTurns: number): Promise<Blob> {
  const turns = cleanRotation(quarterTurns);
  const bitmap = await createImageBitmap(image);
  try {
    const sideways = turns % 2 === 1;
    const canvas = document.createElement('canvas');
    canvas.width = sideways ? bitmap.height : bitmap.width;
    canvas.height = sideways ? bitmap.width : bitmap.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Sin contexto de dibujo');
    context.translate(canvas.width / 2, canvas.height / 2);
    context.rotate((turns * Math.PI) / 2);
    context.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('No se pudo codificar la imagen'))),
        'image/jpeg',
        ROTATED_JPEG_QUALITY,
      ),
    );
  } finally {
    bitmap.close();
  }
}
