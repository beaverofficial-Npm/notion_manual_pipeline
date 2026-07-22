import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const read = (relativePath) => readFile(path.join(root, relativePath), 'utf8');

const [taskRoute, reviewPage, conversionWorker, publishCore, publishPreview, treeRoute, pipelineTypes, dockerfile, migration] = await Promise.all([
  read('app/api/tasks/route.ts'),
  read('app/tasks/[taskId]/review/page.tsx'),
  read('scripts/worker/run-conversion-job.mjs'),
  read('scripts/worker/publish-core.mjs'),
  read('src/lib/notion/publish.ts'),
  read('app/api/tasks/[taskId]/tree/route.ts'),
  read('src/types/pipeline.ts'),
  read('Dockerfile'),
  read('supabase/migrations/008_retire_legacy_capture.sql'),
]);

assert.match(taskRoute, /conversion_mode:\s*'group_bake'/, 'task creation must pin the only conversion mode');
assert.doesNotMatch(taskRoute, /['"]capture['"]/, 'task API must not accept the legacy capture mode');

assert.match(reviewPage, /return <TaskReviewBake taskId=\{taskId\} \/>/, 'review must always use the fixed-capture UI');
assert.doesNotMatch(reviewPage, /TaskReviewGallery|conversion_mode/, 'review must not branch to the legacy UI');

assert.match(conversionWorker, /cropGroups\(localRender, \[boxCropRect\(FIXED_CAPTURE_BOX\)\]/, 'worker must always crop the measured fixed box');
assert.match(conversionWorker, /kind:\s*'group_bake'/, 'worker must only create baked assets');
assert.doesNotMatch(conversionWorker, /screenshotCandidates|conversionMode|kind:\s*'screenshot'/, 'worker must not retain a legacy conversion branch');

for (const [label, source] of [['publish worker', publishCore], ['publish preview', publishPreview], ['review tree', treeRoute]]) {
  assert.match(source, /\.eq\('kind', 'group_bake'\)/, `${label} must only read fixed-capture assets`);
  assert.doesNotMatch(source, /crop_box|cropRender|storeCroppedAsset/, `${label} must not fall back to render-time cropping`);
}

assert.doesNotMatch(dockerfile, /libreoffice|soffice/i, 'production image must not contain a legacy office renderer');
assert.match(pipelineTypes, /export type AssetKind = 'group_bake'/, 'runtime asset type must expose one asset kind');
assert.doesNotMatch(pipelineTypes, /'screenshot'|'qr'|'annotation'/, 'runtime types must not advertise legacy asset kinds');
assert.match(migration, /alter column conversion_mode set default 'group_bake'/, 'DB default must be fixed-capture');
assert.match(migration, /check \(conversion_mode = 'group_bake'\)/, 'DB must reject legacy conversion modes');

for (const relativePath of [
  'src/components/task-review-gallery.tsx',
  'src/lib/notion/assets.ts',
  'app/api/assets/[assetId]/route.ts',
  'app/api/slides/[slideId]/assets/route.ts',
  'app/api/tasks/[taskId]/slides/route.ts',
  'app/review-preview/page.tsx',
  'src/components/slide-review-preview.tsx',
]) {
  assert.equal(existsSync(path.join(root, relativePath)), false, `legacy runtime surface must be removed: ${relativePath}`);
}

console.log('Legacy capture retirement passed: one fixed-capture path remains from upload through publish.');
