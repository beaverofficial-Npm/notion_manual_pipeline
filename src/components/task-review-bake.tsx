'use client';

import { Button, Card, Input, Modal, message, dialog, primitiveRadius, primitiveSpacing, semanticColors, semanticTypography } from '@sungbinhwang-beaverworksinc/design-system';
import { ArrowLeft, Eye, Loader, Send } from 'lucide-react';
import type { CSSProperties } from 'react';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

const ps = primitiveSpacing;
const pr = primitiveRadius;
const sc = semanticColors;
const st = semanticTypography;

// 제목 비교용 정규화(공백 제거·소문자). 기능 제목 == 카테고리 제목이면 중복 헤딩을 숨긴다.
const norm = (s?: string | null) => (s ?? '').replace(/\s+/g, '').toLowerCase();

// Types (from tree API response)
interface Slide {
  id: string;
  slide_number: number;
  title: string | null;
  slide_role: string | null;
  review_status: string;
  render_url: string | null;
  assets: Asset[];
  blocks: Block[];
}

interface Asset {
  id: string;
  kind: string;
  label: string;
  storage_path?: string | null;
  signed_url?: string | null;
  review_status?: string;
}

// 노션 블록 content 실제 형태 (tree API → manual_notion_blocks.content JSONB)
//   { kind, text?, children?, rows? }
//   numbered_list 의 children 은 { kind:'callout'|'paragraph'|'bulleted', text } 배열,
//   table 은 rows: string[][] (첫 행 = 헤더). 데이터는 content.* 에만 있음(top-level 아님).
type BlockChildKind = 'callout' | 'paragraph' | 'bulleted';

interface BlockChild {
  kind: BlockChildKind;
  text: string;
}

interface BlockContent {
  kind: string;
  text?: string;
  number?: number | null;
  marker?: string; // PPT 원본 스텝 마커: ')' 또는 '.'
  prefix?: string | null; // 원본 스텝 라벨: "1.", "1)", "1-1."
  children?: BlockChild[];
  rows?: string[][];
}

interface Block {
  id: string;
  kind: string;
  content: BlockContent;
}

interface Function {
  id: string;
  title: string;
  review_status: string;
  slides: Slide[];
}

interface Category {
  id: string;
  title: string;
  functions: Function[];
}

interface TreeResponse {
  task: { id: string; title: string; status: string };
  tree: Category[];
  excludedSlides: Slide[];
}

interface PublishPreview {
  parentPageId: string;
  pageTitle: string;
  categoryCount: number;
  functionCount: number;
  categories: PreviewCategory[];
}

interface PreviewCategory {
  id: string;
  title: string;
  functions: PreviewFunction[];
}

interface PreviewFunction {
  id: string;
  title: string;
  slideCount: number;
  blocks: PreviewBlock[];
  images: PreviewImage[];
}

interface PreviewBlock {
  kind: string;
  text?: string;
  number?: number | null;
  marker?: string;
  prefix?: string | null;
  children?: BlockChild[];
  rows?: string[][];
}

interface PreviewImage {
  renderUrl: string;
  cropBox: { left: number; top: number; width: number; height: number };
  label: string;
}

interface TaskReviewBakeProps {
  taskId: string;
}

const styles: Record<string, CSSProperties> = {
  shell: {
    width: '100%',
    height: '100vh',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    background: sc.bg.layout,
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: ps.sm,
    padding: `${ps.lg}px ${ps.lg}px`,
    borderBottom: `1px solid ${sc.border.default}`,
    background: sc.bg.container,
    flexShrink: 0,
  },
  headerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: ps.md,
    minWidth: 0,
  },
  headerRight: {
    display: 'flex',
    alignItems: 'center',
    gap: ps.sm,
    flexWrap: 'wrap',
  },
  title: {
    margin: 0,
    color: sc.text.heading,
    fontSize: st.fontSizeHeading4,
    fontWeight: st.fontWeightStrong,
    lineHeight: st.lineHeightHeading4,
  },
  mainContent: {
    flex: 1,
    minHeight: 0,
    display: 'grid',
    gridTemplateColumns: '280px 1fr',
    gap: ps.sm,
    padding: ps.sm,
    overflow: 'hidden',
  },
  sidebar: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    overflow: 'hidden',
  },
  sidebarPanel: {
    display: 'flex',
    flexDirection: 'column',
    minHeight: 0,
    background: sc.bg.container,
    border: `1px solid ${sc.border.default}`,
    borderRadius: pr.lg,
    overflow: 'hidden',
  },
  sidebarPanelHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: ps.sm,
    padding: `${ps.sm}px ${ps.md}px`,
    borderBottom: `1px solid ${sc.border.default}`,
    flexShrink: 0,
    minHeight: 48,
  },
  sidebarPanelTitle: {
    fontSize: st.fontSizeHeading5,
    lineHeight: st.lineHeightHeading5,
    fontWeight: st.fontWeightStrong,
    color: sc.text.heading,
  },
  sidebarPanelBody: {
    flex: 1,
    minHeight: 0,
    overflowY: 'auto',
    overflowX: 'hidden',
    padding: ps.md,
  },
  categoryItem: {
    display: 'flex',
    alignItems: 'center',
    gap: ps.xs,
    width: '100%',
    minWidth: 0,
    boxSizing: 'border-box',
    padding: `${ps.xs}px ${ps.sm}px`,
    background: 'transparent',
    border: 'none',
    borderRadius: pr.base,
    cursor: 'pointer',
    color: sc.text.heading,
    fontSize: st.fontSize,
    fontWeight: st.fontWeightStrong,
    lineHeight: st.lineHeight,
    textAlign: 'left',
    marginBottom: ps.md,
  },
  functionItem: {
    display: 'flex',
    alignItems: 'center',
    gap: ps.xs,
    width: '100%',
    minWidth: 0,
    boxSizing: 'border-box',
    padding: `6px ${ps.sm}px 6px ${ps.xl}px`,
    background: 'transparent',
    border: 'none',
    borderLeft: '2px solid transparent',
    borderRadius: 0,
    cursor: 'pointer',
    color: sc.text.secondary,
    fontSize: st.fontSize,
    fontWeight: st.fontWeightRegular,
    lineHeight: st.lineHeight,
    textAlign: 'left',
    marginBottom: ps.xs,
  },
  functionItemSelected: {
    background: sc.primary.bg,
    color: sc.primary.default,
    borderLeft: `2px solid ${sc.primary.default}`,
    fontWeight: st.fontWeightMedium,
  },
  contentPanel: {
    display: 'flex',
    flexDirection: 'column',
    minHeight: 0,
    background: sc.bg.container,
    border: `1px solid ${sc.border.default}`,
    borderRadius: pr.lg,
    overflow: 'hidden',
  },
  contentPanelHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: ps.sm,
    padding: `${ps.sm}px ${ps.md}px`,
    borderBottom: `1px solid ${sc.border.default}`,
    flexShrink: 0,
    minHeight: 48,
  },
  contentPanelBody: {
    flex: 1,
    minHeight: 0,
    overflowY: 'auto',
    overflowX: 'hidden',
    padding: ps.md,
  },
  emptyState: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 360,
    color: sc.text.secondary,
    fontSize: st.fontSize,
  },
  divider: {
    height: 1,
    background: sc.border.default,
    margin: `${ps.lg}px 0`,
  },
  // ── 노션 실제 렌더 미리보기 ──────────────────────────────
  notionDoc: {
    display: 'flex',
    flexDirection: 'column',
    gap: ps.xs,
  },
  // 카테고리 = heading_1 (이모지 + 굵은 큰 제목)
  categoryHeading: {
    display: 'flex',
    alignItems: 'center',
    gap: ps.xs,
    margin: `${ps.sm}px 0 ${ps.xs}px`,
    color: sc.text.heading,
    fontSize: st.fontSizeHeading2,
    fontWeight: st.fontWeightBold,
    lineHeight: st.lineHeightHeading2,
  },
  categoryHeadingEmoji: {
    fontSize: st.fontSizeHeading2,
    lineHeight: 1,
  },
  // 기능 = heading_2 (진한 네이비 배경 바 + 흰 텍스트)
  functionHeadingBar: {
    display: 'flex',
    alignItems: 'center',
    padding: `${ps.sm}px ${ps.base}px`,
    margin: `${ps.sm}px 0 ${ps.base}px`,
    background: sc.primary.dark4,
    borderRadius: pr.xl,
    color: sc.text.lightSolid,
    fontSize: st.fontSizeHeading4,
    fontWeight: st.fontWeightStrong,
    lineHeight: st.lineHeightHeading4,
  },
  // 소제목 = heading (heading_3 느낌)
  blockHeading: {
    margin: `${ps.sm}px 0 ${ps.xxs}px`,
    color: sc.text.heading,
    fontSize: st.fontSizeHeading5,
    fontWeight: st.fontWeightStrong,
    lineHeight: st.lineHeightHeading5,
  },
  // 문단
  paragraph: {
    margin: 0,
    color: sc.text.primary,
    fontSize: st.fontSize,
    lineHeight: st.lineHeight,
    whiteSpace: 'pre-wrap',
    overflowWrap: 'anywhere',
  },
  // 목록 행 (번호/불릿 공통)
  listRow: {
    display: 'flex',
    gap: ps.xs,
    alignItems: 'baseline',
    color: sc.text.primary,
    fontSize: st.fontSize,
    lineHeight: st.lineHeight,
  },
  listMarker: {
    flexShrink: 0,
    minWidth: 20,
    color: sc.text.secondary,
    fontWeight: st.fontWeightMedium,
    fontVariantNumeric: 'tabular-nums',
  },
  bulletMarker: {
    flexShrink: 0,
    width: 16,
    textAlign: 'center',
    color: sc.text.secondary,
  },
  listText: {
    flex: 1,
    minWidth: 0,
    whiteSpace: 'pre-wrap',
    overflowWrap: 'anywhere',
  },
  // 하위 항목 들여쓰기 컨테이너
  childIndent: {
    display: 'flex',
    flexDirection: 'column',
    gap: ps.xxs,
    paddingLeft: ps.lg,
    marginTop: ps.xxs,
  },
  // 콜아웃 박스
  callout: {
    display: 'flex',
    gap: ps.xs,
    padding: `${ps.sm}px ${ps.base}px`,
    background: sc.warning.bg,
    border: `1px solid ${sc.warning.border}`,
    borderRadius: pr.xl,
    color: sc.text.primary,
    fontSize: st.fontSize,
    lineHeight: st.lineHeight,
  },
  calloutIcon: {
    flexShrink: 0,
    fontSize: st.fontSize,
    lineHeight: st.lineHeight,
  },
  calloutText: {
    flex: 1,
    minWidth: 0,
    whiteSpace: 'pre-wrap',
    overflowWrap: 'anywhere',
  },
  // 표
  tableWrap: {
    width: '100%',
    overflowX: 'auto',
    border: `1px solid ${sc.border.default}`,
    borderRadius: pr.xl,
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: st.fontSizeSM,
    lineHeight: st.lineHeightSM,
  },
  tableHeaderCell: {
    padding: `${ps.xs}px ${ps.sm}px`,
    background: sc.bg.elevated,
    borderBottom: `1px solid ${sc.border.default}`,
    borderRight: `1px solid ${sc.border.secondary}`,
    color: sc.text.heading,
    fontWeight: st.fontWeightStrong,
    textAlign: 'left',
    verticalAlign: 'top',
    whiteSpace: 'pre-wrap',
    overflowWrap: 'anywhere',
  },
  tableCell: {
    padding: `${ps.xs}px ${ps.sm}px`,
    borderBottom: `1px solid ${sc.border.secondary}`,
    borderRight: `1px solid ${sc.border.secondary}`,
    color: sc.text.primary,
    verticalAlign: 'top',
    whiteSpace: 'pre-wrap',
    overflowWrap: 'anywhere',
  },
  // 베이크 이미지 (인라인 풀폭)
  bakeImage: {
    display: 'block',
    width: '100%',
    height: 'auto',
    borderRadius: pr.xl,
    border: `1px solid ${sc.border.default}`,
    background: sc.bg.elevated,
  },
};

// 표 렌더 (첫 행 = 헤더). 빈 셀/빈 행은 그대로 두되, 폭은 최대 열 수로 맞춘다.
function NotionTable({ rows }: { rows: string[][] }) {
  const cleaned = rows.filter((row) => row.length > 0);
  if (!cleaned.length) return null;
  const width = Math.max(...cleaned.map((row) => row.length));
  const [headerRow, ...bodyRows] = cleaned;
  return (
    <div style={styles.tableWrap}>
      <table style={styles.table}>
        <thead>
          <tr>
            {Array.from({ length: width }, (_, col) => (
              <th key={col} style={styles.tableHeaderCell}>
                {headerRow[col] ?? ''}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {bodyRows.map((row, rowIdx) => (
            <tr key={rowIdx}>
              {Array.from({ length: width }, (_, col) => (
                <td key={col} style={styles.tableCell}>
                  {row[col] ?? ''}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// 하위 항목(numbered_list children): kind 별로 콜아웃/불릿/문단 렌더, 들여쓰기.
function NotionChild({ child }: { child: BlockChild }) {
  if (child.kind === 'callout') {
    return (
      <div style={styles.callout}>
        <span style={styles.calloutIcon}>⚠️</span>
        <span style={styles.calloutText}>{child.text}</span>
      </div>
    );
  }
  if (child.kind === 'bulleted') {
    return (
      <div style={styles.listRow}>
        <span style={styles.bulletMarker}>•</span>
        <span style={styles.listText}>{child.text}</span>
      </div>
    );
  }
  return <p style={styles.paragraph}>{child.text}</p>;
}

// 단일 노션 블록을 "발행됐을 때 실제 모습"으로 렌더한다.
// 데이터는 content.text / content.children / content.rows 에 있다(top-level 아님).
function NotionBlockView({ content, index }: { content: BlockContent; index: number }) {
  const kind = content.kind;
  const text = content.text ?? '';

  switch (kind) {
    case 'heading':
      return <div style={styles.blockHeading}>{text}</div>;
    case 'numbered_list': {
      const children = content.children ?? [];
      return (
        <div>
          <div style={styles.listRow}>
            <span style={styles.listMarker}>{content.prefix ?? `${content.number ?? index + 1}${content.marker ?? '.'}`}</span>
            <span style={styles.listText}>{text}</span>
          </div>
          {children.length > 0 && (
            <div style={styles.childIndent}>
              {children.map((child, childIdx) => (
                <NotionChild key={childIdx} child={child} />
              ))}
            </div>
          )}
        </div>
      );
    }
    case 'bulleted_list':
      return (
        <div style={styles.listRow}>
          <span style={styles.bulletMarker}>•</span>
          <span style={styles.listText}>{text}</span>
        </div>
      );
    case 'callout':
      return (
        <div style={styles.callout}>
          <span style={styles.calloutIcon}>⚠️</span>
          <span style={styles.calloutText}>{text}</span>
        </div>
      );
    case 'table':
      return <NotionTable rows={content.rows ?? []} />;
    case 'paragraph':
    default:
      return text ? <p style={styles.paragraph}>{text}</p> : null;
  }
}

// numbered_list 는 연속될 때 1,2,3… 로 번호를 매긴다(노션과 동일).
// 그 외 kind 가 끼면 카운터를 리셋해 목록 그룹을 분리한다.
function NotionBlocks({ blocks }: { blocks: Block[] }) {
  if (!blocks.length) return null;
  let numberedIndex = 0;
  return (
    <div style={styles.notionDoc}>
      {blocks.map((block) => {
        const content = block.content;
        const isNumbered = content?.kind === 'numbered_list';
        const index = isNumbered ? numberedIndex : 0;
        numberedIndex = isNumbered ? numberedIndex + 1 : 0;
        return <NotionBlockView key={block.id} content={content} index={index} />;
      })}
    </div>
  );
}

// ── 발행 미리보기 모달(PreviewBlock 형태)용 렌더 ───────────────
function PreviewChild({ child }: { child: BlockChild }) {
  return <NotionChild child={child} />;
}

function PreviewBlock_({ blocks }: { blocks: PreviewBlock[] }) {
  if (!blocks.length) return null;
  let numberedIndex = 0;
  return (
    <div style={styles.notionDoc}>
      {blocks.map((block, idx) => {
        const isNumbered = block.kind === 'numbered_list';
        const index = isNumbered ? numberedIndex : 0;
        numberedIndex = isNumbered ? numberedIndex + 1 : 0;

        if (block.kind === 'table') {
          return <NotionTable key={idx} rows={block.rows ?? []} />;
        }
        if (block.kind === 'callout') {
          return (
            <div key={idx} style={styles.callout}>
              <span style={styles.calloutIcon}>⚠️</span>
              <span style={styles.calloutText}>{block.text ?? ''}</span>
            </div>
          );
        }
        if (block.kind === 'bulleted_list') {
          return (
            <div key={idx} style={styles.listRow}>
              <span style={styles.bulletMarker}>•</span>
              <span style={styles.listText}>{block.text ?? ''}</span>
            </div>
          );
        }
        if (block.kind === 'heading') {
          return <div key={idx} style={styles.blockHeading}>{block.text ?? ''}</div>;
        }
        if (block.kind === 'numbered_list') {
          const children = block.children ?? [];
          return (
            <div key={idx}>
              <div style={styles.listRow}>
                <span style={styles.listMarker}>{block.prefix ?? `${block.number ?? index + 1}${block.marker ?? '.'}`}</span>
                <span style={styles.listText}>{block.text ?? ''}</span>
              </div>
              {children.length > 0 && (
                <div style={styles.childIndent}>
                  {children.map((child, childIdx) => (
                    <PreviewChild key={childIdx} child={child} />
                  ))}
                </div>
              )}
            </div>
          );
        }
        return block.text ? <p key={idx} style={styles.paragraph}>{block.text}</p> : null;
      })}
    </div>
  );
}

export function TaskReviewBake({ taskId }: TaskReviewBakeProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tree, setTree] = useState<Category[]>([]);
  const [taskTitle, setTaskTitle] = useState('');
  const [selectedFunctionId, setSelectedFunctionId] = useState<string | null>(null);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [previewData, setPreviewData] = useState<PublishPreview | null>(null);
  const [previewPageId, setPreviewPageId] = useState<string | null>(null);
  const [notionTarget, setNotionTarget] = useState('');
  const [isPublishingInProgress, setIsPublishingInProgress] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);

  // 함수 포함/제외 상태 (함수 ID → boolean)
  const [functionIncluded, setFunctionIncluded] = useState<Record<string, boolean>>({});

  // tree 로드 — 변환 중이면 완료될 때까지 자동 폴링(부분 데이터/수동 새로고침 방지)
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;
    async function loadTree() {
      try {
        const res = await fetch(`/api/tasks/${taskId}/tree`, { cache: 'no-store' });
        if (!res.ok) throw new Error('트리를 불러오지 못했습니다.');
        const data = (await res.json()) as TreeResponse;
        if (cancelled) return;
        setTree(data.tree);
        setTaskTitle(data.task.title);
        // 첫 함수 선택(이미 선택돼 있으면 폴링 중 바꾸지 않음)
        const firstFn = data.tree[0]?.functions[0];
        setSelectedFunctionId((prev) => (prev ? prev : (firstFn?.id ?? prev)));
        // 포함 상태는 첫 로드에만 초기화(폴링 중 사용자 토글 보존)
        setFunctionIncluded((prev) => {
          if (Object.keys(prev).length > 0) return prev;
          const included: Record<string, boolean> = {};
          data.tree.forEach((cat) => {
            cat.functions.forEach((fn) => {
              included[fn.id] = fn.review_status !== 'excluded';
            });
          });
          return included;
        });
        // 아직 변환 중(running/ready/draft)이면 3초 후 다시 로드해 채운다
        if (['running', 'ready', 'draft'].includes(data.task.status)) {
          timer = setTimeout(loadTree, 3000);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : '알 수 없는 오류');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    loadTree();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [taskId]);

  // 현재 선택된 함수 + 그 함수가 속한 카테고리(heading_1 표시용)
  const selectedCategory = tree.find((cat) => cat.functions.some((fn) => fn.id === selectedFunctionId));
  const selectedFunction = selectedCategory?.functions.find((fn) => fn.id === selectedFunctionId);

  // 미리보기 로드
  async function loadPreview() {
    try {
      setIsPreviewLoading(true);
      const res = await fetch(`/api/tasks/${taskId}/publish/preview`, { method: 'POST' });
      if (!res.ok) throw new Error('미리보기를 불러오지 못했습니다.');
      const data = (await res.json()) as { preview: PublishPreview };
      setPreviewData(data.preview);
      const firstPageId = data.preview.categories[0]?.functions[0]?.id;
      if (firstPageId) setPreviewPageId(firstPageId);
    } catch (err) {
      message.error(err instanceof Error ? err.message : '미리보기 로드 실패');
    } finally {
      setIsPreviewLoading(false);
    }
  }

  // 발행
  async function handlePublish() {
    if (!notionTarget.trim()) {
      message.error('Notion 링크를 입력해 주세요.');
      return;
    }

    setIsPublishingInProgress(true);
    setPublishError(null);
    let hadError = false;

    try {
      // 제외된 함수 목록 빌드
      const excludedFnIds = tree
        .flatMap((cat) => cat.functions)
        .filter((fn) => !functionIncluded[fn.id])
        .map((fn) => fn.id);

      const response = await fetch(`/api/tasks/${taskId}/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notionTarget, excludedFnIds }),
      });

      if (!response.ok) {
        // 409(이미 발행 중) 등 — 서버가 준 메시지를 그대로 보여준다.
        let msg = `발행 요청 실패 (${response.status})`;
        try {
          const parsed = JSON.parse((await response.text()).trim().split('\n')[0] || '{}');
          if (parsed.message) msg = parsed.message;
        } catch {
          /* noop */
        }
        setPublishError(msg);
        return; // 모달은 열어둔 채 에러 표시
      }

      // NDJSON 스트림 처리
      const reader = response.body?.getReader();
      if (!reader) throw new Error('응답 스트림 없음');

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line) continue;
          try {
            const event = JSON.parse(line);
            if (event.type === 'error') {
              hadError = true;
              setPublishError(event.message ?? '발행 중 오류가 발생했습니다.');
            }
          } catch {
            /* 부분 라인 무시 */
          }
        }
      }

      if (hadError) return; // 에러가 있었으면 모달 열어둔 채 종료(성공 토스트 X)
      message.success('발행 완료');
      setIsPublishingInProgress(false); // 성공했을 때만 닫는다
    } catch (err) {
      // 연결 끊김·타임아웃 등 — 모달을 닫지 않고 에러를 명확히 남긴다.
      setPublishError(
        err instanceof Error
          ? `발행이 중단됐습니다: ${err.message}. (큰 덱은 시간이 걸릴 수 있어요 — 잠시 후 다시 시도)`
          : '발행이 중단됐습니다. 잠시 후 다시 시도해 주세요.',
      );
    }
  }

  if (loading) {
    return (
      <div style={styles.shell}>
        <div style={{ ...styles.emptyState, gap: ps.md }}>
          <Loader className="nm-spin" size={32} />
          <span>로드 중...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={styles.shell}>
        <div style={{ ...styles.emptyState, gap: ps.md, color: sc.error.text }}>
          <span>오류: {error}</span>
        </div>
      </div>
    );
  }

  return (
    <main style={styles.shell}>
      {/* Header */}
      <div style={styles.header}>
        <div style={styles.headerLeft}>
          <Button variant="text" size="sm" icon={<ArrowLeft size={20} />} onClick={() => router.push('/')} />
          <h1 style={styles.title}>{taskTitle}</h1>
        </div>
        <div style={styles.headerRight}>
          <Button variant="default" size="sm" icon={<Eye size={16} />} onClick={() => loadPreview()}>
            미리보기
          </Button>
          <Input
            placeholder="Notion 링크 입력"
            value={notionTarget}
            onChange={(e) => setNotionTarget(e.target.value)}
            style={{ width: 300 }}
            size="sm"
          />
          <Button variant="primary" size="sm" icon={<Send size={16} />} onClick={handlePublish} disabled={isPublishingInProgress}>
            발행
          </Button>
        </div>
      </div>

      {/* Main content: sidebar + content */}
      <div style={styles.mainContent}>
        {/* Sidebar: 카테고리 · 기능 목록 */}
        <div style={styles.sidebarPanel}>
          <div style={styles.sidebarPanelHeader}>
            <span style={styles.sidebarPanelTitle}>구조</span>
          </div>
          <div style={styles.sidebarPanelBody}>
            {tree.map((category) => (
              <div key={category.id}>
                <button style={styles.categoryItem} disabled>
                  {category.title}
                </button>
                {category.functions.map((fn) => (
                  <button
                    key={fn.id}
                    style={{
                      ...styles.functionItem,
                      ...(selectedFunctionId === fn.id ? styles.functionItemSelected : {}),
                    }}
                    onClick={() => setSelectedFunctionId(fn.id)}
                  >
                    {norm(fn.title) === norm(category.title) ? '개요' : fn.title}
                    {functionIncluded[fn.id] === false && <span style={{ marginLeft: 'auto', fontSize: st.fontSizeSM, color: sc.error.text }}>제외</span>}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>

        {/* Content: 선택한 기능의 슬라이드 + 에셋 + 블록 */}
        <div style={styles.contentPanel}>
          <div style={styles.contentPanelHeader}>
            <span style={styles.contentPanelTitle}>검토</span>
          </div>
          <div style={styles.contentPanelBody}>
            {selectedFunction ? (
              // 노션에 발행됐을 때 실제로 보이는 모습:
              // 카테고리(heading_1) → 기능(heading_2 네이비 바) → 슬라이드별 본문 블록 + 베이크 이미지.
              <div style={styles.notionDoc}>
                {/* 카테고리 = heading_1 (이모지 + 굵은 큰 제목) */}
                {selectedCategory && (
                  <div style={styles.categoryHeading}>
                    <span style={styles.categoryHeadingEmoji}>📕</span>
                    <span>{selectedCategory.title}</span>
                  </div>
                )}

                {/* 기능 = heading_2 (진한 네이비 배경 바). 단, 카테고리 제목과 같으면(인트로/개요) 중복이라 생략. */}
                {norm(selectedFunction.title) !== norm(selectedCategory?.title) && (
                  <div style={styles.functionHeadingBar}>{selectedFunction.title}</div>
                )}

                {selectedFunction.slides.map((slide, slideIdx) => {
                  // 페이지(슬라이드)별로 짝지어 보여주되, 순서는 이미지 먼저 → 그 아래 본문 텍스트(발행과 동일).
                  const bakeAssets = slide.assets.filter((asset) => asset.kind === 'group_bake' && asset.signed_url);
                  const isLastSlide = slideIdx === selectedFunction.slides.length - 1;
                  return (
                    <div key={slide.id} style={styles.notionDoc}>
                      {bakeAssets.map((asset) => (
                        <img key={asset.id} src={asset.signed_url || ''} alt={asset.label} style={styles.bakeImage} />
                      ))}
                      {slide.blocks.length > 0 && <NotionBlocks blocks={slide.blocks} />}
                      {!isLastSlide && <div style={styles.divider} />}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div style={styles.emptyState}>좌측에서 기능을 선택하세요.</div>
            )}
          </div>
        </div>
      </div>

      {/* Preview Modal */}
      <Modal
        open={isPreviewOpen}
        onClose={() => setIsPreviewOpen(false)}
        title="발행 미리보기"
        subtitle="노션에 발행될 모습 그대로 페이지별로 미리 봅니다."
        size={1080}
        footer={
          <Button variant="default" onClick={() => setIsPreviewOpen(false)}>
            닫기
          </Button>
        }
      >
        {isPreviewLoading ? (
          <div style={{ ...styles.emptyState, gap: ps.sm }}>
            <Loader className="nm-spin" size={24} />
            <span>미리보기를 불러오는 중...</span>
          </div>
        ) : previewData ? (
          <div style={{ display: 'grid', gridTemplateColumns: '248px 1fr', height: '72vh', border: `1px solid ${sc.border.default}`, borderRadius: pr.lg, overflow: 'hidden' }}>
            {/* 좌: 페이지 네비게이션 */}
            <nav style={{ overflowY: 'auto', borderRight: `1px solid ${sc.border.default}`, background: sc.bg.layout, padding: `${ps.md}px ${ps.sm}px` }}>
              <div style={{ fontSize: st.fontSize, fontWeight: st.fontWeightStrong, color: sc.text.heading, padding: `0 ${ps.sm}px`, marginBottom: 2 }}>
                {previewData.pageTitle}
              </div>
              <div style={{ fontSize: st.fontSizeSM, color: sc.text.secondary, padding: `0 ${ps.sm}px`, marginBottom: ps.md }}>
                카테고리 {previewData.categoryCount} · 페이지 {previewData.functionCount}
              </div>
              {previewData.categories.map((category) => (
                <div key={category.id} style={{ marginBottom: ps.md }}>
                  <div style={{ fontSize: st.fontSizeSM, fontWeight: st.fontWeightStrong, color: sc.text.secondary, letterSpacing: 0.4, textTransform: 'uppercase', padding: `0 ${ps.sm}px`, marginBottom: ps.xs }}>
                    {category.title}
                  </div>
                  {category.functions.map((fn) => {
                    const active = fn.id === previewPageId;
                    return (
                      <button
                        key={fn.id}
                        type="button"
                        onClick={() => setPreviewPageId(fn.id)}
                        style={{
                          display: 'block',
                          width: '100%',
                          textAlign: 'left',
                          padding: `7px ${ps.sm}px`,
                          borderRadius: pr.base,
                          border: 'none',
                          borderLeft: `2px solid ${active ? sc.primary.default : 'transparent'}`,
                          cursor: 'pointer',
                          background: active ? sc.bg.container : 'transparent',
                          color: active ? sc.text.heading : sc.text.primary,
                          fontWeight: active ? st.fontWeightMedium : st.fontWeightRegular,
                          fontSize: st.fontSizeSM,
                          lineHeight: st.lineHeight,
                        }}
                      >
                        {norm(fn.title) === norm(category.title) ? '개요' : fn.title}
                      </button>
                    );
                  })}
                </div>
              ))}
            </nav>

            {/* 우: 선택한 페이지 본문 */}
            <div style={{ overflowY: 'auto', background: sc.bg.container }}>
              {(() => {
                const page = previewData.categories.flatMap((c) => c.functions).find((f) => f.id === previewPageId);
                if (!page) return <div style={{ color: sc.text.secondary, padding: ps.xl }}>좌측에서 페이지를 선택하세요.</div>;
                const pageCat = previewData.categories.find((c) => c.functions.some((f) => f.id === page.id));
                const pageTitle = norm(page.title) === norm(pageCat?.title) ? '개요' : page.title;
                return (
                  <div style={{ maxWidth: 720, margin: '0 auto', padding: `${ps.xl}px ${ps.xl}px ${ps.xxl || ps.xl}px` }}>
                    <h1 style={{ fontSize: st.fontSizeHeading3, fontWeight: st.fontWeightStrong, color: sc.text.heading, marginTop: 0, marginBottom: ps.lg }}>
                      {pageTitle}
                    </h1>
                    {page.blocks.length > 0 && <PreviewBlock_ blocks={page.blocks} />}
                    {page.images.length > 0 && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: ps.md, marginTop: ps.lg }}>
                        {page.images.map((img, idx) => (
                          <img key={idx} src={img.renderUrl} alt={img.label} style={{ maxWidth: '100%', borderRadius: pr.lg, border: `1px solid ${sc.border.default}` }} />
                        ))}
                      </div>
                    )}
                    {page.blocks.length === 0 && page.images.length === 0 && <div style={{ color: sc.text.secondary }}>이 페이지에 들어갈 내용이 없습니다.</div>}
                  </div>
                );
              })()}
            </div>
          </div>
        ) : (
          <div style={{ color: sc.text.secondary, textAlign: 'center', padding: ps.lg }}>미리보기 데이터를 불러올 수 없습니다.</div>
        )}
      </Modal>

      {/* Publishing progress modal */}
      <Modal
        open={isPublishingInProgress}
        onClose={() => {
          setIsPublishingInProgress(false);
          setPublishError(null);
        }}
        title={publishError ? '노션 발행 실패' : '노션 발행 중'}
        size="sm"
        footer={
          <Button
            variant="default"
            onClick={() => {
              setIsPublishingInProgress(false);
              setPublishError(null);
            }}
          >
            {publishError ? '닫기' : '취소'}
          </Button>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: ps.md, padding: ps.md }}>
          {publishError ? (
            <div style={{ padding: ps.md, background: sc.error.bg, borderRadius: pr.base, color: sc.error.text }}>
              {publishError}
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: ps.sm }}>
                <Loader className="nm-spin" size={20} />
                <span style={{ fontSize: st.fontSize, fontWeight: st.fontWeightMedium, color: sc.text.heading }}>발행 중...</span>
              </div>
              <div style={{ height: 8, borderRadius: pr.sm, background: sc.bg.elevated, overflow: 'hidden' }}>
                <div
                  className="nm-progress-active"
                  style={{
                    height: '100%',
                    width: '40%',
                    background: sc.primary.default,
                    borderRadius: pr.sm,
                    transition: 'width 300ms ease',
                  }}
                />
              </div>
            </>
          )}
        </div>
      </Modal>
    </main>
  );
}
