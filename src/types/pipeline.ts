export type PipelineStatus =
  | 'draft'
  | 'ready'
  | 'running'
  | 'review_required'
  | 'ready_to_publish'
  | 'publishing'
  | 'published'
  | 'failed';

export type AssetKind = 'screenshot' | 'qr' | 'table_image' | 'annotation' | 'decorative' | 'unknown' | 'group_bake';

export interface ManualAsset {
  id: string;
  kind: AssetKind;
  label: string;
  confidence: number;
}

export interface ManualSlide {
  id: string;
  number: number;
  title: string;
  status: 'pending' | 'needs_review' | 'approved';
  warnings: ManualReviewWarning[];
  assets: ManualAsset[];
}

export interface ManualReviewWarning {
  code: string;
  label: string;
  severity: 'blocking' | 'advisory';
  count?: number;
}

export interface ManualProject {
  id: string;
  title: string;
  sourceFile: string;
  notionTarget: string;
  publishedUrl: string | null;
  status: PipelineStatus;
  totalSlides: number;
  reviewedSlides: number;
  assetCount: number;
  issueCount: number;
  reviewReasons: ManualReviewWarning[];
  updatedAt: string;
  createdAt: string; // 같은 제목 중복 시 최신 판별용(ISO)
  latestJob: { status: string; created_at: string } | null; // 대기 방치 감지용
  slides: ManualSlide[];
}

export interface TaskCreateResult {
  project: ManualProject;
}

export interface TaskRunResult {
  project: ManualProject;
  job: {
    id: string;
    run_number: number;
    status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  };
}

export interface TaskPublishResult {
  project: ManualProject | null;
  result: {
    publishRunId: string;
    pageId: string;
    url: string | null;
    blockCount: number;
  };
}

export interface TaskDeleteResult {
  id: string;
}
