import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createClient } from '@supabase/supabase-js';
import { classifyRole, parseSlideShapes } from '../worker/ppt-parse.mjs';
import { isHiddenSlideXml } from '../worker/slide-visibility.mjs';

const execFileAsync = promisify(execFile);
const pptPath = process.argv[2];
const taskId = process.argv[3];
if (!pptPath || !taskId) throw new Error('사용법: audit-capture-coverage.mjs <pptx> <task-id>');

async function unzip(entry) {
  return (await execFileAsync('unzip', ['-p', pptPath, entry], { maxBuffer: 64 * 1024 * 1024 })).stdout;
}

const presentation = await unzip('ppt/presentation.xml');
const slideSize = {
  cx: Number(presentation.match(/<p:sldSz[^>]*cx="(\d+)"/)?.[1]),
  cy: Number(presentation.match(/<p:sldSz[^>]*cy="(\d+)"/)?.[1]),
};
const slideList = (await execFileAsync('unzip', ['-l', pptPath, 'ppt/slides/slide*.xml'], { maxBuffer: 16 * 1024 * 1024 })).stdout
  .split('\n')
  .map((line) => line.trim().split(/\s+/).at(-1) ?? '')
  .filter((entry) => /^ppt\/slides\/slide\d+\.xml$/.test(entry))
  .sort((left, right) => Number(left.match(/slide(\d+)/)[1]) - Number(right.match(/slide(\d+)/)[1]));

const eligible = [];
for (const entry of slideList) {
  const slideNumber = Number(entry.match(/slide(\d+)/)[1]);
  const xml = await unzip(entry);
  if (isHiddenSlideXml(xml)) continue;
  const parsed = parseSlideShapes(xml, slideSize);
  if (classifyRole(parsed, slideNumber) === 'content') eligible.push(slideNumber);
}

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const { data: slides, error: slideError } = await supabase
  .from('manual_slides')
  .select('id,slide_number,function_id')
  .eq('task_id', taskId);
if (slideError) throw slideError;
const slideNumberById = new Map(slides.map((slide) => [slide.id, slide.slide_number]));
const assetSlideNumbers = new Set();
for (let index = 0; index < slides.length; index += 100) {
  const ids = slides.slice(index, index + 100).map((slide) => slide.id);
  const { data: assets, error } = await supabase
    .from('manual_assets')
    .select('slide_id,kind')
    .in('slide_id', ids)
    .eq('kind', 'group_bake');
  if (error) throw error;
  for (const asset of assets) assetSlideNumbers.add(slideNumberById.get(asset.slide_id));
}

const eligibleSet = new Set(eligible);
const missing = eligible.filter((slideNumber) => !assetSlideNumbers.has(slideNumber));
const unexpected = [...assetSlideNumbers].filter((slideNumber) => !eligibleSet.has(slideNumber)).sort((a, b) => a - b);
const unassignedMissing = slides
  .filter((slide) => missing.includes(slide.slide_number) && !slide.function_id)
  .map((slide) => slide.slide_number)
  .sort((a, b) => a - b);

console.log(JSON.stringify({ eligibleCount: eligible.length, assetCount: assetSlideNumbers.size, missing, unexpected, unassignedMissing }, null, 2));
process.exitCode = missing.length || unexpected.length ? 1 : 0;
