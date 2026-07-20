import 'server-only';
import { createServiceSupabaseClient } from '@/lib/supabase/server';
import { selectInChunks } from '@/lib/supabase/chunked';
import type { ManualProject, ManualReviewWarning, PipelineStatus } from '@/types/pipeline';

interface ManualTaskRow {
  id: string;
  title: string;
  status: PipelineStatus;
  target_notion_page_id: string | null;
  target_notion_data_source_id: string | null;
  created_at: string;
  updated_at: string;
}

interface ManualSourceFileRow {
  task_id: string;
  file_name: string;
}

interface ManualSlideRow {
  id: string;
  task_id: string;
  slide_number: number;
  title: string | null;
  review_status: 'pending' | 'review_required' | 'approved' | 'excluded';
  warnings: unknown;
}

interface ManualAssetRow {
  id: string;
  slide_id: string;
  kind: 'screenshot' | 'qr' | 'table_image' | 'annotation' | 'decorative' | 'unknown';
  label: string;
  confidence: number | null;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('ko-KR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'Asia/Seoul',
  }).format(new Date(value));
}

function mapReviewStatus(status: ManualSlideRow['review_status']) {
  if (status === 'approved') return 'approved' as const;
  if (status === 'review_required') return 'needs_review' as const;
  return 'pending' as const;
}

function normalizeWarnings(value: unknown): ManualReviewWarning[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((warning) => {
      if (!warning || typeof warning !== 'object') return null;
      const item = warning as Record<string, unknown>;
      const code = typeof item.code === 'string' ? item.code : 'UNKNOWN_REVIEW_REASON';
      const label = typeof item.label === 'string' ? item.label : '추출 정보';
      const severity = item.severity === 'blocking' ? 'blocking' : 'advisory';
      const count = typeof item.count === 'number' ? item.count : undefined;

      return { code, label, severity, count };
    })
    .filter(Boolean) as ManualReviewWarning[];
}

function summarizeReasons(slides: Array<{ warnings: ManualReviewWarning[] }>) {
  const reasonMap = new Map<string, ManualReviewWarning>();

  for (const slide of slides) {
    for (const warning of slide.warnings) {
      const current = reasonMap.get(warning.code);
      reasonMap.set(warning.code, {
        ...warning,
        count: (current?.count ?? 0) + (warning.count ?? 1),
      });
    }
  }

  return [...reasonMap.values()].sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === 'blocking' ? -1 : 1;
    return (b.count ?? 0) - (a.count ?? 0);
  });
}

// 발행된 노션 페이지 id 로 열람 URL 을 만든다(대시 제거한 32자리 hex 형태로 접속 가능).
function notionPageUrl(pageId: string | null | undefined): string | null {
  if (!pageId) return null;
  const compact = pageId.replace(/-/g, '');
  if (!/^[0-9a-fA-F]{32}$/.test(compact)) return null;
  return `https://www.notion.so/${compact}`;
}

function buildProject(
  task: ManualTaskRow,
  sourceFileName: string,
  slides: ManualSlideRow[],
  assetsBySlideId: Map<string, ManualAssetRow[]>,
  publishedPageId: string | null,
  latestJob: { status: string; created_at: string } | null = null,
): ManualProject {
  const mappedSlides = slides
    .sort((a, b) => a.slide_number - b.slide_number)
    .map((slide) => {
      const assets = assetsBySlideId.get(slide.id) ?? [];

      return {
        id: slide.id,
        number: slide.slide_number,
        title: slide.title ?? `슬라이드 ${slide.slide_number}`,
        status: mapReviewStatus(slide.review_status),
        warnings: normalizeWarnings(slide.warnings),
        assets: assets.map((asset) => ({
          id: asset.id,
          kind: asset.kind,
          label: asset.label,
          confidence: asset.confidence ?? 0,
        })),
      };
    });
  const reviewReasons = summarizeReasons(mappedSlides);

  return {
    id: task.id,
    title: task.title,
    sourceFile: sourceFileName || '원본 파일 없음',
    notionTarget: task.target_notion_page_id ?? task.target_notion_data_source_id ?? 'Notion 대상 미지정',
    publishedUrl: notionPageUrl(publishedPageId),
    status: task.status,
    totalSlides: mappedSlides.length,
    reviewedSlides: mappedSlides.filter((slide) => slide.status === 'approved').length,
    assetCount: mappedSlides.reduce((sum, slide) => sum + slide.assets.length, 0),
    issueCount: mappedSlides.reduce((sum, slide) => sum + slide.warnings.filter((warning) => warning.severity === 'blocking').length, 0),
    reviewReasons,
    updatedAt: formatDate(task.updated_at ?? task.created_at),
    createdAt: task.created_at,
    latestJob,
    slides: mappedSlides,
  };
}

export async function listManualProjects(): Promise<ManualProject[]> {
  const supabase = createServiceSupabaseClient();

  const { data: tasks, error: taskError } = await supabase
    .from('manual_tasks')
    .select('id,title,status,target_notion_page_id,target_notion_data_source_id,created_at,updated_at')
    .order('updated_at', { ascending: false });

  if (taskError) {
    throw new Error(taskError.message);
  }

  const taskRows = (tasks ?? []) as ManualTaskRow[];
  const taskIds = taskRows.map((task) => task.id);

  if (taskIds.length === 0) {
    return [];
  }

  const [{ data: sources, error: sourceError }, { data: slides, error: slideError }] = await Promise.all([
    supabase.from('manual_source_files').select('task_id,file_name').in('task_id', taskIds).order('created_at'),
    supabase
      .from('manual_slides')
      .select('id,task_id,slide_number,title,review_status,warnings')
      .in('task_id', taskIds)
      .order('slide_number'),
  ]);

  if (sourceError) {
    throw new Error(sourceError.message);
  }

  if (slideError) {
    throw new Error(slideError.message);
  }

  const slideRows = (slides ?? []) as ManualSlideRow[];
  const slideIds = slideRows.map((slide) => slide.id);

  // slide_id 를 한 번에 .in() 하면 수백 개일 때 URL 이 8KB 를 넘어 "URI too long" 으로 실패했음 → 청크 조회.
  const assetRows = await selectInChunks<ManualAssetRow>(slideIds, (chunk) =>
    supabase.from('manual_assets').select('id,slide_id,kind,label,confidence').in('slide_id', chunk),
  );

  // 발행된 노션 페이지(task 매핑). 가장 최근 발행 페이지를 task 별로 1건 보관한다.
  const publishedPageByTaskId = new Map<string, string>();
  const { data: mappings } = await supabase
    .from('manual_notion_mappings')
    .select('local_entity_id,notion_page_id,created_at')
    .eq('local_entity_type', 'task')
    .in('local_entity_id', taskIds)
    .order('created_at', { ascending: false });
  for (const mapping of (mappings ?? []) as Array<{ local_entity_id: string; notion_page_id: string | null }>) {
    if (mapping.notion_page_id && !publishedPageByTaskId.has(mapping.local_entity_id)) {
      publishedPageByTaskId.set(mapping.local_entity_id, mapping.notion_page_id);
    }
  }

  // 대기 방치 감지용: task 별 최신 변환 job (한 번에 가져와 최초 1건만 보관 — created_at desc)
  const { data: jobRows } = await supabase
    .from('manual_conversion_jobs')
    .select('task_id,status,created_at')
    .in('task_id', taskIds)
    .order('created_at', { ascending: false });
  const latestJobByTaskId = new Map<string, { status: string; created_at: string }>();
  for (const job of (jobRows ?? []) as Array<{ task_id: string; status: string; created_at: string }>) {
    if (!latestJobByTaskId.has(job.task_id)) latestJobByTaskId.set(job.task_id, { status: job.status, created_at: job.created_at });
  }

  const sourcesByTaskId = new Map<string, string>();
  for (const source of (sources ?? []) as ManualSourceFileRow[]) {
    if (!sourcesByTaskId.has(source.task_id)) {
      sourcesByTaskId.set(source.task_id, source.file_name);
    }
  }

  const slidesByTaskId = new Map<string, ManualSlideRow[]>();
  for (const slide of slideRows) {
    const current = slidesByTaskId.get(slide.task_id) ?? [];
    current.push(slide);
    slidesByTaskId.set(slide.task_id, current);
  }

  const assetsBySlideId = new Map<string, ManualAssetRow[]>();
  for (const asset of assetRows) {
    const current = assetsBySlideId.get(asset.slide_id) ?? [];
    current.push(asset);
    assetsBySlideId.set(asset.slide_id, current);
  }

  return taskRows.map((task) =>
    buildProject(
      task,
      sourcesByTaskId.get(task.id) ?? '',
      slidesByTaskId.get(task.id) ?? [],
      assetsBySlideId,
      publishedPageByTaskId.get(task.id) ?? null,
      latestJobByTaskId.get(task.id) ?? null,
    ),
  );
}

export async function getManualProject(taskId: string): Promise<ManualProject | null> {
  const projects = await listManualProjects();
  return projects.find((project) => project.id === taskId) ?? null;
}
