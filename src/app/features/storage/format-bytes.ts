const number = new Intl.NumberFormat('es', { maximumFractionDigits: 1 });
const percent = new Intl.NumberFormat('es', { style: 'percent', maximumFractionDigits: 2 });
const UNITS = ['B', 'kB', 'MB', 'GB', 'TB'];

/** Tamaño legible: «0 B», «812 kB», «12,4 MB». Usa múltiplos de 1024, como Drive. */
export function formatBytes(bytes: number): string {
  let value = Math.max(0, bytes);
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${number.format(value)}\u00a0${UNITS[unit]}`;
}

/** Proporción legible; lo que no llega a una centésima se indica como «menos del 0,01 %». */
export function formatPercent(ratio: number): string {
  if (ratio > 0 && ratio < 0.0001) return `menos del ${percent.format(0.0001)}`;
  return percent.format(ratio);
}
