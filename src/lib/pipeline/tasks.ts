import 'server-only';
import { createServiceSupabaseClient } from '@/lib/supabase/server';
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

function buildProject(
  task: ManualTaskRow,
  sourceFileName: string,
  slides: ManualSlideRow[],
  assetsBySlideId: Map<string, ManualAssetRow[]>,
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
    status: task.status,
    totalSlides: mappedSlides.length,
    reviewedSlides: mappedSlides.filter((slide) => slide.status === 'approved').length,
    assetCount: mappedSlides.reduce((sum, slide) => sum + slide.assets.length, 0),
    issueCount: mappedSlides.reduce((sum, slide) => sum + slide.warnings.filter((warning) => warning.severity === 'blocking').length, 0),
    reviewReasons,
    updatedAt: formatDate(task.updated_at ?? task.created_at),
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
  let assetRows: ManualAssetRow[] = [];

  if (slideIds.length > 0) {
    const { data: assets, error: assetError } = await supabase
      .from('manual_assets')
      .select('id,slide_id,kind,label,confidence')
      .in('slide_id', slideIds)
      .order('created_at');

    if (assetError) {
      throw new Error(assetError.message);
    }

    assetRows = (assets ?? []) as ManualAssetRow[];
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
    buildProject(task, sourcesByTaskId.get(task.id) ?? '', slidesByTaskId.get(task.id) ?? [], assetsBySlideId),
  );
}

export async function getManualProject(taskId: string): Promise<ManualProject | null> {
  const projects = await listManualProjects();
  return projects.find((project) => project.id === taskId) ?? null;
}
