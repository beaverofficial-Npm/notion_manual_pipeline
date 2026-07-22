import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();

const forbiddenPaths = [
  'app/manual-builder',
  'app/api/manual-builder',
  'src/data/manual-builder',
  'src/lib/manual-builder',
  'src/types/manual-builder.ts',
  'src/components/manual-builder-workspace.tsx',
];

const requiredPaths = [
  'app/api/tasks/route.ts',
  'app/api/tasks/[taskId]/run/route.ts',
  'app/tasks/[taskId]/review/page.tsx',
  'app/api/tasks/[taskId]/publish/preview/route.ts',
  'app/api/tasks/[taskId]/publish/route.ts',
  'scripts/worker/run-conversion-job.mjs',
  'scripts/worker/poll-loop.mjs',
  'src/components/pipeline-dashboard.tsx',
  'src/components/task-review-bake.tsx',
  'src/lib/pipeline/tasks.ts',
  'supabase/schema.sql',
  'supabase/storage.sql',
  'docs/planning/PRD.md',
  'docs/planning/PIPELINE_SPEC.md',
  'docs/planning/TECHNICAL_DESIGN.md',
];

const forbiddenRuntimeTerms = [
  'manual-builder',
  'ManualBuilder',
  'storemgmt_anchor',
  'storemgmt_normalized',
  'getStoreMgmtManualBuilderDataset',
];

const runtimeRoots = ['app', 'src'];

function walk(dir) {
  if (!existsSync(dir)) return [];
  const entries = [];
  for (const name of readdirSync(dir)) {
    const fullPath = path.join(dir, name);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      entries.push(...walk(fullPath));
    } else if (/\.(ts|tsx|js|jsx|mjs|json)$/.test(name)) {
      entries.push(fullPath);
    }
  }
  return entries;
}

const failures = [];

for (const rel of forbiddenPaths) {
  if (existsSync(path.join(root, rel))) {
    failures.push(`Forbidden seed/manual-builder path exists: ${rel}`);
  }
}

for (const rel of requiredPaths) {
  if (!existsSync(path.join(root, rel))) {
    failures.push(`Required operational pipeline file is missing: ${rel}`);
  }
}

for (const runtimeRoot of runtimeRoots) {
  for (const filePath of walk(path.join(root, runtimeRoot))) {
    const rel = path.relative(root, filePath);
    const source = readFileSync(filePath, 'utf8');
    for (const term of forbiddenRuntimeTerms) {
      if (source.includes(term)) {
        failures.push(`Forbidden runtime reference "${term}" found in ${rel}`);
      }
    }
  }
}

if (failures.length > 0) {
  console.error('Requirements harness failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('Requirements harness passed: v1 pipeline assets are intact and seeded manual-builder runtime paths are blocked.');
