/**
 * Copy the CommonJS asset-provider adapters into the build.
 *
 * `tsc` only emits TypeScript, so the eighteen provider modules under
 * `services/assetSources` — deliberately plain CommonJS, because each one is a
 * small adapter that gets rewritten whenever an upstream API moves — would be
 * missing from `dist` and the server would fail to start in production. This
 * copies them alongside the compiled output, preserving the directory shape
 * the registry's `createRequire` resolves against.
 */
import { cp, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const from = path.join(here, '..', 'src', 'services', 'assetSources');
const to = path.join(here, '..', 'dist', 'services', 'assetSources');

await mkdir(to, { recursive: true });
await cp(from, to, {
  recursive: true,
  filter: (source) => !source.endsWith('.ts'),
});

console.log(`[novira-api] copied provider adapters → ${path.relative(process.cwd(), to)}`);
