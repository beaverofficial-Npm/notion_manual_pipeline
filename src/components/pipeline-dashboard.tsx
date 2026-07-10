'use client';

import {
  Button,
  Card,
  Modal,
  message,
  primitiveRadius,
  primitiveSpacing,
  semanticColors,
  semanticTypography,
} from '@sungbinhwang-beaverworksinc/design-system';
import { Check, Edit2, ExternalLink, FileUp, Loader, Play, Send, Trash2, X } from 'lucide-react';
import type { CSSProperties } from 'react';
import { useEffect, useRef, useState } from 'react';
import type {
  ManualProject,
  PipelineStatus,
  TaskCreateResult,
  TaskDeleteResult,
  TaskPublishResult,
  TaskRunResult,
} from '@/types/pipeline';

interface PipelineDashboardProps {
  projects: ManualProject[];
}

const ps = primitiveSpacing;
const pr = primitiveRadius;
const sc = semanticColors;
const st = semanticTypography;

const statusMeta: Record<PipelineStatus, { label: string; text: string; bg: string; border: string }> = {
  draft: { label: '작성 중', text: sc.text.secondary, bg: sc.bg.elevated, border: sc.border.default },
  ready: { label: '분석 전', text: sc.text.secondary, bg: sc.bg.elevated, border: sc.border.default },
  running: { label: '변환 중', text: sc.primary.text, bg: sc.primary.bg, border: sc.primary.border },
  review_required: { label: '편집 가능', text: sc.info.text, bg: sc.info.bg, border: sc.info.border },
  ready_to_publish: { label: '확인 완료', text: sc.success.text, bg: sc.success.bg, border: sc.success.border },
  publishing: { label: 'Notion 내보내는 중', text: sc.primary.text, bg: sc.primary.bg, border: sc.primary.border },
  failed: { label: '실패', text: sc.error.text, bg: sc.error.bg, border: sc.error.border },
  published: { label: 'Notion 완료', text: sc.info.text, bg: sc.info.bg, border: sc.info.border },
};

const styles = {
  shell: {
    width: 'min(1120px, calc(100vw - 32px))',
    margin: '0 auto',
    padding: `${ps.lg}px 0`,
  },
  header: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: ps.md,
    marginBottom: ps.base,
    flexWrap: 'wrap',
  },
  headerCopy: {
    display: 'grid',
    gap: ps.xxs,
    minWidth: 0,
  },
  title: {
    margin: 0,
    color: sc.text.heading,
    fontSize: st.fontSizeHeading4,
    fontWeight: st.fontWeightStrong,
    lineHeight: st.lineHeightHeading4,
    letterSpacing: 0,
  },
  description: {
    margin: `${ps.xxs}px 0 0`,
    color: sc.text.secondary,
    fontSize: st.fontSize,
    lineHeight: st.lineHeight,
  },
  layout: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr)',
    gap: ps.md,
    alignItems: 'start',
  },
  newTask: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: ps.md,
  },
  newTaskControls: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: ps.sm,
  },
  uploadBox: {
    width: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: ps.md,
    minHeight: 112,
    padding: `${ps.md}px ${ps.lg}px`,
    color: sc.text.primary,
    background: sc.bg.elevated,
    border: `1px dashed ${sc.border.default}`,
    borderRadius: pr.xl,
    cursor: 'pointer',
    textAlign: 'left',
  },
  uploadBoxText: {
    display: 'grid',
    gap: 2,
    minWidth: 0,
  } as CSSProperties,
  hiddenInput: {
    display: 'none',
  },
  field: {
    display: 'grid',
    gap: ps.xs,
    color: sc.text.label,
    fontSize: st.fontSize,
    fontWeight: st.fontWeightMedium,
    lineHeight: st.lineHeight,
  },
  input: {
    width: '100%',
    height: 36,
    padding: `0 ${ps.sm}px`,
    color: sc.text.primary,
    background: sc.bg.container,
    border: `1px solid ${sc.border.default}`,
    borderRadius: pr.base,
    outline: 'none',
  },
  strongText: {
    display: 'block',
    color: sc.text.heading,
    fontSize: st.fontSize,
    fontWeight: st.fontWeightStrong,
    lineHeight: st.lineHeight,
    overflowWrap: 'anywhere',
  },
  smallText: {
    display: 'block',
    color: sc.text.secondary,
    fontSize: st.fontSizeSM,
    lineHeight: st.lineHeightSM,
    overflowWrap: 'anywhere',
  },
  dangerText: {
    display: 'block',
    color: sc.error.text,
    fontSize: st.fontSizeSM,
    lineHeight: st.lineHeightSM,
  },
  successText: {
    display: 'block',
    color: sc.success.text,
    fontSize: st.fontSizeSM,
    lineHeight: st.lineHeightSM,
  },
  processPanel: {
    display: 'grid',
    gap: ps.xs,
    padding: ps.sm,
    background: sc.bg.elevated,
    border: `1px solid ${sc.border.default}`,
    borderRadius: pr.lg,
  },
  progressTrack: {
    overflow: 'hidden',
    height: 8,
    background: sc.bg.container,
    border: `1px solid ${sc.border.secondary}`,
    borderRadius: pr.full,
  },
  progressBar: {
    height: '100%',
    background: sc.primary.default,
    borderRadius: pr.full,
    transition: 'width 700ms ease',
  },
  progressHeader: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: ps.sm,
  },
  progressValue: {
    color: sc.text.secondary,
    fontSize: st.fontSizeSM,
    fontWeight: st.fontWeightStrong,
    lineHeight: st.lineHeightSM,
  },
  boardHeader: {
    minHeight: 56,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: ps.sm,
    padding: `0 ${ps.md}px`,
    borderBottom: `1px solid ${sc.border.default}`,
  },
  taskList: {
    display: 'grid',
  },
  taskCard: {
    display: 'grid',
    gap: ps.sm,
    padding: ps.md,
    borderTop: `1px solid ${sc.border.secondary}`,
  },
  firstTaskCard: {
    borderTop: 0,
  },
  taskTop: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) auto',
    gap: ps.sm,
    alignItems: 'start',
  },
  taskMeta: {
    display: 'grid',
    gap: ps.xxs,
    minWidth: 0,
  },
  pill: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    justifySelf: 'start',
    minWidth: 64,
    height: 24,
    padding: `0 ${ps.xs}px`,
    borderRadius: pr.full,
    fontSize: st.fontSizeSM,
    fontWeight: st.fontWeightStrong,
    lineHeight: st.lineHeightSM,
    whiteSpace: 'nowrap',
  },
  metrics: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: ps.xs,
  },
  metric: {
    display: 'grid',
    gap: ps.xxs,
    minHeight: 64,
    padding: ps.sm,
    background: sc.bg.elevated,
    border: `1px solid ${sc.border.default}`,
    borderRadius: pr.lg,
  },
  taskInfoRow: {
    display: 'flex',
    alignItems: 'center',
    gap: ps.xs,
    flexWrap: 'wrap' as const,
    color: sc.text.secondary,
    fontSize: st.fontSizeSM,
  } as CSSProperties,
  taskInfoDot: {
    color: sc.text.quaternary,
  } as CSSProperties,
  taskTitleRow: {
    display: 'flex',
    alignItems: 'center',
    gap: ps.xxs,
    minWidth: 0,
  } as CSSProperties,
  taskTitle: {
    fontSize: st.fontSizeHeading5,
    lineHeight: st.lineHeightHeading5,
    fontWeight: st.fontWeightStrong,
    color: sc.text.heading,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  } as CSSProperties,
  titleInput: {
    width: '100%',
    maxWidth: 420,
    height: 34,
    padding: `0 ${ps.sm}px`,
    color: sc.text.heading,
    background: sc.bg.container,
    border: `1px solid ${sc.primary.border}`,
    borderRadius: pr.base,
    fontSize: st.fontSizeHeading5,
    fontWeight: st.fontWeightStrong,
    outline: 'none',
  } as CSSProperties,
  metricLabel: {
    color: sc.text.secondary,
    fontSize: st.fontSizeSM,
    lineHeight: st.lineHeightSM,
  },
  metricValue: {
    color: sc.text.heading,
    fontSize: st.fontSizeHeading5,
    fontWeight: st.fontWeightStrong,
    lineHeight: st.lineHeightHeading5,
  },
  reasonList: {
    display: 'flex',
    alignItems: 'center',
    gap: ps.xs,
    flexWrap: 'wrap',
  },
  reasonPill: {
    display: 'inline-flex',
    alignItems: 'center',
    minHeight: 24,
    padding: `0 ${ps.xs}px`,
    color: sc.info.text,
    background: sc.info.bg,
    border: `1px solid ${sc.info.border}`,
    borderRadius: pr.full,
    fontSize: st.fontSizeSM,
    fontWeight: st.fontWeightStrong,
    lineHeight: st.lineHeightSM,
  },
  taskActions: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: ps.xs,
    flexWrap: 'wrap',
  },
  emptyState: {
    minHeight: 160,
    display: 'grid',
    placeItems: 'center',
    padding: ps.md,
    color: sc.text.secondary,
    fontSize: st.fontSize,
    lineHeight: st.lineHeight,
    textAlign: 'center',
  },
} satisfies Record<string, CSSProperties>;

function useNarrowLayout() {
  const [isNarrow, setIsNarrow] = useState(false);

  useEffect(() => {
    const media = window.matchMedia('(max-width: 820px)');
    const update = () => setIsNarrow(media.matches);

    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  return isNarrow;
}

function statusPill(status: PipelineStatus) {
  const meta = statusMeta[status];

  return (
    <span
      style={{
        ...styles.pill,
        color: meta.text,
        background: meta.bg,
        border: `1px solid ${meta.border}`,
      }}
    >
      {meta.label}
    </span>
  );
}

function activeProgress(clock: number, base: number, ceiling: number) {
  const eased = 1 - Math.exp(-clock / 18);
  return Math.min(ceiling, Math.round(base + eased * (ceiling - base)));
}

function taskStep(project: ManualProject, isRunning: boolean, isPublishing: boolean, clock: number) {
  if (isPublishing || project.status === 'publishing') {
    return {
      label: 'Notion 내보내는 중',
      detail: '대상 페이지 아래에 하위 페이지와 블록을 생성하고 있습니다.',
      progress: activeProgress(clock, 64, 94),
      active: true,
    };
  }

  if (isRunning || project.status === 'running') {
    return {
      label: 'PPT 분석 중',
      detail: '슬라이드 이미지, 텍스트, 화면 영역을 추출하고 있습니다.',
      progress: activeProgress(clock, 18, 88),
      active: true,
    };
  }

  if (project.status === 'ready') {
    return { label: '업로드 완료', detail: 'PPT 원본이 저장되었습니다. 변환을 시작할 수 있습니다.', progress: 24, active: false };
  }

  if (project.status === 'review_required') {
    return {
      label: '변환 완료',
      detail: '바로 Notion에 내보내거나, 필요한 페이지만 편집할 수 있습니다.',
      progress: 72,
      active: false,
    };
  }

  if (project.status === 'ready_to_publish') {
    return { label: '페이지 확인 완료', detail: '편집한 내용으로 Notion에 내보낼 수 있습니다.', progress: 92, active: false };
  }

  if (project.status === 'published') {
    return { label: 'Notion 내보내기 완료', detail: '내보낸 뒤에도 페이지를 수정하고 다시 내보낼 수 있습니다.', progress: 100, active: false };
  }

  if (project.status === 'failed') {
    return { label: '실패', detail: '작업 중 오류가 발생했습니다. 메시지를 확인한 뒤 재시도해 주세요.', progress: 100, active: false };
  }

  return { label: '시작 전', detail: 'PPT를 업로드해 작업을 시작합니다.', progress: 0, active: false };
}

function progress({
  label,
  detail,
  progress,
  active,
  clock,
}: {
  label: string;
  detail: string;
  progress: number;
  active?: boolean;
  clock?: number;
}) {
  const suffix = active && typeof clock === 'number' ? '.'.repeat((clock % 3) + 1) : '';

  return (
    <div style={styles.processPanel}>
      <div style={styles.progressHeader}>
        <div>
          <strong style={styles.strongText}>
            {label}
            {suffix}
          </strong>
          <span style={styles.smallText}>{detail}</span>
        </div>
        <span style={styles.progressValue}>{progress}%</span>
      </div>
      <div style={styles.progressTrack} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
        <div className={active ? 'nm-progress-active' : undefined} style={{ ...styles.progressBar, width: `${progress}%` }} />
      </div>
    </div>
  );
}

export function PipelineDashboard({ projects: initialProjects }: PipelineDashboardProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [projects, setProjects] = useState(initialProjects);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitStep, setSubmitStep] = useState('');
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [runningTaskId, setRunningTaskId] = useState('');
  const [publishingTaskId, setPublishingTaskId] = useState('');
  const [deletingTaskId, setDeletingTaskId] = useState('');
  const [cancellingTaskId, setCancellingTaskId] = useState('');
  const [editingTitleId, setEditingTitleId] = useState('');
  const [publishModalOpen, setPublishModalOpen] = useState<string | null>(null);
  const [publishNotionTarget, setPublishNotionTarget] = useState('');
  const [convWatch, setConvWatch] = useState<{ taskId: string; title: string } | null>(null);
  const [convStatus, setConvStatus] = useState<{ taskStatus: string | null; jobStatus: string | null; jobError: string | null; slideCount: number } | null>(null);
  const [editTitleValue, setEditTitleValue] = useState('');
  const [progressClock, setProgressClock] = useState(0);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const isNarrow = useNarrowLayout();

  useEffect(() => {
    setProjects(initialProjects);
  }, [initialProjects]);

  useEffect(() => {
    if (
      !projects.some(
        (project) =>
          project.status === 'running' ||
          runningTaskId === project.id ||
          publishingTaskId === project.id ||
          deletingTaskId === project.id,
      )
    ) {
      return;
    }

    const intervalId = window.setInterval(async () => {
      try {
        const response = await fetch('/api/tasks');
        const result = (await response.json()) as { projects?: ManualProject[] };
        if (response.ok && result.projects) {
          setProjects(result.projects);
        }
      } catch {
        // The next interval will retry.
      }
    }, 3000);

    return () => window.clearInterval(intervalId);
  }, [deletingTaskId, projects, publishingTaskId, runningTaskId]);

  useEffect(() => {
    const hasActiveWork =
      isSubmitting ||
      projects.some((project) => project.status === 'running' || project.status === 'publishing') ||
      Boolean(runningTaskId) ||
      Boolean(publishingTaskId);

    if (!hasActiveWork) return;

    const intervalId = window.setInterval(() => {
      setProgressClock((current) => current + 1);
    }, 750);

    return () => window.clearInterval(intervalId);
  }, [isSubmitting, projects, publishingTaskId, runningTaskId]);

  // 변환 진행 모달: task 상태를 폴링해 진행을 보여준다(완료/실패 시 폴링 종료).
  useEffect(() => {
    if (!convWatch || !convWatch.taskId) return; // 업로드 단계(taskId 없음)엔 폴링하지 않는다
    const watchId = convWatch.taskId;
    let stop = false;
    const tick = async () => {
      if (stop) return;
      try {
        const res = await fetch(`/api/tasks/${watchId}`);
        if (res.ok) {
          const st = (await res.json()) as { taskStatus: string | null; jobStatus: string | null; jobError: string | null; slideCount: number };
          if (!stop) {
            setConvStatus(st);
            if (st.taskStatus) {
              setProjects((cur) => cur.map((p) => (p.id === watchId ? { ...p, status: st.taskStatus as ManualProject['status'] } : p)));
            }
            if (st.jobStatus && ['succeeded', 'failed', 'cancelled'].includes(st.jobStatus)) return;
          }
        }
      } catch {
        // 무시: 다음 tick 에서 재시도
      }
      if (!stop) window.setTimeout(tick, 2500);
    };
    tick();
    return () => {
      stop = true;
    };
  }, [convWatch]);

  const layoutStyle: CSSProperties = {
    ...styles.layout,
    gridTemplateColumns: isNarrow ? 'minmax(0, 1fr)' : styles.layout.gridTemplateColumns,
  };
  const taskTopStyle: CSSProperties = {
    ...styles.taskTop,
    gridTemplateColumns: isNarrow ? 'minmax(0, 1fr)' : styles.taskTop.gridTemplateColumns,
  };
  const metricsStyle: CSSProperties = {
    ...styles.metrics,
    gridTemplateColumns: isNarrow ? 'minmax(0, 1fr)' : styles.metrics.gridTemplateColumns,
  };
  const taskActionsStyle: CSSProperties = {
    ...styles.taskActions,
    justifyContent: isNarrow ? 'flex-start' : styles.taskActions.justifyContent,
  };

  async function handleStartConversion() {
    if (!selectedFile || isSubmitting) return;

    setIsSubmitting(true);
    setProgressClock(0);
    setSubmitStep('PPT 업로드 중');
    setFeedback(null);
    // 클릭 즉시 진행 모달을 연다(taskId 없는 동안은 '업로드 중' 단계).
    setConvStatus(null);
    setConvWatch({ taskId: '', title: selectedFile.name });

    const formData = new FormData();
    formData.append('file', selectedFile);
    formData.append('mode', 'group_bake'); // 자동 추출 단일(레거시 캡쳐 제거)

    try {
      const response = await fetch('/api/tasks', {
        method: 'POST',
        body: formData,
      });
      const result = (await response.json()) as Partial<TaskCreateResult> & { message?: string };

      if (!response.ok || !result.project) {
        throw new Error(result.message ?? '변환 작업을 시작하지 못했습니다.');
      }

      const createdProject = result.project as ManualProject;
      setProjects((current) => [createdProject, ...current]);
      setRunningTaskId(createdProject.id);
      setSubmitStep('PPT 분석 시작 중');

      const runResponse = await fetch(`/api/tasks/${createdProject.id}/run`, {
        method: 'POST',
      });
      const runResult = (await runResponse.json()) as Partial<TaskRunResult> & { message?: string };

      if (!runResponse.ok || !runResult.project) {
        throw new Error(runResult.message ?? 'PPT 분석을 시작하지 못했습니다.');
      }

      setProjects((current) =>
        current.map((project) => (project.id === createdProject.id ? (runResult.project as ManualProject) : project)),
      );
      setSelectedFile(null);
      message.success('변환을 시작했습니다.');
      // 변환 진행 모달 열기(상태 폴링)
      setConvStatus({ taskStatus: 'running', jobStatus: 'queued', jobError: null, slideCount: 0 });
      setConvWatch({ taskId: createdProject.id, title: createdProject.title });

      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    } catch (error) {
      const text = error instanceof Error ? error.message : '변환 작업을 시작하지 못했습니다.';
      setFeedback({ type: 'error', message: text });
      message.error(text);
      setConvWatch(null); // 시작 실패 시 진행 모달 닫기(토스트로 오류 안내)
    } finally {
      setIsSubmitting(false);
      setSubmitStep('');
      setRunningTaskId('');
    }
  }

  function isPptFile(file: File) {
    const name = file.name.toLowerCase();
    return name.endsWith('.ppt') || name.endsWith('.pptx');
  }

  function selectFile(file: File | null) {
    setFeedback(null);

    if (!file) {
      setSelectedFile(null);
      return;
    }

    if (!isPptFile(file)) {
      setSelectedFile(null);
      setFeedback({ type: 'error', message: 'PPT 또는 PPTX 파일만 업로드할 수 있습니다.' });
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
      return;
    }

    setSelectedFile(file);
  }

  async function handleCancelTask(taskId: string) {
    if (cancellingTaskId) return;
    setCancellingTaskId(taskId);
    try {
      const response = await fetch(`/api/tasks/${taskId}/cancel`, { method: 'POST' });
      if (!response.ok) throw new Error('변환을 중단하지 못했습니다.');
      setProjects((cur) => cur.map((project) => (project.id === taskId ? { ...project, status: 'failed' } : project)));
      message.success('변환을 중단했습니다.');
    } catch (error) {
      message.error(error instanceof Error ? error.message : '변환을 중단하지 못했습니다.');
    } finally {
      setCancellingTaskId('');
    }
  }

  async function handleRunTask(taskId: string) {
    if (runningTaskId) return;

    setRunningTaskId(taskId);
    setProgressClock(0);
    setFeedback(null);

    try {
      const response = await fetch(`/api/tasks/${taskId}/run`, {
        method: 'POST',
      });
      const result = (await response.json()) as Partial<TaskRunResult> & { message?: string };

      if (!response.ok || !result.project) {
        throw new Error(result.message ?? 'PPT 분석을 시작하지 못했습니다.');
      }

      setProjects((current) =>
        current.map((project) => (project.id === taskId ? (result.project as ManualProject) : project)),
      );
      setFeedback({ type: 'success', message: 'PPT 분석을 시작했습니다. 결과가 준비되면 페이지 편집 또는 Notion 내보내기를 할 수 있습니다.' });
      message.success('PPT 분석을 시작했습니다.');
    } catch (error) {
      const text = error instanceof Error ? error.message : 'PPT 분석을 시작하지 못했습니다.';
      setFeedback({ type: 'error', message: text });
      message.error(text);
    } finally {
      setRunningTaskId('');
    }
  }

  async function handleDeleteTask(project: ManualProject) {
    if (deletingTaskId) return;

    if (project.status === 'running' || project.status === 'publishing') {
      const label = project.status === 'running' ? '분석' : '추출';
      message.warning(`${label} 중인 작업은 삭제할 수 없습니다.`);
      return;
    }

    const confirmed = window.confirm(`"${project.title}" 작업을 삭제할까요? 원본 PPT와 변환 결과도 함께 삭제됩니다.`);
    if (!confirmed) return;

    setDeletingTaskId(project.id);
    setFeedback(null);

    try {
      const response = await fetch(`/api/tasks/${project.id}`, {
        method: 'DELETE',
      });
      const result = (await response.json()) as Partial<TaskDeleteResult> & { message?: string };

      if (!response.ok || !result.id) {
        throw new Error(result.message ?? '작업을 삭제하지 못했습니다.');
      }

      setProjects((current) => current.filter((item) => item.id !== project.id));
      setFeedback({ type: 'success', message: '작업을 삭제했습니다.' });
      message.success('작업을 삭제했습니다.');
    } catch (error) {
      const text = error instanceof Error ? error.message : '작업을 삭제하지 못했습니다.';
      setFeedback({ type: 'error', message: text });
      message.error(text);
    } finally {
      setDeletingTaskId('');
    }
  }

  async function handlePublishTask(taskId: string) {
    if (publishingTaskId) return;

    // 발행 대상 입력 모달 열기
    setPublishModalOpen(taskId);
    setPublishNotionTarget('');
  }

  async function handleConfirmPublish(taskId: string) {
    if (publishingTaskId || !publishNotionTarget.trim()) return;

    setPublishingTaskId(taskId);
    setProgressClock(0);
    setFeedback(null);

    try {
      // 발행은 NDJSON 스트림으로 진행 상황을 보낸다. 마지막 done 이벤트의 결과를 사용한다.
      const response = await fetch(`/api/tasks/${taskId}/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notionTarget: publishNotionTarget }),
      });
      if (!response.ok || !response.body) throw new Error('Notion 발행에 실패했습니다.');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let finalResult: TaskPublishResult['result'] | null = null;
      let errorMsg = '';

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.trim()) continue;
          const ev = JSON.parse(line) as
            | { type: 'progress'; progress: { done: number; total: number; label: string } }
            | { type: 'done'; result: TaskPublishResult['result'] }
            | { type: 'error'; message: string };
          if (ev.type === 'done') finalResult = ev.result;
          else if (ev.type === 'error') errorMsg = ev.message;
        }
      }

      if (errorMsg) throw new Error(errorMsg);
      if (!finalResult) throw new Error('Notion 발행에 실패했습니다.');

      // 프로젝트 목록 새로고침
      const listResponse = await fetch('/api/tasks');
      const listResult = (await listResponse.json()) as { projects?: ManualProject[] };
      if (listResponse.ok && listResult.projects) {
        setProjects(listResult.projects);
      }

      setFeedback({
        type: 'success',
        message: finalResult.url ? `Notion 페이지가 생성되었습니다: ${finalResult.url}` : 'Notion 페이지가 생성되었습니다.',
      });
      message.success('Notion 페이지가 생성되었습니다.');
    } catch (error) {
      const text = error instanceof Error ? error.message : 'Notion 발행에 실패했습니다.';
      setFeedback({ type: 'error', message: text });
      message.error(text);
    } finally {
      setPublishingTaskId('');
      setPublishModalOpen(null);
      setPublishNotionTarget('');
    }
  }

  function openReview(projectId: string) {
    window.location.href = `/tasks/${projectId}/review`;
  }

  async function handleRenameTask(taskId: string, title: string) {
    const trimmed = title.trim();
    setEditingTitleId('');
    const current = projects.find((project) => project.id === taskId);
    if (!trimmed || !current || current.title === trimmed) return;

    try {
      const response = await fetch(`/api/tasks/${taskId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: trimmed }),
      });
      if (!response.ok) throw new Error('변환 이름을 변경하지 못했습니다.');
      setProjects((cur) => cur.map((project) => (project.id === taskId ? { ...project, title: trimmed } : project)));
      message.success('변환 이름을 변경했습니다.');
    } catch (error) {
      message.error(error instanceof Error ? error.message : '변환 이름을 변경하지 못했습니다.');
    }
  }

  return (
    <main style={styles.shell}>
      <header style={styles.header}>
        <div style={styles.headerCopy}>
          <h1 style={styles.title}>PPT → Notion 매뉴얼 변환</h1>
          <p style={styles.description}>
            PPT를 올리면 목차·표지를 분석해 카테고리·이미지·텍스트로 정리합니다. 변환 목록에서 내용을 검토·수정한 뒤 Notion으로 내보냅니다.
          </p>
        </div>
      </header>

      <section style={layoutStyle}>
        <Card title="새 변환" bordered padding="md">
          <div style={styles.newTask}>
            <label
              style={{
                ...styles.uploadBox,
                borderColor: isDraggingFile ? sc.primary.border : sc.border.default,
                background: isDraggingFile ? sc.primary.bg : styles.uploadBox.background,
              }}
              onDragEnter={(event) => {
                event.preventDefault();
                setIsDraggingFile(true);
              }}
              onDragOver={(event) => {
                event.preventDefault();
                setIsDraggingFile(true);
              }}
              onDragLeave={(event) => {
                event.preventDefault();
                setIsDraggingFile(false);
              }}
              onDrop={(event) => {
                event.preventDefault();
                setIsDraggingFile(false);
                selectFile(event.dataTransfer.files.item(0));
              }}
            >
              <FileUp size={26} color={sc.primary.default} />
              <span style={styles.uploadBoxText}>
                <strong style={styles.strongText}>{selectedFile ? selectedFile.name : 'PPT 파일 업로드'}</strong>
                <span style={styles.smallText}>
                  {selectedFile ? `${Math.ceil(selectedFile.size / 1024)} KB · 클릭하면 다른 파일로 교체` : '클릭하거나 파일을 끌어오세요 (.ppt, .pptx)'}
                </span>
              </span>
              <input
                ref={fileInputRef}
                style={styles.hiddenInput}
                type="file"
                accept=".ppt,.pptx"
                onChange={(event) => {
                  selectFile(event.target.files?.[0] ?? null);
                }}
              />
            </label>

            <div style={styles.newTaskControls}>
              {/* 변환 방식은 자동 추출(group_bake) 단일 — 레거시 캡쳐 모드는 웹에서 제거됨 */}
              <Button
                variant="primary"
                block
                disabled={!selectedFile || isSubmitting}
                loading={isSubmitting}
                onClick={handleStartConversion}
              >
                <FileUp size={15} />
                {isSubmitting ? '변환 중' : '변환 시작'}
              </Button>
            </div>
          </div>
        </Card>

        <Card bordered padding="none">
          <div style={styles.boardHeader}>
            <strong style={styles.strongText}>변환 목록</strong>
            <span style={styles.smallText}>{projects.length}개</span>
          </div>
          <div style={styles.taskList}>
            {projects.length === 0 ? (
              <div style={styles.emptyState}>생성된 작업이 없습니다.</div>
            ) : (
              projects.map((project, index) => {
                const isRunning = runningTaskId === project.id;
                const isPublishing = publishingTaskId === project.id;
                const isDeleting = deletingTaskId === project.id;
                const isBusy = project.status === 'running' || project.status === 'publishing' || isRunning || isPublishing;
                const canRun = !isBusy && !isDeleting;
                const canReview =
                  project.totalSlides > 0 &&
                  (project.status === 'review_required' || project.status === 'ready_to_publish' || project.status === 'published') &&
                  !isBusy &&
                  !isDeleting;
                const canPublish =
                  (project.status === 'review_required' || project.status === 'ready_to_publish' || project.status === 'published') &&
                  !isBusy &&
                  !isDeleting;

                return (
                  <article key={project.id} style={{ ...styles.taskCard, ...(index === 0 ? styles.firstTaskCard : {}) }}>
                    <div style={taskTopStyle}>
                      <div style={styles.taskMeta}>
                        {editingTitleId === project.id ? (
                          <input
                            style={styles.titleInput}
                            value={editTitleValue}
                            autoFocus
                            onChange={(event) => setEditTitleValue(event.target.value)}
                            onBlur={() => handleRenameTask(project.id, editTitleValue)}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') handleRenameTask(project.id, editTitleValue);
                              else if (event.key === 'Escape') setEditingTitleId('');
                            }}
                          />
                        ) : (
                          <div style={styles.taskTitleRow}>
                            <strong style={styles.taskTitle}>{project.title}</strong>
                            <Button
                              variant="text"
                              size="sm"
                              aria-label="변환 이름 수정"
                              icon={<Edit2 size={14} />}
                              onClick={() => {
                                setEditingTitleId(project.id);
                                setEditTitleValue(project.title);
                              }}
                            />
                          </div>
                        )}
                        <span style={styles.taskInfoRow}>
                          <span>원본 {project.sourceFile}</span>
                          <span style={styles.taskInfoDot}>·</span>
                          <span>슬라이드 {project.status === 'running' && project.totalSlides === 0 ? '분석 중' : `${project.totalSlides}장`}</span>
                          <span style={styles.taskInfoDot}>·</span>
                          <span>추출 {project.status === 'running' && project.assetCount === 0 ? '분석 중' : `${project.assetCount}개`}</span>
                          <span style={styles.taskInfoDot}>·</span>
                          <span>{project.updatedAt}</span>
                        </span>
                      </div>
                      {statusPill(project.status)}
                    </div>

                    <div style={taskActionsStyle}>
                      {project.publishedUrl ? (
                        <Button
                          variant="text"
                          size="sm"
                          onClick={() => window.open(project.publishedUrl as string, '_blank', 'noopener,noreferrer')}
                        >
                          <ExternalLink size={14} />
                          노션에서 열기
                        </Button>
                      ) : null}
                      {project.status === 'running' || isRunning ? (
                        <>
                          <Button variant="primary" size="sm" disabled>
                            <Play size={14} />
                            분석 중
                          </Button>
                          <Button variant="default" size="sm" disabled={cancellingTaskId === project.id} onClick={() => handleCancelTask(project.id)}>
                            <X size={14} />
                            변환 중단
                          </Button>
                        </>
                      ) : null}
                      {project.status === 'publishing' || isPublishing ? (
                        <Button variant="primary" size="sm" disabled>
                          <Send size={14} />
                          Notion 내보내는 중
                        </Button>
                      ) : null}
                      {!isBusy && (project.status === 'ready' || project.status === 'draft' || project.status === 'failed') ? (
                        <Button variant="primary" size="sm" disabled={!canRun} onClick={() => handleRunTask(project.id)}>
                          <Play size={14} />
                          {project.status === 'failed' ? '다시 분석' : '분석 시작'}
                        </Button>
                      ) : null}
                      {!isBusy && project.status === 'review_required' ? (
                        <>
                          <Button variant="default" size="sm" disabled={!canReview} onClick={() => openReview(project.id)}>
                            <Edit2 size={14} />
                            검토·수정
                          </Button>
                          <Button variant="primary" size="sm" disabled={!canPublish} onClick={() => handlePublishTask(project.id)}>
                            <Send size={14} />
                            Notion 내보내기
                          </Button>
                        </>
                      ) : null}
                      {!isBusy && project.status === 'ready_to_publish' ? (
                        <>
                          <Button variant="default" size="sm" disabled={!canReview} onClick={() => openReview(project.id)}>
                            <Edit2 size={14} />
                            수정하기
                          </Button>
                          <Button variant="primary" size="sm" disabled={!canPublish} onClick={() => handlePublishTask(project.id)}>
                            <Send size={14} />
                            Notion 내보내기
                          </Button>
                        </>
                      ) : null}
                      {!isBusy && project.status === 'published' ? (
                        <>
                          <Button variant="default" size="sm" disabled={!canReview} onClick={() => openReview(project.id)}>
                            <Edit2 size={14} />
                            수정하기
                          </Button>
                          <Button variant="primary" size="sm" disabled={!canPublish} onClick={() => handlePublishTask(project.id)}>
                            <Send size={14} />
                            다시 내보내기
                          </Button>
                        </>
                      ) : null}
                      <Button variant="default" size="sm" disabled={isDeleting || isBusy} onClick={() => handleDeleteTask(project)}>
                        <Trash2 size={14} />
                        {isDeleting ? '삭제 중' : '삭제'}
                      </Button>
                    </div>
                  </article>
                );
              })
            )}
          </div>
        </Card>
      </section>

      {/* 발행 대상 입력 모달 */}
      <Modal
        open={!!publishModalOpen}
        onClose={() => setPublishModalOpen(null)}
        title="Notion 대상 입력"
        subtitle="발행할 Notion 페이지의 링크를 입력해 주세요"
        size="sm"
        footer={
          <>
            <Button variant="default" onClick={() => setPublishModalOpen(null)}>
              취소
            </Button>
            <Button
              variant="primary"
              disabled={!publishNotionTarget.trim() || publishingTaskId === publishModalOpen}
              loading={publishingTaskId === publishModalOpen}
              onClick={() => publishModalOpen && handleConfirmPublish(publishModalOpen)}
            >
              <Send size={14} />
              발행 시작
            </Button>
          </>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: ps.md, padding: ps.md }}>
          <div style={styles.field}>
            <label style={{ display: 'block', marginBottom: ps.xs }}>Notion 페이지 URL</label>
            <input
              style={styles.input}
              placeholder="https://www.notion.so/..."
              value={publishNotionTarget}
              onChange={(event) => setPublishNotionTarget(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && publishNotionTarget.trim() && publishModalOpen) {
                  handleConfirmPublish(publishModalOpen);
                }
              }}
              autoFocus
            />
            <span style={{ ...styles.smallText, marginTop: ps.xs, display: 'block' }}>
              Notion 페이지 링크를 복사해서 붙여넣으세요. 예: notion.so/12345abc
            </span>
          </div>
        </div>
      </Modal>

      {/* 변환 진행 모달 */}
      {(() => {
        const uploading = !!convWatch && !convWatch.taskId;
        const job = convStatus?.jobStatus;
        const taskDone = convStatus?.taskStatus && ['review_required', 'ready_to_publish', 'published'].includes(convStatus.taskStatus);
        const succeeded = !uploading && (job === 'succeeded' || Boolean(taskDone));
        const failed = !uploading && (job === 'failed' || job === 'cancelled' || convStatus?.taskStatus === 'failed');
        const inProgress = !succeeded && !failed;
        const phase = uploading
          ? 'PPT 업로드 중'
          : succeeded
            ? '변환 완료'
            : failed
              ? job === 'cancelled'
                ? '변환이 중단되었습니다'
                : '변환에 실패했습니다'
              : job === 'running'
                ? '슬라이드 분석·렌더 중'
                : '분석 대기 중';
        const slideCount = convStatus?.slideCount ?? 0;
        // 단계별 채움 + 분석 중엔 슬라이드 수에 따라 90%까지 점근(총 개수 미지라 100%는 완료시에만).
        const pct = uploading
          ? 12
          : succeeded
            ? 100
            : failed
              ? 100
              : job === 'running'
                ? Math.min(90, Math.round(35 + (slideCount / (slideCount + 10)) * 55))
                : 30;
        return (
          <Modal
            open={!!convWatch}
            onClose={() => {
              if (!inProgress) setConvWatch(null);
            }}
            title="변환 진행"
            subtitle={convWatch?.title}
            size="sm"
            footer={
              succeeded ? (
                <>
                  <Button variant="default" onClick={() => setConvWatch(null)}>
                    닫기
                  </Button>
                  <Button variant="primary" onClick={() => convWatch && openReview(convWatch.taskId)}>
                    <Edit2 size={14} />
                    검토·수정
                  </Button>
                </>
              ) : failed ? (
                <Button variant="default" onClick={() => setConvWatch(null)}>
                  닫기
                </Button>
              ) : (
                <Button
                  variant="default"
                  onClick={() => {
                    if (convWatch?.taskId) handleCancelTask(convWatch.taskId);
                    setConvWatch(null);
                  }}
                >
                  <X size={14} />
                  변환 중단
                </Button>
              )
            }
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: ps.md, padding: ps.md }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: ps.sm }}>
                {inProgress ? (
                  <Loader className="nm-spin" size={20} />
                ) : succeeded ? (
                  <Check size={20} color={sc.primary.default} />
                ) : (
                  <X size={20} color={sc.error.default} />
                )}
                <span style={{ fontSize: st.fontSize, fontWeight: st.fontWeightMedium, color: sc.text.heading, flex: 1 }}>{phase}</span>
                {!failed && <span style={{ fontSize: st.fontSizeSM, fontWeight: st.fontWeightMedium, color: sc.text.secondary }}>{pct}%</span>}
              </div>
              <div style={{ height: 8, borderRadius: pr.sm, background: sc.bg.elevated, overflow: 'hidden' }}>
                <div
                  style={{
                    height: '100%',
                    width: `${pct}%`,
                    background: failed ? sc.text.quaternary : sc.primary.default,
                    borderRadius: pr.sm,
                    transition: 'width 500ms ease',
                  }}
                />
              </div>
              <div style={{ fontSize: st.fontSizeSM, color: sc.text.secondary }}>
                {uploading
                  ? 'PPT를 업로드하고 있습니다…'
                  : succeeded
                    ? `슬라이드 ${convStatus?.slideCount ?? 0}개를 카테고리·기능으로 정리했습니다.`
                    : failed
                      ? convStatus?.jobError ?? '잠시 후 다시 시도해 주세요.'
                      : `정리된 슬라이드 ${convStatus?.slideCount ?? 0}개`}
              </div>
            </div>
          </Modal>
        );
      })()}
    </main>
  );
}
