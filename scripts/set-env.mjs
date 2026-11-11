// Genera src/environments/environment.ts a partir de variables de entorno.
// En local las lee de un archivo .env (no versionado); en CI, de las variables
// del repositorio. Ningún valor es secreto: todo acaba en el JavaScript público.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const raiz = fileURLToPath(new URL('..', import.meta.url));

function leerEnv() {
  const ruta = `${raiz}.env`;
  if (!existsSync(ruta)) return {};
  const valores = {};
  for (const linea of readFileSync(ruta, 'utf8').split(/\r?\n/)) {
    const m = linea.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) valores[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return valores;
}

const googleClientId = (process.env.GOOGLE_CLIENT_ID || leerEnv().GOOGLE_CLIENT_ID || '').trim();

if (!googleClientId) {
  console.warn('[set-env] GOOGLE_CLIENT_ID no está definido: el inicio de sesión no funcionará.');
} else if (!/^[\w-]+\.apps\.googleusercontent\.com$/.test(googleClientId)) {
  console.error('[set-env] GOOGLE_CLIENT_ID no tiene formato de identificador de cliente OAuth.');
  process.exit(1);
}

const contenido = `// Archivo generado por scripts/set-env.mjs. No editar ni versionar.
export const environment = {
  googleClientId: ${JSON.stringify(googleClientId)},
};
`;

mkdirSync(`${raiz}src/environments`, { recursive: true });
writeFileSync(`${raiz}src/environments/environment.ts`, contenido);
console.log(
  `[set-env] src/environments/environment.ts generado (${googleClientId ? 'con' : 'sin'} identificador de cliente).`,
);
