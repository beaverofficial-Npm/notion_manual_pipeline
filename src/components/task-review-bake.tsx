'use client';

import { Button, Card, Input, Modal, message, dialog, primitiveRadius, primitiveSpacing, semanticColors, semanticTypography } from '@sungbinhwang-beaverworksinc/design-system';
import { ArrowLeft, ChevronRight, Eye, Loader, Send } from 'lucide-react';
import type { CSSProperties } from 'react';
import { useEffect, useState } from 'react';

const ps = primitiveSpacing;
const pr = primitiveRadius;
const sc = semanticColors;
const st = semanticTypography;

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

interface Block {
  id: string;
  kind: string;
  content: unknown;
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
  children?: PreviewBlock[];
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
  slideItem: {
    display: 'grid',
    gap: ps.md,
    marginBottom: ps.lg,
    paddingBottom: ps.lg,
    borderBottom: `1px solid ${sc.border.default}`,
  },
  slideHeader: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: ps.sm,
  },
  slideTitle: {
    fontSize: st.fontSizeHeading5,
    fontWeight: st.fontWeightStrong,
    color: sc.text.heading,
    margin: 0,
  },
  slideNumber: {
    fontSize: st.fontSizeSM,
    color: sc.text.secondary,
    fontWeight: st.fontWeightMedium,
  },
  assetImage: {
    width: '100%',
    borderRadius: pr.lg,
    border: `1px solid ${sc.border.default}`,
    backgroundColor: sc.bg.elevated,
  },
  assetImageContainer: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 200,
    borderRadius: pr.lg,
    border: `1px solid ${sc.border.default}`,
    backgroundColor: sc.bg.elevated,
  },
  includeToggle: {
    display: 'flex',
    alignItems: 'center',
    gap: ps.xs,
    padding: `${ps.xs}px ${ps.sm}px`,
    borderRadius: pr.base,
    border: `1px solid ${sc.border.default}`,
    background: sc.bg.elevated,
    cursor: 'pointer',
  },
  blocksList: {
    display: 'grid',
    gap: ps.sm,
  },
  blockItem: {
    padding: ps.sm,
    background: sc.bg.elevated,
    border: `1px solid ${sc.border.default}`,
    borderRadius: pr.base,
    fontSize: st.fontSizeSM,
    color: sc.text.primary,
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
};

function renderBlockText(block: PreviewBlock): string {
  if (block.text) return block.text;
  if (block.kind === 'table' && block.rows) {
    return `[표 ${block.rows.length}행]`;
  }
  return '';
}

function BlockPreview({ blocks }: { blocks: PreviewBlock[] }) {
  if (!blocks.length) return null;
  return (
    <div style={styles.blocksList}>
      {blocks.map((block, idx) => (
        <div key={idx} style={styles.blockItem}>
          <div style={{ fontWeight: st.fontWeightMedium, marginBottom: ps.xs }}>
            {block.kind === 'numbered_list' ? '번호 목록' : block.kind === 'bulleted_list' ? '글머리 목록' : block.kind === 'callout' ? '주의' : block.kind === 'table' ? '표' : '단락'}
          </div>
          <div>{renderBlockText(block)}</div>
        </div>
      ))}
    </div>
  );
}

export function TaskReviewBake({ taskId }: TaskReviewBakeProps) {
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

  // tree 로드
  useEffect(() => {
    async function loadTree() {
      try {
        setLoading(true);
        const res = await fetch(`/api/tasks/${taskId}/tree`);
        if (!res.ok) throw new Error('트리를 불러오지 못했습니다.');
        const data = (await res.json()) as TreeResponse;
        setTree(data.tree);
        setTaskTitle(data.task.title);
        // 초기 선택: 첫 번째 함수
        const firstFn = data.tree[0]?.functions[0];
        if (firstFn) setSelectedFunctionId(firstFn.id);
        // 초기 포함 상태: 모두 포함
        const included: Record<string, boolean> = {};
        data.tree.forEach((cat) => {
          cat.functions.forEach((fn) => {
            included[fn.id] = fn.review_status !== 'excluded';
          });
        });
        setFunctionIncluded(included);
      } catch (err) {
        setError(err instanceof Error ? err.message : '알 수 없는 오류');
      } finally {
        setLoading(false);
      }
    }
    loadTree();
  }, [taskId]);

  // 현재 선택된 함수
  const selectedFunction = tree
    .flatMap((cat) => cat.functions)
    .find((fn) => fn.id === selectedFunctionId);

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

    try {
      setIsPublishingInProgress(true);
      setPublishError(null);

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
        throw new Error('발행 요청 실패');
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
          const event = JSON.parse(line);
          if (event.type === 'error') {
            setPublishError(event.message);
          }
        }
      }

      message.success('발행 완료');
      setIsPublishingInProgress(false);
    } catch (err) {
      setPublishError(err instanceof Error ? err.message : '발행 중 오류 발생');
      setIsPublishingInProgress(false);
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
          <Button variant="text" size="sm" icon={<ArrowLeft size={20} />} />
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
                    {fn.title}
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
              <div>
                {selectedFunction.slides.map((slide, slideIdx) => (
                  <div key={slide.id} style={styles.slideItem}>
                    {/* Slide header: 번호 + 제목 + 포함/제외 */}
                    <div style={styles.slideHeader}>
                      <div>
                        <h3 style={styles.slideTitle}>{slide.title || `슬라이드 ${slide.slide_number}`}</h3>
                        <div style={styles.slideNumber}>슬라이드 {slide.slide_number}</div>
                      </div>
                      <button
                        style={styles.includeToggle}
                        onClick={() => {
                          // TODO: 슬라이드 포함/제외 토글
                        }}
                      >
                        <Eye size={14} />
                        {/* {included ? '포함' : '제외'} */}
                      </button>
                    </div>

                    {/* group_bake 에셋 표시 */}
                    {slide.assets
                      .filter((asset) => asset.kind === 'group_bake' && asset.signed_url)
                      .map((asset) => (
                        <div key={asset.id}>
                          <img src={asset.signed_url || ''} alt={asset.label} style={styles.assetImage} />
                        </div>
                      ))}

                    {/* 텍스트 블록 표시 */}
                    {slide.blocks.length > 0 && (
                      <div>
                        <div style={{ fontSize: st.fontSizeSM, fontWeight: st.fontWeightMedium, marginBottom: ps.sm, color: sc.text.secondary }}>
                          노션 본문
                        </div>
                        {/* TODO: 블록 렌더 */}
                      </div>
                    )}
                  </div>
                ))}
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
                        {fn.title}
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
                return (
                  <div style={{ maxWidth: 720, margin: '0 auto', padding: `${ps.xl}px ${ps.xl}px ${ps.xxl || ps.xl}px` }}>
                    <h1 style={{ fontSize: st.fontSizeHeading3, fontWeight: st.fontWeightStrong, color: sc.text.heading, marginTop: 0, marginBottom: ps.lg }}>
                      {page.title}
                    </h1>
                    {page.blocks.length > 0 && <BlockPreview blocks={page.blocks} />}
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
        onClose={() => setIsPublishingInProgress(false)}
        title="노션 발행 중"
        size="sm"
        footer={
          <Button variant="default" onClick={() => setIsPublishingInProgress(false)}>
            취소
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
