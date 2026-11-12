#!/usr/bin/env bash
# Regenera los iconos de la aplicación a partir de los SVG de public/icons.
# Requiere Inkscape 1.x e ImageMagick. Ejecutar desde la raíz del repositorio.
set -euo pipefail
cd "$(dirname "$0")/../public"

render() { inkscape "icons/$1.svg" --export-width="$2" --export-height="$2" --export-filename="$3" >/dev/null 2>&1; }

for size in 192 512; do
  render icon "$size" "icons/icon-$size.png"
  render icon-maskable "$size" "icons/icon-maskable-$size.png"
done
# iOS recorta él mismo las esquinas: necesita el fondo a sangre.
render icon-maskable 180 icons/apple-touch-icon.png

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
for size in 16 32 48; do render icon "$size" "$tmp/$size.png"; done
convert "$tmp/16.png" "$tmp/32.png" "$tmp/48.png" favicon.ico
