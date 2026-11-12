import { InjectionToken } from '@angular/core';

/** Entrega un archivo generado en el navegador para que el usuario lo guarde. */
export type Downloader = (content: Blob, fileName: string) => void;

export const DOWNLOADER = new InjectionToken<Downloader>('DOWNLOADER', {
  providedIn: 'root',
  factory: () => downloadBlob,
});

function downloadBlob(content: Blob, fileName: string): void {
  const url = URL.createObjectURL(content);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Se libera más tarde: el navegador necesita la dirección para iniciar la descarga.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
