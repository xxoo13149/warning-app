import { rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const removablePaths = [
  'out',
  '.vite',
  'runtime_node_modules',
  '.tmp_zip_import',
  'node_modules/.vite',
  'coverage',
  '.cache',
  '.webpack',
];

const removePath = async (relativePath) => {
  const absolutePath = path.join(projectRoot, relativePath);
  await rm(absolutePath, { recursive: true, force: true });
  return absolutePath;
};

void (async () => {
  const removed = [];
  for (const relativePath of removablePaths) {
    removed.push(await removePath(relativePath));
  }

  console.log('[clean-generated-artifacts] removed:');
  removed.forEach((item) => {
    console.log(` - ${item}`);
  });
})().catch((error) => {
  console.error('[clean-generated-artifacts] failed:', error);
  process.exitCode = 1;
});
