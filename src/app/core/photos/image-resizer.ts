import { InjectionToken } from '@angular/core';

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
