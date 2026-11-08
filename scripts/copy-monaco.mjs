import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const srcVs = path.join(rootDir, 'node_modules', 'monaco-editor', 'min', 'vs');
const destVs = path.join(rootDir, 'dist', 'vs');

if (!fs.existsSync(srcVs)) {
  console.warn('[copy-monaco] Advertencia: no se encontró monaco-editor/min/vs en node_modules');
  process.exit(0);
}

fs.rmSync(destVs, { recursive: true, force: true });
fs.mkdirSync(path.dirname(destVs), { recursive: true });
fs.cpSync(srcVs, destVs, { recursive: true });
console.log(`[copy-monaco] Assets de Monaco copiados offline -> ${destVs}`);
