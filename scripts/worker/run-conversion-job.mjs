import { createClient } from '@supabase/supabase-js';
import { execFile } from 'node:child_process';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  buildFunctionBlocks,
  classifyRole,
  extractContentFunctionName,
  extractSection,
  normalizeName,
  parseSlideShapes,
  screenshotCandidates,
} from './ppt-parse.mjs';
import { parseGroupBoxes, parseImageBoxes, expandBoxWithPics, cropGroups } from './group-bake.mjs';

const execFileAsync = promisify(execFile);
const repoRoot = process.cwd();
const tmpRoot = path.join(repoRoot, '.tmp', 'worker');
const soffice = process.env.SOFFICE_BIN ?? '/opt/homebrew/bin/soffice';
const pdftoppm = process.env.PDFTOPPM_BIN ?? '/opt/homebrew/bin/pdftoppm';
const pdfinfo = process.env.PDFINFO_BIN ?? 'pdfinfo';
const SOURCE_BUCKET = 'manual-source';
const RENDER_BUCKET = 'manual-renders';
const MANIFEST_BUCKET = 'manual-manifests';
const ASSETS_BUCKET = 'manual-assets';

async function loadLocalEnv() {
  try {
    const envText = await readFile(path.join(repoRoot, '.env'), 'utf8');
    for (const line of envText.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const equalIndex = trimmed.indexOf('=');
      if (equalIndex === -1) continue;
      const key = trimmed.slice(0, equalIndex).trim();
      const value = trimmed.slice(equalIndex + 1).trim();
      if (key && !process.env[key]) process.env[key] = value;
    }
  } catch {
    // Vercel/worker 환경은 env 를 직접 주입한다.
  }
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is missing.`);
  return value;
}

await loadLocalEnv();

const supabase = createClient(requireEnv('NEXT_PUBLIC_SUPABASE_URL'), requireEnv('SUPABASE_SERVICE_ROLE_KEY'), {
  auth: { persistSession: false },
});

function firstNumber(source, pattern) {
  const match = source.match(pattern);
  return match ? Number(match[1]) : 0;
}

async function unzipText(pptPath, entry) {
  const { stdout } = await execFileAsync('unzip', ['-p', pptPath, entry], { maxBuffer: 1024 * 1024 * 16 });
  return stdout;
}

async function unzipSlideList(pptPath) {
  const { stdout } = await execFileAsync('unzip', ['-l', pptPath, 'ppt/slides/slide*.xml'], { maxBuffer: 1024 * 1024 * 8 });
  return stdout
    .split('\n')
    .map((line) => line.trim().split(/\s+/).at(-1) ?? '')
    .filter((entry) => /^ppt\/slides\/slide\d+\.xml$/.test(entry))
    .sort((a, b) => Number(a.match(/slide(\d+)/)[1]) - Number(b.match(/slide(\d+)/)[1]));
}

async function resolveJob(jobIdArg) {
  const columns = 'id,task_id,source_file_id,run_number,status';
  if (jobIdArg) {
    const { data, error } = await supabase.from('manual_conversion_jobs').select(columns).eq('id', jobIdArg).single();
    if (error || !data) throw new Error(error?.message ?? `Job not found: ${jobIdArg}`);
    return data;
  }
  const { data, error } = await supabase
    .from('manual_conversion_jobs')
    .select(columns)
    .eq('status', 'queued')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error('No queued job.');
  return data;
}

async function downloadSource(sourceFile, tmpDir) {
  const { data, error } = await supabase.storage.from(SOURCE_BUCKET).download(sourceFile.storage_path);
  if (error || !data) throw new Error(error?.message ?? 'Source download failed.');
  const filePath = path.join(tmpDir, sourceFile.file_name);
  await writeFile(filePath, Buffer.from(await data.arrayBuffer()));
  return filePath;
}

function parsePositiveInt(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function formatExecError(error, context) {
  const parts = [context];
  if (error?.message) parts.push(String(error.message).trim());
  if (error?.signal) parts.push(`signal=${error.signal}`);
  if (typeof error?.killed === 'boolean') parts.push(`killed=${error.killed}`);
  if (error?.stderr) parts.push(`stderr=${String(error.stderr).trim().slice(0, 2000)}`);
  if (error?.stdout) parts.push(`stdout=${String(error.stdout).trim().slice(0, 1000)}`);
  return parts.filter(Boolean).join('\n');
}

async function countPdfPages(pdfPath) {
  const { stdout } = await execFileAsync(pdfinfo, [pdfPath], {
    maxBuffer: 1024 * 1024,
    timeout: Number(process.env.PDFINFO_TIMEOUT_MS ?? 30000),
    killSignal: 'SIGKILL',
  });
  const match = stdout.match(/^Pages:\s+(\d+)/m);
  if (!match) throw new Error(`PDF page count not found: ${pdfPath}`);
  return Number(match[1]);
}

async function renderPdfRange({ pdfPath, tmpDir, renderDpi, from, to, chunkIndex }) {
  const chunkLabel = String(chunkIndex).padStart(4, '0');
  const outputPrefix = path.join(tmpDir, `slide-chunk-${chunkLabel}`);

  try {
    await execFileAsync(pdftoppm, ['-png', '-r', renderDpi, '-f', String(from), '-l', String(to), pdfPath, outputPrefix], {
      maxBuffer: 1024 * 1024 * 16,
      timeout: Number(process.env.PDFTOPPM_CHUNK_TIMEOUT_MS ?? process.env.PDFTOPPM_TIMEOUT_MS ?? 180000),
      killSignal: 'SIGKILL',
    });
  } catch (error) {
    throw new Error(formatExecError(error, `pdftoppm failed while rendering pages ${from}-${to}`));
  }

  return (await readdir(tmpDir))
    .filter((file) => file.startsWith(`slide-chunk-${chunkLabel}-`) && file.endsWith('.png'))
    .map((file) => {
      const page = Number(file.match(/-(\d+)\.png$/)?.[1] ?? 0);
      return { page, path: path.join(tmpDir, file) };
    })
    .filter((item) => item.page >= from && item.page <= to)
    .sort((a, b) => a.page - b.page);
}

async function renderSlides(pptPath, tmpDir) {
  // 고유 프로필 디렉터리(-env:UserInstallation)로 headless soffice 락/행을 방지하고, 타임아웃을 둔다.
  const profile = `file://${path.join(tmpDir, 'loprofile')}`;
  try {
    await execFileAsync(
      soffice,
      [`-env:UserInstallation=${profile}`, '--headless', '--norestore', '--convert-to', 'pdf', '--outdir', tmpDir, pptPath],
      { maxBuffer: 1024 * 1024 * 16, timeout: Number(process.env.SOFFICE_TIMEOUT_MS ?? 180000), killSignal: 'SIGKILL' },
    );
  } catch (error) {
    throw new Error(formatExecError(error, 'LibreOffice PDF conversion failed'));
  }
  const pdfName = (await readdir(tmpDir)).find((file) => file.toLowerCase().endsWith('.pdf'));
  if (!pdfName) throw new Error('PDF conversion failed.');
  const pdfPath = path.join(tmpDir, pdfName);
  const renderDpi = process.env.RENDER_DPI ?? '300';
  const pageCount = await countPdfPages(pdfPath);
  const chunkSize = parsePositiveInt(process.env.PDFTOPPM_CHUNK_SIZE, 20);
  const renderedByPage = new Map();

  for (let from = 1, chunkIndex = 1; from <= pageCount; from += chunkSize, chunkIndex += 1) {
    const to = Math.min(pageCount, from + chunkSize - 1);
    const chunkFiles = await renderPdfRange({ pdfPath, tmpDir, renderDpi, from, to, chunkIndex });

    for (const item of chunkFiles) {
      renderedByPage.set(item.page, item.path);
    }

    const missing = [];
    for (let page = from; page <= to; page += 1) {
      if (!renderedByPage.has(page)) missing.push(page);
    }
    if (missing.length > 0) {
      throw new Error(`pdftoppm rendered pages ${from}-${to}, but missing output for pages: ${missing.join(', ')}`);
    }
  }

  return Array.from({ length: pageCount }, (_, index) => renderedByPage.get(index + 1)).filter(Boolean);
}

async function uploadFile(bucket, storagePath, filePath, contentType) {
  const { error } = await supabase.storage.from(bucket).upload(storagePath, await readFile(filePath), {
    contentType,
    upsert: true,
  });
  if (error) throw new Error(error.message);
}

// 슬라이드 순회로 카테고리/기능 트리를 만들고 본문 슬라이드를 기능에 매단다.
export function buildHierarchy(slides) {
  const categories = [];
  let currentCategory = null;
  const functionByKey = new Map(); // categoryIndex::nameNorm -> function

  function distance(a, b) {
    const prev = Array.from({ length: b.length + 1 }, (_, index) => index);
    const curr = Array.from({ length: b.length + 1 }, () => 0);
    for (let i = 1; i <= a.length; i += 1) {
      curr[0] = i;
      for (let j = 1; j <= b.length; j += 1) {
        curr[j] = Math.min(
          prev[j] + 1,
          curr[j - 1] + 1,
          prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
        );
      }
      for (let j = 0; j <= b.length; j += 1) prev[j] = curr[j];
    }
    return prev[b.length];
  }

  function fuzzyMatch(functions, name) {
    const target = normalizeName(name);
    if (!target) return null;

    const exact = functions.find((fn) => normalizeName(fn.title) === target);
    if (exact) return exact;

    if (target.length < 4) return null;
    let best = null;
    for (const fn of functions) {
      const candidate = normalizeName(fn.title);
      if (candidate.length < 4) continue;
      const delta = distance(candidate, target);
      const threshold = Math.max(candidate.length, target.length) >= 8 ? 2 : 1;
      if (delta <= threshold && (!best || delta < best.delta)) best = { fn, delta };
    }
    return best?.fn ?? null;
  }

  function ensureFunction(categoryIndex, category, title) {
    const key = `${categoryIndex}::${normalizeName(title)}`;
    const matched = fuzzyMatch(category.functions, title);
    if (matched) {
      functionByKey.set(key, matched);
      return matched;
    }
    const fn = { sort_order: category.functions.length, title, slides: [] };
    category.functions.push(fn);
    functionByKey.set(key, fn);
    return fn;
  }

  // 각 슬라이드 위치에서 "바로 다음(중간에 다른 섹션이 없는) 섹션 표지"의 카테고리명(정규화)을 미리 구한다.
  // content 슬라이드의 기능명이 이 값과 같으면, 그 슬라이드는 다가오는 섹션의 인트로(개요) 페이지로 본다.
  // (멀리 떨어진 동명 섹션과는 매칭되지 않으므로 서로 다른 매뉴얼의 같은 토픽을 잘못 합치지 않는다.)
  const nextSectionNorm = new Array(slides.length).fill(null);
  for (let i = slides.length - 1, pending = null; i >= 0; i -= 1) {
    if (slides[i].role === 'section') pending = normalizeName(slides[i].section?.categoryTitle ?? '');
    nextSectionNorm[i] = pending;
  }
  // 섹션이 생성되기 전에 먼저 등장한 인트로 슬라이드를 보류했다가, 그 섹션이 생기면 합친다.
  const pendingIntro = new Map(); // categoryNorm -> [{ name, slide }]

  function attachToCategory(category, name, slide) {
    const idx = categories.indexOf(category);
    const key = `${idx}::${normalizeName(name)}`;
    const fn = functionByKey.get(key) ?? ensureFunction(idx, category, name);
    fn.slides.push(slide);
  }

  for (let i = 0; i < slides.length; i += 1) {
    const slide = slides[i];
    if (slide.role === 'cover' || slide.role === 'toc') continue;

    if (slide.role === 'section') {
      const { categoryTitle, functionTitles } = slide.section;
      currentCategory = { sort_order: categories.length, title: categoryTitle, source: 'section', functions: [] };
      categories.push(currentCategory);
      const categoryIndex = categories.length - 1;
      // 이 섹션을 기다리던 인트로 슬라이드를 먼저 합친다(맨 위 순서로).
      const waiting = pendingIntro.get(normalizeName(categoryTitle));
      if (waiting) {
        for (const item of waiting) attachToCategory(currentCategory, item.name, item.slide);
        pendingIntro.delete(normalizeName(categoryTitle));
      }
      for (const title of functionTitles) {
        ensureFunction(categoryIndex, currentCategory, title);
      }
      continue;
    }

    // content
    const name = slide.functionName || `슬라이드 ${slide.slide_number}`;
    const targetNorm = nextSectionNorm[i];
    // 기능명이 바로 다음 섹션 제목과 같으면 = 그 섹션의 인트로(개요). 그 섹션 카테고리로 합쳐 중복 헤딩을 없앤다.
    if (targetNorm && normalizeName(name) === targetNorm) {
      const existing = categories.find((c) => normalizeName(c.title) === targetNorm);
      if (existing) {
        attachToCategory(existing, name, slide);
      } else {
        const list = pendingIntro.get(targetNorm) ?? [];
        list.push({ name, slide });
        pendingIntro.set(targetNorm, list);
      }
      continue;
    }

    if (!currentCategory) {
      currentCategory = { sort_order: categories.length, title: '기본', source: 'manual', functions: [] };
      categories.push(currentCategory);
    }
    attachToCategory(currentCategory, name, slide);
  }

  // 끝까지 매칭 섹션이 안 나타난 보류분은 유실 방지를 위해 첫 카테고리(없으면 '기본')에 붙인다.
  if (pendingIntro.size) {
    if (!categories.length) {
      currentCategory = { sort_order: 0, title: '기본', source: 'manual', functions: [] };
      categories.push(currentCategory);
    }
    for (const list of pendingIntro.values()) {
      for (const item of list) attachToCategory(categories[0], item.name, item.slide);
    }
    pendingIntro.clear();
  }

  return categories
    .map((category) => ({
      ...category,
      functions: category.functions.filter((fn) => fn.slides.length > 0),
    }))
    .filter((category) => category.functions.length > 0);
}

export async function runOnce(jobIdArg) {
  const job = await resolveJob(jobIdArg);
  const tmpDir = path.join(tmpRoot, job.id);
  await rm(tmpDir, { recursive: true, force: true });
  await mkdir(tmpDir, { recursive: true });

  await supabase
    .from('manual_conversion_jobs')
    .update({ status: 'running', worker_id: 'local-worker', started_at: new Date().toISOString(), error_message: null })
    .eq('id', job.id);

  try {
    const { data: sourceFile, error: sourceError } = await supabase
      .from('manual_source_files')
      .select('id,task_id,file_name,storage_path')
      .eq('id', job.source_file_id)
      .single();
    if (sourceError || !sourceFile) throw new Error(sourceError?.message ?? 'Source file not found.');

    // task의 conversion_mode 조회 (기본값: 'capture')
    const { data: task, error: taskError } = await supabase
      .from('manual_tasks')
      .select('conversion_mode')
      .eq('id', sourceFile.task_id)
      .single();
    if (taskError || !task) throw new Error(taskError?.message ?? 'Task not found.');
    const conversionMode = task.conversion_mode ?? 'capture';

    const pptPath = await downloadSource(sourceFile, tmpDir);
    const [presentationXml, slideEntries, renderedSlides] = await Promise.all([
      unzipText(pptPath, 'ppt/presentation.xml'),
      unzipSlideList(pptPath),
      renderSlides(pptPath, tmpDir),
    ]);

    const slideSize = {
      cx: firstNumber(presentationXml, /<p:sldSz[^>]*cx="(\d+)"/),
      cy: firstNumber(presentationXml, /<p:sldSz[^>]*cy="(\d+)"/),
    };

    // 슬라이드 → 레이아웃 XML (이미지 박스가 slideLayout 에 있는 v2 덱 지원). 레이아웃은 캐시.
    const layoutXmlCache = new Map();
    async function layoutXmlFor(slideEntry) {
      try {
        const relsEntry = slideEntry.replace(/slides\/(slide\d+\.xml)$/, 'slides/_rels/$1.rels');
        const rels = await unzipText(pptPath, relsEntry);
        const target = rels.match(/Target="[^"]*slideLayouts\/([^"]+)"/)?.[1];
        if (!target) return null;
        const layoutEntry = `ppt/slideLayouts/${target}`;
        if (!layoutXmlCache.has(layoutEntry)) layoutXmlCache.set(layoutEntry, await unzipText(pptPath, layoutEntry));
        return layoutXmlCache.get(layoutEntry);
      } catch {
        return null;
      }
    }

    // 1차 파싱: 슬라이드별 역할/섹션/기능명/블록/이미지 후보
    // conversionMode에 따라 이미지 처리 방식 결정 (capture: 기존 동작 / group_bake: 이미지박스→그룹→영역 베이킹)
    const parsedSlides = [];
    for (const entry of slideEntries) {
      const slideNumber = Number(entry.match(/slide(\d+)/)[1]);
      const slideXml = await unzipText(pptPath, entry);
      const parsed = parseSlideShapes(slideXml, slideSize);
      const role = classifyRole(parsed, slideNumber);
      const section = role === 'section' ? extractSection(parsed) : null;
      const functionName = role === 'content' ? extractContentFunctionName(parsed) : null;
      const title =
        section?.categoryTitle ??
        functionName ??
        parsed.shapes.find((s) => !s.isGroupLabel)?.text ??
        `슬라이드 ${slideNumber}`;

      let screenshots = [];
      if (role === 'content') {
        if (conversionMode === 'group_bake') {
          const localRender = renderedSlides[slideNumber - 1];
          const hasRealPics = parsed.pics.some((p) => p.areaRatio >= 0.005);

          // 1순위: 이미지 박스(슬라이드/레이아웃의 이미지 컨테이너) 기준 크롭.
          //        빈 박스를 굽지 않도록 실제 이미지가 있는 슬라이드에서만 쓰고,
          //        박스 밖으로 살짝 넘친 이미지(우측 갤러리·하단 내비 등)는 합집합으로 포함해 잘림을 막는다.
          let boxes = hasRealPics ? parseImageBoxes(slideXml, await layoutXmlFor(entry), slideSize) : [];
          boxes = boxes.map((b) => expandBoxWithPics(b, parsed.pics));
          let labelOf = (i) => `이미지 박스${boxes.length > 1 ? ` ${i + 1}` : ''}`;

          // 2순위: 그룹(grpSp) bbox — 이미지 박스가 없는 덱의 기존 동작.
          if (!boxes.length) {
            boxes = parseGroupBoxes(slideXml, slideSize);
            labelOf = (i) => `Group ${i + 1}`;
          }

          // 3순위: 스크린샷 후보 영역(휴리스틱) — 그룹조차 없는 슬라이드(단독 이미지 등).
          let zones = null;
          if (!boxes.length) {
            zones = screenshotCandidates(parsed);
            boxes = zones.map((z) => ({
              xFrac: z.bbox.left / 100,
              yFrac: z.bbox.top / 100,
              wFrac: z.bbox.width / 100,
              hFrac: z.bbox.height / 100,
            }));
            labelOf = (i) => zones[i]?.label ?? `이미지 영역 ${i + 1}`;
          }

          if (boxes.length > 0 && localRender) {
            const croppedPaths = await cropGroups(localRender, boxes, tmpDir, slideNumber);
            screenshots = croppedPaths.map((croppedPath, index) => ({
              label: labelOf(index),
              bbox: null, // 구워진 이미지라 crop_box 불필요
              confidence: zones ? zones[index]?.confidence ?? 0.8 : 0.95,
              imagePath: croppedPath, // 임시 경로 (insertSlide에서 업로드)
            }));
          }
        } else {
          // capture 모드 (기본): 기존 동작 유지
          screenshots = screenshotCandidates(parsed);
        }
      }

      parsedSlides.push({
        slide_number: slideNumber,
        role,
        section,
        functionName,
        title,
        blocks: role === 'content' ? buildFunctionBlocks(parsed, functionName) : [],
        screenshots,
        localRender: renderedSlides[slideNumber - 1] ?? null,
      });
    }

    const categories = buildHierarchy(parsedSlides);

    // 기존 결과 정리(같은 task 재실행)
    await supabase.from('manual_notion_blocks').delete().eq('task_id', job.task_id);
    await supabase.from('manual_slides').delete().eq('task_id', job.task_id);
    await supabase.from('manual_functions').delete().eq('task_id', job.task_id);
    await supabase.from('manual_categories').delete().eq('task_id', job.task_id);

    // 2차 적재: 카테고리 → 기능 → 슬라이드/블록/asset
    const slideIdByNumber = new Map();

    async function insertSlide(slide, categoryId, functionId) {
      const renderPath = `${job.task_id}/runs/${job.run_number}/slides/${String(slide.slide_number).padStart(3, '0')}.png`;
      if (slide.localRender) await uploadFile(RENDER_BUCKET, renderPath, slide.localRender, 'image/png');
      const reviewStatus = slide.role === 'cover' || slide.role === 'toc' ? 'excluded' : 'pending';
      const { data, error } = await supabase
        .from('manual_slides')
        .insert({
          task_id: job.task_id,
          job_id: job.id,
          slide_number: slide.slide_number,
          title: slide.title,
          render_path: renderPath,
          slide_role: slide.role,
          category_id: categoryId,
          function_id: functionId,
          review_status: reviewStatus,
          warnings: [],
        })
        .select('id')
        .single();
      if (error || !data) throw new Error(error?.message ?? `Slide insert failed: ${slide.slide_number}`);
      slideIdByNumber.set(slide.slide_number, data.id);
      return data.id;
    }

    let blockOrder = 0;
    for (const category of categories) {
      const { data: catRow, error: catError } = await supabase
        .from('manual_categories')
        .insert({ task_id: job.task_id, sort_order: category.sort_order, title: category.title, source: category.source })
        .select('id')
        .single();
      if (catError || !catRow) throw new Error(catError?.message ?? 'Category insert failed.');

      for (const fn of category.functions) {
        const { data: fnRow, error: fnError } = await supabase
          .from('manual_functions')
          .insert({
            task_id: job.task_id,
            category_id: catRow.id,
            sort_order: fn.sort_order,
            title: fn.title,
            review_status: fn.slides.length ? 'pending' : 'review_required',
          })
          .select('id')
          .single();
        if (fnError || !fnRow) throw new Error(fnError?.message ?? 'Function insert failed.');

        for (const slide of fn.slides) {
          const slideId = await insertSlide(slide, catRow.id, fnRow.id);

          if (slide.blocks.length) {
            const { error: blockError } = await supabase.from('manual_notion_blocks').insert(
              slide.blocks.map((block) => ({
                task_id: job.task_id,
                slide_id: slideId,
                function_id: fnRow.id,
                sort_order: blockOrder++,
                kind: block.kind,
                content: block,
                notion_payload: {},
                review_status: 'pending',
              })),
            );
            if (blockError) throw new Error(blockError.message);
          }

          if (slide.screenshots.length) {
            // group_bake 모드: imagePath를 가진 이미지는 버킷에 업로드하고 storage_path 설정
            // capture 모드: 기존 동작 (crop_box 저장, storage_path=null)
            const assetRows = [];
            for (const shot of slide.screenshots.slice(0, 4)) {
              // 에셋별로 판정: imagePath 있으면 group_bake(구운 이미지 업로드), 없으면 capture(crop_box)
              const isBaked = Boolean(shot.imagePath);
              let storagePath = null;
              if (isBaked) {
                const assetFileName = path.basename(shot.imagePath);
                storagePath = `${job.task_id}/runs/${job.run_number}/assets/${assetFileName}`;
                await uploadFile(ASSETS_BUCKET, storagePath, shot.imagePath, 'image/png');
              }
              assetRows.push({
                slide_id: slideId,
                job_id: job.id,
                kind: isBaked ? 'group_bake' : 'screenshot',
                label: shot.label,
                storage_path: storagePath,
                crop_box: isBaked ? null : shot.bbox,
                source_element_ids: [],
                included_annotation_ids: [],
                review_status: 'pending',
                review_reason: isBaked ? 'group_bake_auto' : 'extracted_candidate',
                confidence: shot.confidence,
              });
            }
            const { error: assetError } = await supabase.from('manual_assets').insert(assetRows);
            if (assetError) throw new Error(assetError.message);
          }
        }
      }
    }

    // 표지/목차 등 트리에 안 들어간 슬라이드도 렌더 보존(검수에서 disable 표시)
    for (const slide of parsedSlides) {
      if (slideIdByNumber.has(slide.slide_number)) continue;
      await insertSlide(slide, null, null);
    }

    const manifest = {
      jobId: job.id,
      taskId: job.task_id,
      runNumber: job.run_number,
      sourceFileName: sourceFile.file_name,
      slideSize,
      categories: categories.map((c) => ({
        title: c.title,
        functions: c.functions.map((f) => ({ title: f.title, slides: f.slides.map((s) => s.slide_number) })),
      })),
      excludedSlides: parsedSlides.filter((s) => s.role === 'cover' || s.role === 'toc').map((s) => s.slide_number),
    };
    const manifestFile = path.join(tmpDir, 'manifest.json');
    await writeFile(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
    const manifestPath = `${job.task_id}/runs/${job.run_number}/manifest.json`;
    await uploadFile(MANIFEST_BUCKET, manifestPath, manifestFile, 'application/json');

    await supabase
      .from('manual_conversion_jobs')
      .update({ status: 'succeeded', manifest_path: manifestPath, finished_at: new Date().toISOString() })
      .eq('id', job.id);
    await supabase
      .from('manual_tasks')
      .update({ status: 'review_required', updated_at: new Date().toISOString() })
      .eq('id', job.task_id);

    console.log(
      JSON.stringify(
        {
          taskId: job.task_id,
          categories: categories.length,
          functions: categories.reduce((sum, c) => sum + c.functions.length, 0),
          slides: parsedSlides.length,
          excluded: manifest.excludedSlides.length,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown conversion error.';
    await supabase
      .from('manual_conversion_jobs')
      .update({ status: 'failed', error_message: message, finished_at: new Date().toISOString() })
      .eq('id', job.id);
    await supabase.from('manual_tasks').update({ status: 'failed', updated_at: new Date().toISOString() }).eq('id', job.task_id);
    throw error;
  }
}

// 컨테이너 재시작 등으로 멈춘 running job 을 다시 queued 로 돌려 재처리한다(단일 worker 전제).
export async function reclaimStuckJobs() {
  // 나이 컷오프: 방금 시작한 running job 까지 조건 없이 queued 로 되돌리면
  // 다른 프로세스가 처리 중인 job 을 가로채 이중 처리(중복 키)가 난다.
  // 변환은 보통 2~5분 내 끝나므로 15분 넘게 running 인 것만 죽은 것으로 회수한다.
  const cutoff = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('manual_conversion_jobs')
    .update({ status: 'queued', worker_id: null, started_at: null })
    .eq('status', 'running')
    .or(`started_at.lt.${cutoff},started_at.is.null`)
    .select('id');
  if (error) {
    console.error('[worker] reclaim error:', error.message);
    return 0;
  }
  return data?.length ?? 0;
}

// 죽은 발행(프로세스 종료/OOM 으로 멈춘 publish run)을 회수한다.
// 발행은 보통 2분 내 끝나므로 10분 넘게 running 인 run 은 죽은 것으로 보고
// run 을 failed, 해당 task 를 review_required 로 되돌려 다시 발행할 수 있게 한다.
export async function reclaimStuckPublishRuns() {
  const cutoff = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('manual_publish_runs')
    .update({ status: 'failed', error_message: '발행 중 서버가 중단되어 회수됨', finished_at: new Date().toISOString() })
    .eq('status', 'running')
    .lt('started_at', cutoff)
    .select('id,task_id');
  if (error) {
    console.error('[worker] publish reclaim error:', error.message);
    return 0;
  }
  const taskIds = [...new Set((data ?? []).map((r) => r.task_id).filter(Boolean))];
  if (taskIds.length) {
    await supabase
      .from('manual_tasks')
      .update({ status: 'review_required', updated_at: new Date().toISOString() })
      .in('id', taskIds)
      .eq('status', 'publishing');
  }
  return data?.length ?? 0;
}

// 직접 실행(`node run-conversion-job.mjs [jobId]`)이면 한 번 처리한다. 폴링 루프는 runOnce 를 import 해 사용.
if (process.argv[1] && process.argv[1].endsWith('run-conversion-job.mjs')) {
  runOnce(process.argv[2]).catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
