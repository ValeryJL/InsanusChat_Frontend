import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import zlib from 'node:zlib';

const FRONTEND_DIR = path.resolve(import.meta.dirname, '..');
const EXT_ROOT = path.join(FRONTEND_DIR, 'workstation-daemon', 'vscode_extension');
const DIST_VSIX_DIR = path.join(EXT_ROOT, 'dist');
const TAURI_RES_ROOT = path.join(FRONTEND_DIR, 'src-tauri', 'resources');

// ---------------------------------------------------------------------------
// Empaquetador ZIP/VSIX mínimo sin dependencias externas (OPC standard)
// ---------------------------------------------------------------------------
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) {
      c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
  }
  return (c ^ 0xffffffff) >>> 0;
}

function createZipBuffer(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name.replace(/\\/g, '/'), 'utf8');
    const compressed = zlib.deflateRawSync(data, { level: 6 });
    const crc = crc32(data);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(8, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(compressed.length, 18);
    localHeader.writeUInt32LE(data.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28);

    localParts.push(localHeader, nameBuf, compressed);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(8, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(compressed.length, 20);
    centralHeader.writeUInt32LE(data.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);

    centralParts.push(centralHeader, nameBuf);
    offset += localHeader.length + nameBuf.length + compressed.length;
  }

  const centralBuf = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralBuf, eocd]);
}

function walkFiles(dir, baseDir = dir) {
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      out.push(...walkFiles(full, baseDir));
    } else if (ent.isFile()) {
      out.push({
        rel: path.relative(baseDir, full).replace(/\\/g, '/'),
        full,
      });
    }
  }
  return out;
}

function escapeXml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildVsix(extDir) {
  const pkg = JSON.parse(fs.readFileSync(path.join(extDir, 'package.json'), 'utf8'));
  const files = walkFiles(extDir);

  const contentTypesXml = `<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension=".json" ContentType="application/json"/>
  <Default Extension=".js" ContentType="application/javascript"/>
  <Default Extension=".css" ContentType="text/css"/>
  <Default Extension=".svg" ContentType="image/svg+xml"/>
  <Default Extension=".md" ContentType="text/markdown"/>
  <Default Extension=".vsixmanifest" ContentType="text/xml"/>
</Types>`;

  const manifestXml = `<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011">
  <Metadata>
    <Identity Language="en-US" Id="${escapeXml(pkg.name)}" Version="${escapeXml(pkg.version)}" Publisher="${escapeXml(pkg.publisher)}" />
    <DisplayName>${escapeXml(pkg.displayName || pkg.name)}</DisplayName>
    <Description xml:space="preserve">${escapeXml(pkg.description || '')}</Description>
    <Categories>${escapeXml((pkg.categories || ['Other']).join(','))}</Categories>
  </Metadata>
  <Installation>
    <InstallationTarget Id="Microsoft.VisualStudio.Code"/>
  </Installation>
  <Dependencies/>
  <Assets>
    <Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true" />
  </Assets>
</PackageManifest>`;

  const entries = [
    { name: '[Content_Types].xml', data: Buffer.from(contentTypesXml, 'utf8') },
    { name: 'extension.vsixmanifest', data: Buffer.from(manifestXml, 'utf8') },
    ...files.map((f) => ({
      name: `extension/${f.rel}`,
      data: fs.readFileSync(f.full),
    })),
  ];

  fs.mkdirSync(DIST_VSIX_DIR, { recursive: true });
  const vsixName = `${pkg.publisher}.${pkg.name}-${pkg.version}.vsix`;
  const vsixPath = path.join(DIST_VSIX_DIR, vsixName);
  fs.writeFileSync(vsixPath, createZipBuffer(entries));
  console.log(`[build-vscode-extensions] VSIX OK -> ${vsixPath}`);
  return vsixPath;
}

function copyDir(src, dst) {
  fs.rmSync(dst, { recursive: true, force: true });
  fs.mkdirSync(dst, { recursive: true });
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, ent.name);
    const d = path.join(dst, ent.name);
    if (ent.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

const harnessDir = path.join(EXT_ROOT, 'insanuschat-harness');
const themeDir = path.join(EXT_ROOT, 'insanus-obsidian-theme');

if (!fs.existsSync(path.join(harnessDir, 'package.json'))) {
  console.log('[build-vscode-extensions] Entorno web sin workstation-daemon; omitiendo empaquetado VSIX.');
  process.exit(0);
}

console.log('[build-vscode-extensions] Compilando Webview React de insanuschat-harness...');
execSync('npx vite build --config vite.vscode-webview.config.ts', {
  cwd: FRONTEND_DIR,
  stdio: 'inherit',
});

buildVsix(harnessDir);
buildVsix(themeDir);

// Sincronizar en src-tauri/resources para que los instaladores Windows/Linux los incluyan
copyDir(harnessDir, path.join(TAURI_RES_ROOT, 'insanuschat-harness'));
copyDir(themeDir, path.join(TAURI_RES_ROOT, 'insanus-obsidian-theme'));
console.log('[build-vscode-extensions] Recursos copiados a src-tauri/resources/');
