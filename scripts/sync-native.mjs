import { existsSync } from 'node:fs';
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const sourceRoot = path.resolve(scriptDir, '..');

const targetCandidates = [
  process.env.MORO_NATIVE_REPO,
  path.resolve(sourceRoot, '..', '..', 'moro-native'),
  path.resolve(sourceRoot, '..', 'moro-native'),
].filter(Boolean);

const sharedPaths = [
  '.gitignore',
  'api',
  'apps',
  'cloudflare',
  'components',
  'context',
  'docs',
  'hooks',
  'icons',
  'netlify',
  'pics',
  'pixelroom',
  'public',
  'scripts',
  'server',
  'utils',
  'worker',
  'A6581845961B07B58DA1E1E88DA367F3.jpg',
  'AGENTS.md',
  'App.tsx',
  'CLAUDE.md',
  'constants.tsx',
  'index.html',
  'index.tsx',
  'LICENSE',
  'metadata.json',
  'moro-update.json',
  'netlify.toml',
  'open-local-web.bat',
  'build-and-open-local-web.bat',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'progress.md',
  'test-setup.ts',
  'tsconfig.json',
  'types.ts',
  'vercel.json',
  'vite-env.d.ts',
  'vitest.config.ts',
];

const protectedTargetPaths = new Set([
  '.git',
  '.github',
  '.codex',
  '.hermes',
  '.agents',
  'android',
  'ios',
  'dist',
  'dist-native',
  'dist-web',
  'node_modules',
  'notes',
  'release',
  'tmp_ocr_img1.txt',
  'tmp_ocr_img2.txt',
  'tmp_ocr_chunks',
  'capacitor.config.ts',
  'package.json',
  'README.md',
  'vite.config.ts',
]);

const ignoredNames = new Set([
  '.DS_Store',
  'Thumbs.db',
  'moro-debug.apk',
]);

const ignoredSegments = new Set([
  '.git',
  'dist',
  'dist-native',
  'dist-web',
  'node_modules',
  'release',
]);

function findNativeRoot() {
  for (const candidate of targetCandidates) {
    const resolved = path.resolve(candidate);
    if (
      resolved !== sourceRoot
      && existsSync(path.join(resolved, '.git'))
      && existsSync(path.join(resolved, 'capacitor.config.ts'))
    ) {
      return resolved;
    }
  }
  return null;
}

function assertInside(root, target) {
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Refusing to touch path outside native repo: ${target}`);
  }
}

async function copySharedPath(nativeRoot, relativePath) {
  if (protectedTargetPaths.has(relativePath)) {
    throw new Error(`Internal error: protected path listed for sync: ${relativePath}`);
  }

  const sourcePath = path.join(sourceRoot, relativePath);
  if (!existsSync(sourcePath)) return { relativePath, status: 'missing' };

  const targetPath = path.join(nativeRoot, relativePath);
  assertInside(nativeRoot, targetPath);
  await rm(targetPath, { recursive: true, force: true });
  await mkdir(path.dirname(targetPath), { recursive: true });
  await cp(sourcePath, targetPath, {
    recursive: true,
    force: true,
    filter(source) {
      const name = path.basename(source);
      if (ignoredNames.has(name)) return false;
      const sourceRelative = path.relative(sourceRoot, source);
      const segments = sourceRelative.split(path.sep);
      if (segments.some((segment) => ignoredSegments.has(segment))) return false;
      return true;
    },
  });

  return { relativePath, status: 'synced' };
}

async function syncPackageJson(nativeRoot) {
  const sourcePackagePath = path.join(sourceRoot, 'package.json');
  const nativePackagePath = path.join(nativeRoot, 'package.json');
  const sourcePackage = JSON.parse(await readFile(sourcePackagePath, 'utf8'));
  const nativePackage = JSON.parse(await readFile(nativePackagePath, 'utf8'));

  const nextPackage = {
    ...nativePackage,
    name: nativePackage.name || sourcePackage.name,
    version: sourcePackage.version,
    type: sourcePackage.type,
    license: sourcePackage.license,
    dependencies: {
      ...(nativePackage.dependencies || {}),
      ...(sourcePackage.dependencies || {}),
    },
    devDependencies: {
      ...(nativePackage.devDependencies || {}),
      ...(sourcePackage.devDependencies || {}),
    },
  };

  await writeFile(nativePackagePath, `${JSON.stringify(nextPackage, null, 2)}\n`, 'utf8');
  return { relativePath: 'package.json', status: 'merged' };
}

async function warnAboutUnsyncedTopLevel() {
  const entries = await readdir(sourceRoot);
  const known = new Set([...sharedPaths, ...protectedTargetPaths, 'package.json', 'README.md', 'vite.config.ts', 'capacitor.config.ts']);
  const maybeNewShared = [];

  for (const entry of entries) {
    if (known.has(entry)) continue;
    if (ignoredNames.has(entry)) continue;
    if (entry.startsWith('.codex-vite') || entry.startsWith('tmp-')) continue;
    const entryStat = await stat(path.join(sourceRoot, entry));
    if (entryStat.isDirectory() || entryStat.isFile()) maybeNewShared.push(entry);
  }

  if (maybeNewShared.length) {
    console.log(`Skipped unclassified top-level paths: ${maybeNewShared.join(', ')}`);
  }
}

const nativeRoot = findNativeRoot();
if (!nativeRoot) {
  console.error('Cannot find moro-native. Set MORO_NATIVE_REPO to the native repository path.');
  process.exit(1);
}

console.log(`Syncing shared Moro files`);
console.log(`from: ${sourceRoot}`);
console.log(`to:   ${nativeRoot}`);

const results = [];
for (const relativePath of sharedPaths) {
  results.push(await copySharedPath(nativeRoot, relativePath));
}
results.push(await syncPackageJson(nativeRoot));
await warnAboutUnsyncedTopLevel();

const synced = results.filter((item) => item.status === 'synced').map((item) => item.relativePath);
const merged = results.filter((item) => item.status === 'merged').map((item) => item.relativePath);
const missing = results.filter((item) => item.status === 'missing').map((item) => item.relativePath);

console.log(`Synced ${synced.length} shared paths.`);
if (merged.length) console.log(`Merged native-local files: ${merged.join(', ')}`);
if (missing.length) console.log(`Missing in web repo, skipped: ${missing.join(', ')}`);
console.log('Native-only paths were left alone: android, ios, capacitor.config.ts, vite.config.ts, README.md, package scripts.');
