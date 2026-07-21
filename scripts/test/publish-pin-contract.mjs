import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const read = (relativePath) => readFile(path.join(root, relativePath), 'utf8');
const [route, runner, core, schema] = await Promise.all([
  read('app/api/tasks/[taskId]/publish/route.ts'),
  read('scripts/worker/run-publish-job.mjs'),
  read('scripts/worker/publish-core.mjs'),
  read('supabase/schema.sql'),
]);

assert.match(route, /\.eq\('status', 'succeeded'\)/, 'publish route must pin a succeeded conversion job');
assert.match(route, /payload:\s*\{[^}]*conversionJobId:\s*conversionJob\.id[^}]*\}/s, 'conversionJobId must be persisted in existing JSONB payload');
assert.match(runner, /typeof run\.payload\?\.conversionJobId === 'string'/, 'worker must strictly validate payload.conversionJobId');
assert.match(runner, /conversionJobId,\s*\n\s*\}\);/, 'worker must pass the pinned id to publish core');
assert.match(core, /conversionJob\.task_id !== taskId/, 'publish core must reject a conversion job from another task');
assert.match(core, /conversionJob\.status !== 'succeeded'/, 'publish core must reject an unfinished conversion job');
assert.match(core, /\.eq\('job_id', conversionJobId\)/, 'slides/assets must be restricted to the pinned job');
assert.match(core, /\.in\('slide_id', chunk\)/, 'blocks/assets must be restricted to pinned slide ids');

for (const [label, source] of [['route', route], ['runner', runner], ['schema', schema]]) {
  assert.doesNotMatch(source, /conversion_job_id/, `${label} must not require an unapplied production column`);
}

console.log('Publish pin contract passed: JSONB pin is required and task-wide fallback is absent.');
