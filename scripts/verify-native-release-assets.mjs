/**
 * ════════════════════════════════════════════════
 * FILE: scripts/verify-native-release-assets.mjs
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the native Vite output contains the exact release commit without
 *   depending on optional runner binaries.
 *
 * DEPENDS ON:
 *   Packages:  Node.js built-ins
 *   Internal:  vite.config.js
 *   Data:      reads  → dist/app-assets
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - The release SHA must be a complete lowercase Git commit identity.
 *   - Symlinks and non-file entries fail closed rather than escaping the
 *     generated asset tree.
 * ════════════════════════════════════════════════
 */
import {
  lstatSync,
  readFileSync,
  readdirSync,
} from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const RELEASE_SHA_PATTERN = /^[0-9a-f]{40}$/;

export function verifyNativeReleaseAssets({
  assetsDir = 'dist/app-assets',
  releaseSha,
} = {}) {
  if (!RELEASE_SHA_PATTERN.test(releaseSha || '')) {
    throw new Error('GITHUB_SHA must be a lowercase 40-character Git SHA');
  }

  const releaseBytes = Buffer.from(releaseSha, 'utf8');
  let fileCount = 0;
  let matched = false;

  function inspectDirectory(directoryPath) {
    const directoryStat = lstatSync(directoryPath);
    if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) {
      throw new Error('Native release asset root must be a real directory');
    }

    for (const entry of readdirSync(directoryPath, { withFileTypes: true })) {
      const entryPath = resolve(directoryPath, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error('Native release assets must not contain symlinks');
      }
      if (entry.isDirectory()) {
        inspectDirectory(entryPath);
        continue;
      }
      if (!entry.isFile()) {
        throw new Error('Native release assets contain an unsupported entry type');
      }

      fileCount += 1;
      if (readFileSync(entryPath).includes(releaseBytes)) matched = true;
    }
  }

  inspectDirectory(resolve(assetsDir));
  if (fileCount === 0) {
    throw new Error('Native release asset directory is empty');
  }
  if (!matched) {
    throw new Error('Native release assets do not contain the requested release SHA');
  }

  return { fileCount };
}

const isMain = process.argv[1]
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  try {
    verifyNativeReleaseAssets({ releaseSha: process.env.GITHUB_SHA });
    console.log('Verified native release identity in generated assets.');
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Native release verification failed');
    process.exitCode = 1;
  }
}
