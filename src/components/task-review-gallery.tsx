'use client';

import { Button, Card, Input, Modal, message, dialog, primitiveRadius, primitiveSpacing, semanticColors, semanticTypography } from '@sungbinhwang-beaverworksinc/design-system';
import { ArrowLeft, ChevronRight, Edit2, Eye, EyeOff, FileImage, FileText, Loader, Plus, Trash2, X } from 'lucide-react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';

const ps = primitiveSpacing;
const pr = primitiveRadius;
const sc = semanticColors;
const st = semanticTypography;


// Types
interface PercentBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface Asset {
  id: string;
  kind: string;
  label: string;
  crop_box: PercentBox | null;
  review_status: string;
  confidence: number | null;
  slide_id?: string;
  storage_path?: string | null;
  signed_url?: string | null;
}

interface Block {
  id: string;
  kind: string;
  content: unknown;
}

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

interface Task {
  id: string;
  title: string;
  status: string;
}

interface TreeResponse {
  task: Task;
  tree: Category[];
  excludedSlides: Slide[];
}

interface BlockContent {
  kind: 'numbered_list' | 'bulleted_list' | 'callout' | 'paragraph' | 'table';
  text?: string;
  children?: BlockContent[];
  rows?: string[][];
}

interface PreviewImage {
  renderUrl: string;
  cropBox: PercentBox;
  label: string;
}

interface PreviewBlock {
  kind: string;
  text?: string;
  children?: PreviewBlock[];
  rows?: string[][];
}

interface PreviewFunction {
  id: string;
  title: string;
  slideCount: number;
  blocks: PreviewBlock[];
  images: PreviewImage[];
}

interface PreviewCategory {
  id: string;
  title: string;
  functions: PreviewFunction[];
}

interface PublishPreview {
  parentPageId: string;
  pageTitle: string;
  categoryCount: number;
  functionCount: number;
  categories: PreviewCategory[];
}

interface CropInteraction {
  assetId: string;
  mode: 'move' | 'resize';
  startX: number;
  startY: number;
  startBox: PercentBox;
  container: HTMLElement | null;
}

interface TaskReviewGalleryProps {
  taskId: string;
}

// Styles
const styles = {
  shell: {
    width: '100%',
    height: '100vh',
    display: 'flex',
    flexDirection: 'column' as const,
    overflow: 'hidden',
    background: sc.bg.layout,
  } as CSSProperties,
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: ps.sm,
    padding: `${ps.lg}px ${ps.lg}px`,
    borderBottom: `1px solid ${sc.border.default}`,
    background: sc.bg.container,
    flexShrink: 0,
  } as CSSProperties,
  headerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: ps.md,
    minWidth: 0,
  } as CSSProperties,
  headerRight: {
    display: 'flex',
    alignItems: 'center',
    gap: ps.sm,
    flexWrap: 'wrap',
  } as CSSProperties,
  title: {
    margin: 0,
    color: sc.text.heading,
    fontSize: st.fontSizeHeading4,
    fontWeight: st.fontWeightStrong,
    lineHeight: st.lineHeightHeading4,
  } as CSSProperties,
  mainContent: {
    flex: 1,
    minHeight: 0,
    display: 'grid',
    gridTemplateColumns: '280px 1fr',
    gap: ps.sm,
    padding: ps.sm,
    overflow: 'hidden',
  } as CSSProperties,
  sidebar: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 2,
  } as CSSProperties,
  content: {
    display: 'flex',
    flexDirection: 'column' as const,
    minHeight: 0,
    height: '100%',
  } as CSSProperties,
  treeNode: {
    display: 'grid',
    gap: ps.xxs,
    minWidth: 0,
  } as CSSProperties,
  treeRow: {
    display: 'flex',
    alignItems: 'center',
    gap: ps.xxs,
    minWidth: 0,
  } as CSSProperties,
  panel: {
    display: 'flex',
    flexDirection: 'column' as const,
    minHeight: 0,
    height: '100%',
    background: sc.bg.container,
    border: `1px solid ${sc.border.default}`,
    borderRadius: pr.lg,
    overflow: 'hidden',
  } as CSSProperties,
  panelHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: ps.sm,
    padding: `${ps.sm}px ${ps.md}px`,
    borderBottom: `1px solid ${sc.border.default}`,
    flexShrink: 0,
    minHeight: 48,
  } as CSSProperties,
  panelTitle: {
    fontSize: st.fontSizeHeading5,
    lineHeight: st.lineHeightHeading5,
    fontWeight: st.fontWeightStrong,
    color: sc.text.heading,
  } as CSSProperties,
  panelBody: {
    flex: 1,
    minHeight: 0,
    overflowY: 'auto' as const,
    overflowX: 'hidden' as const,
    padding: ps.md,
  } as CSSProperties,
  excludedRow: {
    display: 'flex',
    alignItems: 'center',
    gap: ps.md,
    padding: ps.sm,
    border: `1px solid ${sc.border.default}`,
    borderRadius: pr.base,
    background: sc.bg.layout,
  } as CSSProperties,
  excludedThumb: {
    flexShrink: 0,
    width: 220,
    aspectRatio: '16 / 9',
    objectFit: 'contain' as const,
    background: sc.bg.elevated,
    border: `1px solid ${sc.border.default}`,
    borderRadius: pr.sm,
  } as CSSProperties,
  excludedThumbEmpty: {
    flexShrink: 0,
    width: 220,
    aspectRatio: '16 / 9',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: sc.bg.elevated,
    border: `1px solid ${sc.border.default}`,
    borderRadius: pr.sm,
    color: sc.text.secondary,
  } as CSSProperties,
  categoryItem: {
    display: 'flex',
    alignItems: 'center',
    gap: ps.xs,
    width: '100%',
    minWidth: 0,
    boxSizing: 'border-box' as const,
    padding: `${ps.xs}px ${ps.sm}px`,
    background: 'transparent',
    border: 'none',
    borderRadius: pr.base,
    cursor: 'pointer',
    color: sc.text.heading,
    fontSize: st.fontSize,
    fontWeight: st.fontWeightStrong,
    lineHeight: st.lineHeight,
    textAlign: 'left' as const,
  } as CSSProperties,
  categoryExpanded: {
    background: 'transparent',
  } as CSSProperties,
  functionItem: {
    display: 'flex',
    alignItems: 'center',
    gap: ps.xs,
    width: '100%',
    minWidth: 0,
    boxSizing: 'border-box' as const,
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
    textAlign: 'left' as const,
  } as CSSProperties,
  functionItemSelected: {
    background: sc.primary.bg,
    color: sc.primary.default,
    borderLeft: `2px solid ${sc.primary.default}`,
    fontWeight: st.fontWeightMedium,
  } as CSSProperties,
  editable: {
    minWidth: 0,
    flex: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  } as CSSProperties,
  editInput: {
    width: '100%',
    height: 32,
    padding: `0 ${ps.xs}px`,
    color: sc.text.primary,
    background: sc.bg.container,
    border: `1px solid ${sc.primary.border}`,
    borderRadius: pr.sm,
    fontSize: 'inherit',
    outline: 'none',
  } as CSSProperties,
  slideCard: {
    display: 'grid',
    gap: ps.sm,
  } as CSSProperties,
  slideImageContainer: {
    position: 'relative',
    overflow: 'hidden',
    aspectRatio: '16 / 9',
    background: sc.bg.elevated,
    border: `1px solid ${sc.border.default}`,
    borderRadius: pr.lg,
  } as CSSProperties,
  image: {
    width: '100%',
    height: '100%',
    objectFit: 'contain',
    display: 'block',
  } as CSSProperties,
  imageFallback: {
    width: '100%',
    height: '100%',
    display: 'grid',
    placeItems: 'center',
    color: sc.text.secondary,
  } as CSSProperties,
  cropOverlay: {
    position: 'absolute',
    border: `2px solid ${sc.primary.border}`,
    background: 'transparent',
    borderRadius: pr.base,
    cursor: 'move',
    padding: 0,
    touchAction: 'none',
    zIndex: 2,
  } as CSSProperties,
  selectedCropOverlay: {
    border: `2.5px solid ${sc.primary.default}`,
    boxShadow: `0 0 0 3px ${sc.primary.bg}`,
    zIndex: 3,
  } as CSSProperties,
  cropLabel: {
    position: 'absolute',
    left: 0,
    top: 0,
    height: 20,
    display: 'inline-flex',
    alignItems: 'center',
    padding: `0 ${ps.xs}px`,
    color: sc.text.lightSolid,
    background: sc.bg.mask,
    borderRadius: pr.sm,
    fontSize: st.fontSizeSM,
    fontWeight: st.fontWeightMedium,
    lineHeight: st.lineHeightSM,
    whiteSpace: 'nowrap',
    zIndex: 4,
  } as CSSProperties,
  cropLabelSelected: {
    background: sc.primary.default,
  } as CSSProperties,
  resizeHandle: {
    position: 'absolute',
    right: -7,
    bottom: -7,
    width: 16,
    height: 16,
    background: sc.bg.container,
    border: `2px solid ${sc.warning.default}`,
    borderRadius: pr.full,
    cursor: 'nwse-resize',
    touchAction: 'none',
  } as CSSProperties,
  assetList: {
    display: 'grid',
    gap: ps.xs,
  } as CSSProperties,
  assetItem: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: ps.xs,
    padding: `${ps.xs}px ${ps.sm}px`,
    background: sc.bg.elevated,
    border: `1px solid ${sc.border.default}`,
    borderRadius: pr.base,
    cursor: 'pointer',
    color: sc.text.primary,
    fontSize: st.fontSizeSM,
    lineHeight: st.lineHeightSM,
  } as CSSProperties,
  assetItemSelected: {
    borderColor: sc.primary.border,
    background: sc.primary.bg,
  } as CSSProperties,
  assetLabel: {
    minWidth: 0,
    flex: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  } as CSSProperties,
  assetRow: {
    display: 'flex',
    alignItems: 'center',
    gap: ps.xs,
    padding: `4px 4px 4px ${ps.sm}px`,
    background: sc.bg.container,
    border: `1px solid ${sc.border.default}`,
    borderRadius: pr.base,
    cursor: 'pointer',
  } as CSSProperties,
  assetRowSelected: {
    background: sc.primary.bg,
    border: `1px solid ${sc.primary.default}`,
  } as CSSProperties,
  assetNameInput: {
    flex: 1,
    minWidth: 0,
    height: 32,
    padding: `0 ${ps.sm}px`,
    border: '1px solid transparent',
    borderRadius: pr.sm,
    background: 'transparent',
    color: sc.text.primary,
    fontSize: st.fontSize,
    outline: 'none',
    WebkitAppearance: 'none' as const,
    boxShadow: 'none',
  } as CSSProperties,
  assetNameInputFocused: {
    borderColor: sc.primary.border,
    background: sc.bg.container,
  } as CSSProperties,
  assetIconBtn: {
    flexShrink: 0,
    width: 28,
    height: 28,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: 'none',
    background: 'transparent',
    borderRadius: pr.sm,
    color: sc.text.secondary,
    cursor: 'pointer',
  } as CSSProperties,
  blocksList: {
    display: 'grid',
    gap: ps.xs,
  } as CSSProperties,
  blockItem: {
    display: 'grid',
    gap: ps.xxs,
    padding: ps.sm,
    background: sc.bg.elevated,
    border: `1px solid ${sc.border.default}`,
    borderRadius: pr.base,
    fontSize: st.fontSizeSM,
    lineHeight: st.lineHeightSM,
    color: sc.text.secondary,
  } as CSSProperties,
  blockKind: {
    color: sc.text.primary,
    fontWeight: st.fontWeightMedium,
  } as CSSProperties,
  blockIndent: {
    paddingLeft: ps.lg,
    color: sc.text.secondary,
  } as CSSProperties,
  calloutBlock: {
    padding: ps.sm,
    background: sc.primary.bg,
    borderLeft: `3px solid ${sc.primary.default}`,
    borderRadius: pr.base,
  } as CSSProperties,
  tableBlock: {
    width: '100%',
    borderCollapse: 'collapse' as const,
    border: `1px solid ${sc.border.default}`,
  } as CSSProperties,
  tableCellBlock: {
    border: `1px solid ${sc.border.default}`,
    padding: ps.xs,
    textAlign: 'left' as const,
    fontSize: st.fontSizeSM,
  } as CSSProperties,
  slideGridLayout: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: ps.md,
    minHeight: 0,
  } as CSSProperties,
  editorRow: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
    gap: ps.md,
    alignItems: 'start',
  } as CSSProperties,
  cropContainer: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: ps.sm,
    minWidth: 0,
  } as CSSProperties,
  blocksContainer: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: ps.sm,
    minWidth: 0,
  } as CSSProperties,
  functionHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: ps.sm,
    minHeight: 32,
  } as CSSProperties,
  functionHeaderTitle: {
    fontSize: st.fontSize,
    lineHeight: st.lineHeight,
    fontWeight: st.fontWeightStrong,
    color: sc.text.heading,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  } as CSSProperties,
  previewModal: {
    maxHeight: '80vh',
    overflowY: 'auto' as const,
  } as CSSProperties,
  previewCategory: {
    marginBottom: ps.lg,
    paddingBottom: ps.lg,
    borderBottom: `1px solid ${sc.border.default}`,
  } as CSSProperties,
  previewCategoryTitle: {
    fontSize: st.fontSizeHeading5,
    fontWeight: st.fontWeightStrong,
    color: sc.text.heading,
    marginBottom: ps.md,
    padding: ps.sm,
    background: sc.bg.elevated,
    borderRadius: pr.base,
  } as CSSProperties,
  previewFunctionBlock: {
    marginBottom: ps.md,
    paddingLeft: ps.lg,
  } as CSSProperties,
  previewFunctionTitle: {
    fontSize: st.fontSize,
    fontWeight: st.fontWeightMedium,
    color: sc.text.primary,
    marginBottom: ps.sm,
  } as CSSProperties,
  cropThumbnail: {
    overflow: 'hidden' as const,
    borderRadius: pr.base,
    border: `1px solid ${sc.border.default}`,
    background: sc.bg.elevated,
    marginBottom: ps.xs,
  } as CSSProperties,
  cropThumbnailImg: {
    position: 'absolute' as const,
    maxWidth: 'none',
  } as CSSProperties,
  propertyGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, 1fr)',
    gap: ps.xs,
  } as CSSProperties,
  propertyField: {
    display: 'grid',
    gap: ps.xxs,
  } as CSSProperties,
  propertyLabel: {
    color: sc.text.label,
    fontSize: st.fontSizeSM,
    fontWeight: st.fontWeightMedium,
    lineHeight: st.lineHeightSM,
  } as CSSProperties,
  propertyValue: {
    color: sc.text.primary,
    fontSize: st.fontSizeSM,
    lineHeight: st.lineHeightSM,
    padding: `${ps.xs}px`,
    background: sc.bg.container,
    border: `1px solid ${sc.border.default}`,
    borderRadius: pr.base,
  } as CSSProperties,
  excludedOverlay: {
    opacity: 0.5,
  } as CSSProperties,
  toolbar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: ps.sm,
    flexWrap: 'wrap',
  } as CSSProperties,
  emptyState: {
    display: 'grid',
    placeItems: 'center',
    minHeight: 200,
    color: sc.text.secondary,
    fontSize: st.fontSize,
    lineHeight: st.lineHeight,
    textAlign: 'center',
  } as CSSProperties,
  loadingState: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    justifyContent: 'center',
    gap: ps.sm,
    minHeight: '100vh',
    color: sc.text.secondary,
    fontSize: st.fontSize,
  } as CSSProperties,
};

function defaultCropBox(): PercentBox {
  return { left: 12, top: 18, width: 76, height: 56 };
}

function normalizeCropBox(value: unknown): PercentBox {
  if (!value || typeof value !== 'object') return defaultCropBox();

  const source = value as Record<string, unknown>;
  const left = Number(source.left);
  const top = Number(source.top);
  const width = Number(source.width);
  const height = Number(source.height);

  if ([left, top, width, height].some((item) => Number.isNaN(item))) {
    return defaultCropBox();
  }

  return {
    left: Math.max(0, Math.min(100, left)),
    top: Math.max(0, Math.min(100, top)),
    width: Math.max(1, Math.min(100, width)),
    height: Math.max(1, Math.min(100, height)),
  };
}

function roundBox(box: PercentBox): PercentBox {
  return {
    left: Math.round(box.left * 10) / 10,
    top: Math.round(box.top * 10) / 10,
    width: Math.round(box.width * 10) / 10,
    height: Math.round(box.height * 10) / 10,
  };
}

function renderBlockPreview(block: Block): string {
  const content = block.content as Record<string, unknown> | null;
  if (!content) return '';

  if (typeof content.text === 'string') {
    return content.text;
  }

  if (typeof content === 'string') {
    return content;
  }

  return '';
}

function renderBlockContent(block: BlockContent | Block, depth: number = 0): React.ReactNode {
  const content = 'content' in block ? block.content : block;
  if (!content || typeof content !== 'object') return null;

  const blockData = content as BlockContent;
  const { kind, text, children = [], rows = [] } = blockData;

  const indentStyle: CSSProperties = {
    paddingLeft: `${depth * ps.lg}px`,
  };

  switch (kind) {
    case 'numbered_list':
      return (
        <ol style={{ ...indentStyle, margin: 0, paddingLeft: `${(depth + 1) * ps.lg}px` }}>
          <li style={{ color: sc.text.primary, fontSize: st.fontSizeSM }}>{text}</li>
          {children && children.map((child, idx) => <li key={idx}>{renderBlockContent(child, depth)}</li>)}
        </ol>
      );

    case 'bulleted_list':
      return (
        <ul style={{ ...indentStyle, margin: 0, paddingLeft: `${(depth + 1) * ps.lg}px` }}>
          <li style={{ color: sc.text.primary, fontSize: st.fontSizeSM }}>{text}</li>
          {children && children.map((child, idx) => <li key={idx}>{renderBlockContent(child, depth)}</li>)}
        </ul>
      );

    case 'callout':
      return (
        <div style={{ ...styles.calloutBlock, marginLeft: `${depth * ps.lg}px` }}>
          <div style={{ fontSize: st.fontSizeSM, color: sc.text.primary }}>{text}</div>
          {children && children.map((child, idx) => <div key={idx}>{renderBlockContent(child, depth + 1)}</div>)}
        </div>
      );

    case 'table':
      return (
        <div style={{ overflowX: 'auto' as const, marginLeft: `${depth * ps.lg}px` }}>
          <table style={styles.tableBlock}>
            <tbody>
              {rows.map((row, rowIdx) => (
                <tr key={rowIdx}>
                  {row.map((cell, cellIdx) => (
                    <td key={cellIdx} style={styles.tableCellBlock}>
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );

    case 'paragraph':
    default:
      return (
        <div style={{ ...indentStyle, color: sc.text.primary, fontSize: st.fontSizeSM }}>
          {text}
          {children && children.map((child, idx) => <div key={idx}>{renderBlockContent(child, depth)}</div>)}
        </div>
      );
  }
}

function renderStepChild(child: { kind: string; text?: string }, key: number): React.ReactNode {
  const childText = child.text ?? '';
  if (child.kind === 'callout') {
    return (
      <div key={key} style={{ ...styles.calloutBlock, marginTop: ps.xs }}>
        <div style={{ fontSize: st.fontSizeSM, color: sc.text.primary }}>{childText}</div>
      </div>
    );
  }
  if (child.kind === 'bulleted') {
    return (
      <div key={key} style={{ display: 'flex', gap: ps.xs, marginTop: 2, color: sc.text.secondary, fontSize: st.fontSizeSM }}>
        <span style={{ flexShrink: 0 }}>•</span>
        <span>{childText}</span>
      </div>
    );
  }
  return (
    <div key={key} style={{ marginTop: 2, color: sc.text.secondary, fontSize: st.fontSizeSM }}>
      {childText}
    </div>
  );
}

// 블록 배열을 노션 본문처럼 렌더한다. 연속한 단계는 1,2,3… 으로 번호를 이어 붙인다.
function BlockList({ blocks, startNumber = 0 }: { blocks: Array<Block | BlockContent | PreviewBlock>; startNumber?: number }): React.ReactNode {
  let step = startNumber;
  return (
    <div style={styles.blocksList}>
      {blocks.map((raw, index) => {
        const content = (raw && typeof raw === 'object' && 'content' in raw ? raw.content : raw) as BlockContent | null;
        if (!content || typeof content !== 'object') return null;
        const { kind, text, children = [] } = content;

        if (kind === 'numbered_list') {
          step += 1;
          return (
            <div key={index} style={styles.blockItem}>
              <div style={{ display: 'flex', gap: ps.xs, color: sc.text.primary, fontSize: st.fontSizeSM }}>
                <span style={{ fontWeight: st.fontWeightMedium, flexShrink: 0 }}>{step}.</span>
                <span>{text}</span>
              </div>
              <div style={{ marginLeft: ps.lg }}>{children.map((child, idx) => renderStepChild(child, idx))}</div>
            </div>
          );
        }

        return (
          <div key={index} style={styles.blockItem}>
            {renderBlockContent(content)}
          </div>
        );
      })}
    </div>
  );
}

// 노션 본문에 들어갈 이미지를 실제 렌더에 가깝게 크게 보여준다(렌더는 16:9 기준).
function renderCropThumbnail(cropBox: PercentBox | null, renderUrl: string | null, label: string): React.ReactNode {
  if (!renderUrl || !cropBox) return null;

  const box = normalizeCropBox(cropBox);
  const aspect = (box.width * 16) / (box.height * 9); // 가로/세로 비율(px 기준)
  let w: number;
  let h: number;
  if (aspect >= 1) {
    w = 600;
    h = Math.round(w / aspect);
  } else {
    h = 460;
    w = Math.round(h * aspect);
  }

  return (
    <div
      key={`${renderUrl}-${label}`}
      style={{
        width: w,
        maxWidth: '100%',
        height: h,
        position: 'relative' as const,
        overflow: 'hidden',
        borderRadius: pr.base,
        border: `1px solid ${sc.border.default}`,
        background: sc.bg.elevated,
      }}
    >
      <img
        src={renderUrl}
        alt={label}
        style={{
          position: 'absolute',
          maxWidth: 'none',
          width: `${10000 / box.width}%`,
          height: `${10000 / box.height}%`,
          left: `${-box.left * 100 / box.width}%`,
          top: `${-box.top * 100 / box.height}%`,
        }}
      />
    </div>
  );
}

export function TaskReviewGallery({ taskId }: TaskReviewGalleryProps) {
  const [tree, setTree] = useState<Category[]>([]);
  const [task, setTask] = useState<Task | null>(null);
  const [excludedSlides, setExcludedSlides] = useState<Slide[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const [selectedFunctionId, setSelectedFunctionId] = useState('');
  const [selectedAssetId, setSelectedAssetId] = useState('');
  const [editingCategoryId, setEditingCategoryId] = useState('');
  const [editingFunctionId, setEditingFunctionId] = useState('');
  const [editValueCategory, setEditValueCategory] = useState('');
  const [editValueFunction, setEditValueFunction] = useState('');

  const [isSaving, setIsSaving] = useState(false);
  const [interaction, setInteraction] = useState<CropInteraction | null>(null);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [previewData, setPreviewData] = useState<PublishPreview | null>(null);
  const [previewPageId, setPreviewPageId] = useState('');
  const [isExcludedOpen, setIsExcludedOpen] = useState(false);
  const [editingAssetId, setEditingAssetId] = useState('');
  const dragBoxRef = useRef<PercentBox | null>(null);
  const publishAbortRef = useRef<AbortController | null>(null);
  const [publishResult, setPublishResult] = useState<{ pageId?: string; url?: string; functionCount?: number; imageCount?: number } | null>(null);
  const [isPublishing, setIsPublishing] = useState(false);
  const [isPublishingInProgress, setIsPublishingInProgress] = useState(false);
  const [publishProgress, setPublishProgress] = useState<{ done: number; total: number; label: string } | null>(null);
  const [showPublishResult, setShowPublishResult] = useState(false);

  // Load tree data
  useEffect(() => {
    let cancelled = false;

    async function loadTree() {
      setIsLoading(true);
      setError('');

      try {
        const response = await fetch(`/api/tasks/${taskId}/tree`);
        if (!response.ok) {
          throw new Error('트리 데이터를 불러오지 못했습니다.');
        }

        const result = (await response.json()) as TreeResponse;
        if (!cancelled) {
          setTask(result.task);
          setTree(result.tree);
          setExcludedSlides(result.excludedSlides);

          // Initialize selections
          if (result.tree.length > 0 && result.tree[0].functions.length > 0) {
            const firstFunction = result.tree[0].functions[0];
            setSelectedFunctionId(firstFunction.id);
            setExpandedCategories(new Set([result.tree[0].id]));
            if (firstFunction.slides.length > 0) {
              setSelectedAssetId(firstFunction.slides[0].assets[0]?.id || '');
            }
          }
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : '데이터를 불러오지 못했습니다.');
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    loadTree();
    return () => {
      cancelled = true;
    };
  }, [taskId]);

  // 제외된 페이지를 다시 포함(기능 또는 미분류 슬라이드)
  async function includeExcluded(kind: 'function' | 'slide', id: string) {
    try {
      const path = kind === 'function' ? `/api/functions/${id}` : `/api/slides/${id}`;
      const response = await fetch(path, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ review_status: 'pending' }),
      });
      if (!response.ok) throw new Error('포함 처리에 실패했습니다.');
      message.success('페이지를 포함했습니다.');
      await refreshTree();
    } catch (err) {
      message.error(err instanceof Error ? err.message : '포함 처리에 실패했습니다.');
    }
  }

  // 선택 상태를 유지한 채 트리/제외 목록만 갱신한다.
  async function refreshTree() {
    try {
      const response = await fetch(`/api/tasks/${taskId}/tree`);
      if (!response.ok) return;
      const result = (await response.json()) as TreeResponse;
      setTask(result.task);
      setTree(result.tree);
      setExcludedSlides(result.excludedSlides);
    } catch {
      // 무시: 다음 액션에서 다시 시도
    }
  }

  // 크롭 좌표만 DB에 즉시 저장(드래그/리사이즈 종료 시). 다른 편집과 동일하게 자동 저장된다.
  async function persistCropBox(assetId: string, box: PercentBox) {
    try {
      const response = await fetch(`/api/assets/${assetId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ crop_box: normalizeCropBox(box), review_status: 'approved' }),
      });
      if (!response.ok) throw new Error('영역 위치를 저장하지 못했습니다.');
      message.success('영역을 저장했습니다.');
    } catch (err) {
      message.error(err instanceof Error ? err.message : '영역 위치를 저장하지 못했습니다.');
    }
  }

  // Pointer interaction for crop dragging
  useEffect(() => {
    if (!interaction) return;
    const activeInteraction = interaction;

    function handlePointerMove(event: PointerEvent) {
      const rect = activeInteraction.container?.getBoundingClientRect();
      if (!rect) return;

      const deltaX = ((event.clientX - activeInteraction.startX) / rect.width) * 100;
      const deltaY = ((event.clientY - activeInteraction.startY) / rect.height) * 100;
      const start = activeInteraction.startBox;
      const nextBox =
        activeInteraction.mode === 'move'
          ? normalizeCropBox({
              ...start,
              left: Math.max(0, Math.min(100 - start.width, start.left + deltaX)),
              top: Math.max(0, Math.min(100 - start.height, start.top + deltaY)),
            })
          : normalizeCropBox({
              ...start,
              width: Math.max(3, Math.min(100 - start.left, start.width + deltaX)),
              height: Math.max(3, Math.min(100 - start.top, start.height + deltaY)),
            });

      const rounded = roundBox(nextBox);
      dragBoxRef.current = rounded;
      updateAssetInTree(activeInteraction.assetId, (asset) => ({
        ...asset,
        crop_box: rounded,
      }));
    }

    function handlePointerUp() {
      const finalBox = dragBoxRef.current;
      dragBoxRef.current = null;
      setInteraction(null);
      if (finalBox) {
        void persistCropBox(activeInteraction.assetId, finalBox);
      }
    }

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [interaction]);


  function updateAssetInTree(assetId: string, updater: (asset: Asset) => Asset) {
    setTree((current) =>
      current.map((category) => ({
        ...category,
        functions: category.functions.map((fn) => ({
          ...fn,
          slides: fn.slides.map((slide) => ({
            ...slide,
            assets: slide.assets.map((asset) => (asset.id === assetId ? updater(asset) : asset)),
          })),
        })),
      }))
    );
  }

  function updateSlideInTree(slideId: string, updater: (slide: Slide) => Slide) {
    setTree((current) =>
      current.map((category) => ({
        ...category,
        functions: category.functions.map((fn) => ({
          ...fn,
          slides: fn.slides.map((slide) => (slide.id === slideId ? updater(slide) : slide)),
        })),
      }))
    );
  }

  function toggleCategoryExpanded(categoryId: string) {
    setExpandedCategories((current) => {
      const next = new Set(current);
      if (next.has(categoryId)) {
        next.delete(categoryId);
      } else {
        next.add(categoryId);
      }
      return next;
    });
  }

  function selectFunction(functionId: string) {
    setSelectedFunctionId(functionId);
    setSelectedAssetId('');
  }

  // Get current slide and asset
  const selectedSlides: Slide[] = [];
  let selectedFunction: Function | null = null;
  for (const category of tree) {
    for (const fn of category.functions) {
      if (fn.id === selectedFunctionId) {
        selectedFunction = fn;
        selectedSlides.push(...fn.slides);
        break;
      }
    }
    if (selectedFunction) break;
  }

  const selectedSlide = selectedSlides.find((s) => s.assets.some((a) => a.id === selectedAssetId)) || selectedSlides[0] || null;
  const selectedAsset = selectedSlide?.assets.find((a) => a.id === selectedAssetId) || null;

  // 단계 번호가 페이지(기능) 전체로 이어지도록 슬라이드별 시작 번호를 계산(발행 결과와 일치).
  const slideStepOffsets: number[] = [];
  {
    let acc = 0;
    for (const s of selectedSlides) {
      slideStepOffsets.push(acc);
      acc += s.blocks.filter((b) => b.kind === 'numbered_list').length;
    }
  }

  async function handleUpdateCategoryTitle(categoryId: string, newTitle: string) {
    if (!newTitle.trim()) {
      setEditingCategoryId('');
      return;
    }

    setIsSaving(true);
    try {
      const response = await fetch(`/api/categories/${categoryId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: newTitle }),
      });

      if (!response.ok) {
        throw new Error('카테고리명을 저장하지 못했습니다.');
      }

      setTree((current) =>
        current.map((cat) => (cat.id === categoryId ? { ...cat, title: newTitle } : cat))
      );
      message.success('카테고리명을 저장했습니다.');
      setEditingCategoryId('');
    } catch (err) {
      message.error(err instanceof Error ? err.message : '오류가 발생했습니다.');
    } finally {
      setIsSaving(false);
    }
  }

  async function handleUpdateFunctionTitle(functionId: string, newTitle: string) {
    if (!newTitle.trim()) {
      setEditingFunctionId('');
      return;
    }

    setIsSaving(true);
    try {
      const response = await fetch(`/api/functions/${functionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: newTitle }),
      });

      if (!response.ok) {
        throw new Error('기능명을 저장하지 못했습니다.');
      }

      setTree((current) =>
        current.map((category) => ({
          ...category,
          functions: category.functions.map((fn) =>
            fn.id === functionId ? { ...fn, title: newTitle } : fn
          ),
        }))
      );
      message.success('기능명을 저장했습니다.');
      setEditingFunctionId('');
    } catch (err) {
      message.error(err instanceof Error ? err.message : '오류가 발생했습니다.');
    } finally {
      setIsSaving(false);
    }
  }

  async function handleAddAsset(slideId: string) {
    if (!slideId || isSaving) return;

    setIsSaving(true);
    try {
      const response = await fetch(`/api/slides/${slideId}/assets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label: '수동 추가 영역',
          kind: 'screenshot',
          crop_box: defaultCropBox(),
        }),
      });

      const result = (await response.json()) as { asset?: Asset };

      if (!response.ok || !result.asset) {
        throw new Error('영역을 추가하지 못했습니다.');
      }

      const newAsset = {
        ...result.asset,
        crop_box: normalizeCropBox(result.asset.crop_box),
      };

      updateSlideInTree(slideId, (slide) => ({
        ...slide,
        assets: [...slide.assets, newAsset],
      }));

      setSelectedAssetId(newAsset.id);
      message.success('영역을 추가했습니다.');
    } catch (err) {
      message.error(err instanceof Error ? err.message : '영역을 추가하지 못했습니다.');
    } finally {
      setIsSaving(false);
    }
  }

  async function handleSaveAsset(asset: Asset) {
    if (!selectedSlide || isSaving) return;

    setIsSaving(true);
    try {
      const response = await fetch(`/api/assets/${asset.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label: asset.label,
          kind: asset.kind,
          crop_box: normalizeCropBox(asset.crop_box),
          review_status: 'approved',
        }),
      });

      const result = (await response.json()) as { asset?: Asset };

      if (!response.ok || !result.asset) {
        throw new Error('영역을 저장하지 못했습니다.');
      }

      const savedAsset = {
        ...result.asset,
        crop_box: normalizeCropBox(result.asset.crop_box),
      };

      updateSlideInTree(selectedSlide.id, (slide) => ({
        ...slide,
        assets: slide.assets.map((item) => (item.id === savedAsset.id ? savedAsset : item)),
      }));

      message.success('영역을 저장했습니다.');
    } catch (err) {
      message.error(err instanceof Error ? err.message : '영역을 저장하지 못했습니다.');
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDeleteAsset(assetId: string) {
    setIsSaving(true);
    try {
      const response = await fetch(`/api/assets/${assetId}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        throw new Error('영역을 삭제하지 못했습니다.');
      }

      if (selectedSlide) {
        updateSlideInTree(selectedSlide.id, (slide) => ({
          ...slide,
          assets: slide.assets.filter((a) => a.id !== assetId),
        }));
      }

      setSelectedAssetId('');
      message.success('영역을 삭제했습니다.');
    } catch (err) {
      message.error(err instanceof Error ? err.message : '영역을 삭제하지 못했습니다.');
    } finally {
      setIsSaving(false);
    }
  }

  async function handleSlideExclude(slideId: string) {
    setIsSaving(true);
    try {
      const response = await fetch(`/api/slides/${slideId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ review_status: 'excluded' }),
      });

      if (!response.ok) {
        throw new Error('슬라이드를 제외하지 못했습니다.');
      }

      updateSlideInTree(slideId, (slide) => ({
        ...slide,
        review_status: 'excluded',
      }));

      message.success('슬라이드를 제외했습니다.');
    } catch (err) {
      message.error(err instanceof Error ? err.message : '슬라이드를 제외하지 못했습니다.');
    } finally {
      setIsSaving(false);
    }
  }

  async function handleOpenPreview() {
    setIsPreviewOpen(true);
    setIsPreviewLoading(true);
    setPreviewData(null);

    try {
      const response = await fetch(`/api/tasks/${taskId}/publish/preview`, {
        method: 'POST',
      });

      if (!response.ok) {
        throw new Error('미리보기를 불러오지 못했습니다.');
      }

      const result = (await response.json()) as { preview?: PublishPreview };
      if (result.preview) {
        setPreviewData(result.preview);
        const firstFn = result.preview.categories.flatMap((c) => c.functions)[0];
        setPreviewPageId(firstFn?.id ?? '');
      } else {
        throw new Error('미리보기 데이터가 없습니다.');
      }
    } catch (err) {
      message.error(err instanceof Error ? err.message : '미리보기를 불러오지 못했습니다.');
      setIsPreviewOpen(false);
    } finally {
      setIsPreviewLoading(false);
    }
  }

  function cancelPublish() {
    publishAbortRef.current?.abort();
  }

  async function runPublish() {
    setIsPublishingInProgress(true);
    setPublishProgress(null);
    const controller = new AbortController();
    publishAbortRef.current = controller;
    try {
      const response = await fetch(`/api/tasks/${taskId}/publish`, { method: 'POST', signal: controller.signal });
      if (!response.ok || !response.body) throw new Error('발행 요청에 실패했습니다.');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let finalResult: typeof publishResult = null;
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
            | { type: 'done'; result: typeof publishResult }
            | { type: 'error'; message: string };
          if (ev.type === 'progress') setPublishProgress(ev.progress);
          else if (ev.type === 'done') finalResult = ev.result;
          else if (ev.type === 'error') errorMsg = ev.message;
        }
      }

      if (errorMsg) throw new Error(errorMsg);
      if (!finalResult) throw new Error('발행 결과가 없습니다.');
      setPublishResult(finalResult);
      setShowPublishResult(true);
      message.success('노션으로 발행했습니다.');
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        message.info('발행을 취소했습니다.');
      } else {
        message.error(err instanceof Error ? err.message : '발행을 실패했습니다.');
      }
    } finally {
      publishAbortRef.current = null;
      setIsPublishingInProgress(false);
      setPublishProgress(null);
    }
  }

  function handlePublish() {
    dialog.confirm({
      title: '노션으로 발행',
      content: '현재 상태를 노션으로 발행하시겠습니까? 확정된 영역과 페이지 구성이 노션에 생성됩니다.',
      // onOk 는 즉시 반환 → 다이얼로그가 바로 닫히고, 발행은 진행 모달에서 따로 진행된다.
      onOk: () => {
        void runPublish();
      },
    });
  }

  function startCropInteraction(event: ReactPointerEvent, asset: Asset, mode: CropInteraction['mode']) {
    event.preventDefault();
    event.stopPropagation();
    const container = (event.currentTarget as HTMLElement).closest('[data-crop-container]') as HTMLElement | null;
    setSelectedAssetId(asset.id);
    setInteraction({
      assetId: asset.id,
      mode,
      startX: event.clientX,
      startY: event.clientY,
      startBox: normalizeCropBox(asset.crop_box),
      container,
    });
  }

  if (isLoading) {
    return (
      <div style={styles.loadingState}>
        <Loader className="nm-spin" size={24} />
        <p style={{ margin: 0 }}>데이터를 불러오는 중...</p>
      </div>
    );
  }

  if (error || !task) {
    return (
      <div style={styles.loadingState}>
        <p>{error || '작업을 불러오지 못했습니다.'}</p>
      </div>
    );
  }

  return (
    <main style={styles.shell}>
      <header style={styles.header}>
        <div style={styles.headerLeft}>
          <Button variant="default" size="sm" onClick={() => (window.location.href = '/')}>
            <ArrowLeft size={14} />
            메인
          </Button>
          <div>
            <h1 style={styles.title}>{task.title}</h1>
          </div>
        </div>
        <div style={styles.headerRight}>
          {(() => {
            const excludedFns = tree.flatMap((c) => c.functions).filter((f) => f.review_status === 'excluded').length;
            const excludedCount = excludedFns + excludedSlides.length;
            return (
              <Button variant="default" onClick={() => setIsExcludedOpen(true)}>
                <EyeOff size={15} />
                제외 페이지 {excludedCount}
              </Button>
            );
          })()}
          <Button variant="default" disabled={isPreviewLoading} onClick={handleOpenPreview}>
            <FileText size={15} />
            발행 미리보기
          </Button>
          <Button variant="primary" disabled={isPublishing} onClick={handlePublish}>
            <FileText size={15} />
            노션으로 발행
          </Button>
        </div>
      </header>

      <div style={styles.mainContent}>
        {/* Sidebar: Tree navigation */}
        <div style={styles.panel}>
          <div style={styles.panelHeader}>
            <span style={styles.panelTitle}>매뉴얼 구조</span>
          </div>
          <div style={styles.panelBody}>
          <div style={styles.sidebar}>
            {tree.length === 0 ? (
              <div style={styles.emptyState}>카테고리 없음</div>
            ) : (
              tree.map((category) => {
                const isExpanded = expandedCategories.has(category.id);
                const isEditing = editingCategoryId === category.id;

                return (
                  <div key={category.id} style={styles.treeNode}>
                    {isEditing ? (
                      <Input
                        bare
                        size="small"
                        value={editValueCategory}
                        onChange={(e) => setEditValueCategory(e.target.value)}
                        onBlur={() => handleUpdateCategoryTitle(category.id, editValueCategory)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            handleUpdateCategoryTitle(category.id, editValueCategory);
                          } else if (e.key === 'Escape') {
                            setEditingCategoryId('');
                          }
                        }}
                        autoFocus
                      />
                    ) : (
                      <div style={styles.treeRow}>
                        <button
                          type="button"
                          style={{
                            ...styles.categoryItem,
                            ...(isExpanded ? styles.categoryExpanded : {}),
                          }}
                          onClick={() => toggleCategoryExpanded(category.id)}
                        >
                          <ChevronRight
                            size={16}
                            style={{
                              transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
                              transition: 'transform 0.2s',
                              flexShrink: 0,
                            }}
                          />
                          <span style={styles.editable}>{category.title}</span>
                        </button>
                        <Button
                          variant="text"
                          size="sm"
                          aria-label="카테고리명 수정"
                          icon={<Edit2 size={14} />}
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditingCategoryId(category.id);
                            setEditValueCategory(category.title);
                          }}
                        />
                      </div>
                    )}

                    {isExpanded && (
                      <div style={{ display: 'grid', gap: ps.xxs, minWidth: 0 }}>
                        {category.functions.map((fn) => {
                          const isSelectedFn = fn.id === selectedFunctionId;
                          const isEditingFn = editingFunctionId === fn.id;
                          const isExcludedFn = fn.review_status === 'excluded';

                          return (
                            <div key={fn.id} style={{ minWidth: 0 }}>
                              {isEditingFn ? (
                                <Input
                                  bare
                                  size="small"
                                  style={{ paddingLeft: ps.lg }}
                                  value={editValueFunction}
                                  onChange={(e) => setEditValueFunction(e.target.value)}
                                  onBlur={() => handleUpdateFunctionTitle(fn.id, editValueFunction)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                      handleUpdateFunctionTitle(fn.id, editValueFunction);
                                    } else if (e.key === 'Escape') {
                                      setEditingFunctionId('');
                                    }
                                  }}
                                  autoFocus
                                />
                              ) : (
                                <div style={styles.treeRow}>
                                  <button
                                    type="button"
                                    style={{
                                      ...styles.functionItem,
                                      ...(isSelectedFn ? styles.functionItemSelected : {}),
                                      ...(isExcludedFn ? { opacity: 0.5, textDecoration: 'line-through' } : {}),
                                    }}
                                    onClick={() => selectFunction(fn.id)}
                                  >
                                    <span style={styles.editable}>{fn.title}</span>
                                    {isExcludedFn && <span style={{ fontSize: st.fontSizeSM, color: sc.text.secondary, flexShrink: 0 }}>제외됨</span>}
                                  </button>
                                  <Button
                                    variant="text"
                                    size="sm"
                                    aria-label="기능명 수정"
                                    icon={<Edit2 size={14} />}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setEditingFunctionId(fn.id);
                                      setEditValueFunction(fn.title);
                                    }}
                                  />
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
          </div>
        </div>

        {/* Main content */}
        <div style={styles.content}>
          {selectedFunction && selectedSlides.length > 0 ? (
            <div style={styles.panel}>
              <div style={styles.panelHeader}>
                  <span style={styles.functionHeaderTitle}>{selectedFunction.title}</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: ps.xs }}>
                    <Button
                      variant="default"
                      size="sm"
                      disabled={isSaving}
                      onClick={() => {
                        dialog.confirm({
                          title: '페이지 제외',
                          content: `"${selectedFunction.title}" 페이지를 발행에서 제외하시겠습니까?`,
                          onOk: async () => {
                            setIsSaving(true);
                            try {
                              const response = await fetch(`/api/functions/${selectedFunction.id}`, {
                                method: 'PATCH',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                  review_status: selectedFunction.review_status === 'excluded' ? 'pending' : 'excluded',
                                }),
                              });

                              if (!response.ok) {
                                throw new Error('페이지 상태를 변경하지 못했습니다.');
                              }

                              setTree((current) =>
                                current.map((category) => ({
                                  ...category,
                                  functions: category.functions.map((fn) =>
                                    fn.id === selectedFunction.id
                                      ? { ...fn, review_status: selectedFunction.review_status === 'excluded' ? 'pending' : 'excluded' }
                                      : fn
                                  ),
                                }))
                              );

                              message.success(selectedFunction.review_status === 'excluded' ? '페이지를 포함했습니다.' : '페이지를 제외했습니다.');
                            } catch (err) {
                              message.error(err instanceof Error ? err.message : '페이지 상태 변경에 실패했습니다.');
                            } finally {
                              setIsSaving(false);
                            }
                          },
                        });
                      }}
                    >
                      {selectedFunction.review_status === 'excluded' ? '포함' : '제외'}
                    </Button>
                  </div>
              </div>
              <div style={styles.panelBody}>
              {selectedSlides.map((slide, slideIdx) => (
              <div key={slide.id} style={{ marginBottom: slideIdx < selectedSlides.length - 1 ? ps.lg : 0 }}>
              <div style={{ fontSize: st.fontSizeSM, fontWeight: st.fontWeightMedium, color: sc.text.secondary, marginBottom: ps.xs }}>
                슬라이드 {slide.slide_number}
              </div>
              <div style={styles.slideGridLayout}>
                {/* 상단: 슬라이드 이미지(전체 폭) */}
                <div data-crop-container style={styles.slideImageContainer}>
                  {slide.render_url || (slide.assets.some((a) => a.kind === 'group_bake' && a.signed_url)) ? (
                    <>
                      {/* 기본 슬라이드 렌더 이미지 또는 group_bake 첫 에셋 표시 */}
                      {slide.render_url && <img src={slide.render_url} alt={`Slide ${slide.slide_number}`} style={styles.image} />}

                      {/* group_bake 에셋은 signed_url로 직접 표시 */}
                      {slide.assets
                        .filter((asset) => asset.kind === 'group_bake' && asset.signed_url)
                        .map((asset) => {
                          const isSelected = asset.id === selectedAsset?.id;
                          return (
                            <div
                              key={asset.id}
                              role="button"
                              tabIndex={0}
                              style={{
                                ...styles.image,
                                cursor: 'pointer',
                                opacity: isSelected ? 1 : 0.8,
                                border: isSelected ? `3px solid ${sc.primary.default}` : 'none',
                              }}
                              onClick={() => setSelectedAssetId(asset.id)}
                            >
                              <img src={asset.signed_url as string} alt={asset.label} style={styles.image} />
                              <span style={{ ...styles.cropLabel, ...(isSelected ? styles.cropLabelSelected : {}) }}>{asset.label}</span>
                            </div>
                          );
                        })}

                      {/* capture 에셋은 기존 crop_box 오버레이로 표시 */}
                      {slide.assets
                        .filter((asset) => asset.kind !== 'group_bake')
                        .map((asset) => {
                          const box = normalizeCropBox(asset.crop_box);
                          const isSelected = asset.id === selectedAsset?.id;
                          const isExcluded = selectedFunction.review_status === 'excluded';

                          return (
                            <div
                              key={asset.id}
                              role="button"
                              tabIndex={0}
                              style={{
                                ...styles.cropOverlay,
                                ...(isSelected ? styles.selectedCropOverlay : {}),
                                ...(isExcluded ? styles.excludedOverlay : {}),
                                left: `${box.left}%`,
                                top: `${box.top}%`,
                                width: `${box.width}%`,
                                height: `${box.height}%`,
                              }}
                              onPointerDown={(event) => startCropInteraction(event, asset, 'move')}
                              onClick={() => setSelectedAssetId(asset.id)}
                            >
                              <span style={{ ...styles.cropLabel, ...(isSelected ? styles.cropLabelSelected : {}) }}>{asset.label}</span>
                              {isSelected && !isExcluded && (
                                <span
                                  role="button"
                                  style={styles.resizeHandle}
                                  onPointerDown={(event) => startCropInteraction(event, asset, 'resize')}
                                />
                              )}
                            </div>
                          );
                        })}
                    </>
                  ) : (
                    <div style={styles.imageFallback}>
                      <FileImage size={24} />
                    </div>
                  )}
                </div>

                {/* 하단: 영역 목록 | 노션 본문 (2열) */}
                <div style={styles.editorRow}>
                  <div style={styles.cropContainer}>
                  {/* 영역 목록: 이미지에서 드래그로 영역을 잡고, 이름은 여기서 바로 수정 */}
                  <div>
                    <div style={{ marginBottom: ps.sm, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <strong style={{ fontSize: st.fontSize, fontWeight: st.fontWeightMedium, color: sc.text.primary }}>
                        영역 목록 ({slide.assets.length})
                      </strong>
                      <Button variant="default" size="sm" disabled={isSaving} onClick={() => handleAddAsset(slide.id)}>
                        <Plus size={14} />
                        추가
                      </Button>
                    </div>
                    <div style={styles.assetList}>
                      {slide.assets.length === 0 ? (
                        <span style={{ color: sc.text.secondary, fontSize: st.fontSizeSM }}>
                          영역이 없습니다. 위 이미지에서 영역을 드래그하거나 추가를 눌러주세요.
                        </span>
                      ) : (
                        slide.assets.map((asset) => {
                          const selected = asset.id === selectedAsset?.id;
                          const editing = asset.id === editingAssetId;
                          return (
                            <div
                              key={asset.id}
                              style={{ ...styles.assetRow, ...(selected ? styles.assetRowSelected : {}) }}
                              onClick={() => setSelectedAssetId(asset.id)}
                            >
                              {editing ? (
                                <Input
                                  bare
                                  size="small"
                                  value={asset.label}
                                  placeholder="영역 이름"
                                  autoFocus
                                  onChange={(e) => updateAssetInTree(asset.id, (a) => ({ ...a, label: e.target.value }))}
                                  onBlur={() => {
                                    setEditingAssetId('');
                                    handleSaveAsset(asset);
                                  }}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
                                    else if (e.key === 'Escape') setEditingAssetId('');
                                  }}
                                  style={{ flex: 1, minWidth: 0 }}
                                />
                              ) : (
                                <span style={styles.assetLabel}>{asset.label}</span>
                              )}
                              <Button
                                variant="text"
                                size="sm"
                                aria-label="이름 수정"
                                disabled={isSaving}
                                icon={<Edit2 size={14} />}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedAssetId(asset.id);
                                  setEditingAssetId(asset.id);
                                }}
                              />
                              <Button
                                variant="text"
                                size="sm"
                                aria-label="영역 삭제"
                                disabled={isSaving}
                                icon={<Trash2 size={14} />}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  dialog.confirm({
                                    title: '영역 삭제',
                                    content: '이 영역을 삭제하시겠습니까?',
                                    onOk: () => handleDeleteAsset(asset.id),
                                  });
                                }}
                              />
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                </div>

                {/* Right: Blocks preview */}
                <div style={styles.blocksContainer}>
                  <div>
                    <strong style={{ fontSize: st.fontSize, fontWeight: st.fontWeightMedium, color: sc.text.primary, display: 'block', marginBottom: ps.sm }}>
                      노션 본문에 들어갈 내용
                    </strong>
                  </div>
                  {slide.blocks.length === 0 ? (
                    <div style={{ color: sc.text.secondary, fontSize: st.fontSizeSM }}>블록 없음</div>
                  ) : (
                    <BlockList blocks={slide.blocks} startNumber={slideStepOffsets[slideIdx]} />
                  )}
                </div>
                </div>
              </div>
              </div>
              ))}
              </div>
            </div>
          ) : (
            <div style={styles.panel}>
              <div style={styles.panelHeader}>
                <span style={styles.panelTitle}>페이지 선택</span>
              </div>
              <div style={styles.panelBody}>
                <div style={styles.emptyState}>좌측에서 기능을 선택하여 페이지를 편집하세요.</div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 제외된 페이지 모달 */}
      <Modal open={isExcludedOpen} onClose={() => setIsExcludedOpen(false)} title="제외된 페이지" subtitle="발행에서 빠지는 페이지입니다. 포함하면 다시 발행 대상이 됩니다." size="md">
        {(() => {
          const excludedFns = tree
            .flatMap((c) => c.functions.map((f) => ({ category: c.title, fn: f })))
            .filter((x) => x.fn.review_status === 'excluded');
          if (excludedFns.length === 0 && excludedSlides.length === 0) {
            return <div style={{ color: sc.text.secondary, padding: ps.lg, textAlign: 'center' }}>제외된 페이지가 없습니다.</div>;
          }
          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: ps.xs, maxHeight: '60vh', overflowY: 'auto' }}>
              {excludedFns.map(({ category, fn }) => {
                const renderUrl = fn.slides[0]?.render_url ?? null;
                return (
                  <div key={fn.id} style={styles.excludedRow}>
                    {renderUrl ? (
                      <img src={renderUrl} alt={fn.title} style={styles.excludedThumb} />
                    ) : (
                      <div style={styles.excludedThumbEmpty}>
                        <FileImage size={18} />
                      </div>
                    )}
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: st.fontSizeSM, color: sc.text.secondary }}>{category}</div>
                      <div style={{ fontSize: st.fontSize, color: sc.text.primary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{fn.title}</div>
                    </div>
                    <Button variant="default" size="sm" onClick={() => includeExcluded('function', fn.id)}>
                      <Eye size={14} />
                      포함
                    </Button>
                  </div>
                );
              })}
              {excludedSlides.map((slide) => (
                <div key={slide.id} style={styles.excludedRow}>
                  {slide.render_url ? (
                    <img src={slide.render_url} alt={slide.title ?? ''} style={styles.excludedThumb} />
                  ) : (
                    <div style={styles.excludedThumbEmpty}>
                      <FileImage size={18} />
                    </div>
                  )}
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: st.fontSizeSM, color: sc.text.secondary }}>표지/목차 추정</div>
                    <div style={{ fontSize: st.fontSize, color: sc.text.primary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {slide.slide_number}. {slide.title || '제목 없음'}
                    </div>
                  </div>
                  <Button variant="default" size="sm" onClick={() => includeExcluded('slide', slide.id)}>
                    <Eye size={14} />
                    포함
                  </Button>
                </div>
              ))}
            </div>
          );
        })()}
      </Modal>

      {/* Preview modal */}
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
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 360, gap: ps.sm }}>
            <Loader className="nm-spin" size={24} />
            <span style={{ color: sc.text.secondary }}>미리보기를 불러오는 중...</span>
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

            {/* 우: 선택한 페이지 본문(노션 페이지처럼) */}
            <div style={{ overflowY: 'auto', background: sc.bg.container }}>
              {(() => {
                const page = previewData.categories.flatMap((c) => c.functions).find((f) => f.id === previewPageId);
                if (!page) return <div style={{ color: sc.text.secondary, padding: ps.xl }}>좌측에서 페이지를 선택하세요.</div>;
                return (
                  <div style={{ maxWidth: 720, margin: '0 auto', padding: `${ps.xl}px ${ps.xl}px ${ps.xxl ?? ps.xl}px` }}>
                    <h1 style={{ fontSize: st.fontSizeHeading3, fontWeight: st.fontWeightStrong, color: sc.text.heading, marginTop: 0, marginBottom: ps.lg }}>
                      {page.title}
                    </h1>
                    {page.blocks.length > 0 && <BlockList blocks={page.blocks} />}
                    {page.images.length > 0 && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: ps.md, marginTop: ps.lg }}>
                        {page.images.map((img, idx) => (
                          <div key={idx}>{renderCropThumbnail(img.cropBox, img.renderUrl, img.label)}</div>
                        ))}
                      </div>
                    )}
                    {page.blocks.length === 0 && page.images.length === 0 && (
                      <div style={{ color: sc.text.secondary }}>이 페이지에 들어갈 내용이 없습니다.</div>
                    )}
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
        onClose={cancelPublish}
        title="노션 발행 중"
        size="sm"
        footer={
          <Button variant="default" onClick={cancelPublish}>
            취소
          </Button>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: ps.md, padding: ps.md }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: ps.sm }}>
            <Loader className="nm-spin" size={20} />
            <span style={{ fontSize: st.fontSize, fontWeight: st.fontWeightMedium, color: sc.text.heading, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {publishProgress ? `${publishProgress.label}…` : '발행 준비 중…'}
            </span>
          </div>
          {/* 실제 진행률 바 */}
          <div style={{ height: 8, borderRadius: pr.sm, background: sc.bg.elevated, overflow: 'hidden' }}>
            <div
              className={publishProgress ? undefined : 'nm-progress-active'}
              style={{
                height: '100%',
                width: publishProgress && publishProgress.total > 0 ? `${(publishProgress.done / publishProgress.total) * 100}%` : '40%',
                background: sc.primary.default,
                borderRadius: pr.sm,
                transition: 'width 300ms ease',
              }}
            />
          </div>
          <div style={{ fontSize: st.fontSizeSM, color: sc.text.secondary, textAlign: 'right' }}>
            {publishProgress ? `${publishProgress.done} / ${publishProgress.total} 페이지` : ''}
          </div>
        </div>
      </Modal>

      {/* Publish result modal */}
      <Modal
        open={showPublishResult && publishResult !== null}
        onClose={() => {
          setShowPublishResult(false);
          setPublishResult(null);
        }}
        title="발행 완료"
        size="md"
        footer={
          <Button
            variant="primary"
            onClick={() => {
              setShowPublishResult(false);
              setPublishResult(null);
            }}
          >
            확인
          </Button>
        }
      >
        {publishResult && (
          <div style={{ display: 'grid', gap: ps.md }}>
            <div style={{ padding: ps.md, background: sc.bg.elevated, borderRadius: pr.base }}>
              <div style={{ fontSize: st.fontSizeSM, color: sc.text.secondary, marginBottom: ps.xs }}>생성된 기능 페이지</div>
              <div style={{ fontSize: st.fontSizeHeading5, fontWeight: st.fontWeightStrong, color: sc.text.heading }}>
                {publishResult.functionCount ?? 0}개
              </div>
            </div>
            <div style={{ padding: ps.md, background: sc.bg.elevated, borderRadius: pr.base }}>
              <div style={{ fontSize: st.fontSizeSM, color: sc.text.secondary, marginBottom: ps.xs }}>발행된 이미지</div>
              <div style={{ fontSize: st.fontSizeHeading5, fontWeight: st.fontWeightStrong, color: sc.text.heading }}>
                {publishResult.imageCount ?? 0}개
              </div>
            </div>
            {publishResult.url && (
              <div style={{ padding: ps.md, background: sc.bg.elevated, borderRadius: pr.base }}>
                <a
                  href={publishResult.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: sc.primary.default, textDecoration: 'none', fontSize: st.fontSizeSM, fontWeight: st.fontWeightMedium }}
                >
                  노션에서 열기
                </a>
              </div>
            )}
          </div>
        )}
      </Modal>
    </main>
  );
}
