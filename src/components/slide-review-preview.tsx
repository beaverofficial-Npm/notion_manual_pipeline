'use client';

import {
  Button,
  Card,
  Modal,
  primitiveRadius,
  primitiveSpacing,
  semanticColors,
  semanticTypography,
} from '@sungbinhwang-beaverworksinc/design-system';
import { Check, EyeOff, Image as ImageIcon, Plus, RefreshCw, Trash2, FileText } from 'lucide-react';
import type { CSSProperties, ChangeEvent } from 'react';
import { useEffect, useRef, useState } from 'react';

const ps = primitiveSpacing;
const pr = primitiveRadius;
const sc = semanticColors;
const st = semanticTypography;
const PILOT_MANIFEST_URL = '/generated/pilot/product-slide-14/manifest.json';

interface PilotManifest {
  sourceFile: string;
  slideNumber: number;
  title: string;
  slideImage: string;
  textCandidates: Array<{
    id: string;
    text: string;
    status: 'approve_ready' | 'review_required';
  }>;
  imageCandidates: Array<{
    id: string;
    label: string;
    kind: 'screenshot';
    confidence: number;
    percentBox: {
      left: number;
      top: number;
      width: number;
      height: number;
    };
    reviewReason: string;
  }>;
  qualityWarnings: Array<{
    code: string;
    label: string;
    status: string;
  }>;
}

interface PercentBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

type EditableAssetKind = 'screenshot' | 'qr' | 'table_image' | 'annotation' | 'unknown';

interface EditableCropAsset {
  id: string;
  label: string;
  kind: EditableAssetKind;
  confidence: number;
  percentBox: PercentBox;
  reviewReason: string;
  source: 'auto' | 'manual';
}

interface CropInteraction {
  id: string;
  mode: 'move' | 'resize';
  startX: number;
  startY: number;
  startBox: PercentBox;
}

interface DrawInteraction {
  startX: number;
  startY: number;
  startLeft: number;
  startTop: number;
  draftBox: PercentBox;
}

const styles = {
  shell: {
    width: 'min(1280px, calc(100vw - 32px))',
    margin: '0 auto',
    padding: `${ps.lg}px 0`,
  },
  header: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: ps.md,
    marginBottom: ps.base,
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
  pageGrid: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) 400px',
    gap: ps.sm,
    alignItems: 'start',
  },
  workCardBody: {
    display: 'grid',
    gap: ps.sm,
  },
  canvasToolbar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: ps.sm,
    flexWrap: 'wrap',
  },
  slideFrame: {
    position: 'relative',
    overflow: 'hidden',
    background: sc.bg.container,
    border: `1px solid ${sc.border.default}`,
    borderRadius: pr.lg,
  },
  slideCanvas: {
    position: 'relative',
    width: '100%',
    aspectRatio: '16 / 10',
    background: sc.bg.elevated,
  },
  slideImage: {
    display: 'block',
    width: '100%',
    height: '100%',
    objectFit: 'contain',
  },
  overlay: {
    position: 'absolute',
    borderStyle: 'solid',
    borderWidth: 2,
    borderRadius: pr.base,
    cursor: 'move',
    touchAction: 'none',
  },
  drawLayer: {
    position: 'absolute',
    inset: 0,
    touchAction: 'none',
  },
  drawHint: {
    position: 'absolute',
    left: ps.sm,
    top: ps.sm,
    zIndex: 5,
    display: 'inline-flex',
    alignItems: 'center',
    minHeight: 28,
    padding: `0 ${ps.sm}px`,
    color: sc.primary.text,
    background: sc.primary.bg,
    border: `1px solid ${sc.primary.border}`,
    borderRadius: pr.full,
    fontSize: st.fontSizeSM,
    fontWeight: st.fontWeightStrong,
    lineHeight: st.lineHeightSM,
    pointerEvents: 'none',
  },
  overlayLabel: {
    position: 'absolute',
    left: -2,
    top: -26,
    height: 22,
    display: 'inline-flex',
    alignItems: 'center',
    padding: `0 ${ps.xs}px`,
    color: sc.text.lightSolid,
    borderRadius: pr.sm,
    fontSize: st.fontSizeSM,
    fontWeight: st.fontWeightStrong,
    lineHeight: st.lineHeightSM,
    whiteSpace: 'nowrap',
  },
  sideStack: {
    display: 'grid',
    gap: ps.sm,
  },
  sectionTitle: {
    margin: 0,
    color: sc.text.heading,
    fontSize: st.fontSize,
    fontWeight: st.fontWeightStrong,
    lineHeight: st.lineHeight,
  },
  panelHeader: {
    display: 'grid',
    gap: ps.xxs,
  },
  helpText: {
    margin: 0,
    color: sc.text.secondary,
    fontSize: st.fontSizeSM,
    lineHeight: st.lineHeightSM,
  },
  candidateList: {
    display: 'grid',
    gap: ps.xs,
  },
  candidate: {
    display: 'grid',
    gridTemplateColumns: '24px minmax(0, 1fr) auto',
    alignItems: 'center',
    gap: ps.xs,
    minHeight: 42,
    padding: `${ps.xs}px ${ps.sm}px`,
    background: sc.bg.elevated,
    border: `1px solid ${sc.border.secondary}`,
    borderRadius: pr.base,
  },
  iconBox: {
    width: 24,
    height: 24,
    display: 'grid',
    placeItems: 'center',
    color: sc.primary.default,
  },
  strongText: {
    display: 'block',
    color: sc.text.heading,
    fontSize: st.fontSizeSM,
    fontWeight: st.fontWeightStrong,
    lineHeight: st.lineHeightSM,
    overflowWrap: 'anywhere',
  },
  smallText: {
    display: 'block',
    color: sc.text.secondary,
    fontSize: st.fontSizeSM,
    lineHeight: st.lineHeightSM,
    overflowWrap: 'anywhere',
  },
  status: {
    display: 'inline-flex',
    alignItems: 'center',
    height: 24,
    padding: `0 ${ps.xs}px`,
    borderRadius: pr.full,
    fontSize: st.fontSizeSM,
    fontWeight: st.fontWeightStrong,
    lineHeight: st.lineHeightSM,
  },
  notionBlock: {
    display: 'grid',
    gap: ps.xs,
    padding: ps.sm,
    background: sc.bg.elevated,
    border: `1px solid ${sc.border.secondary}`,
    borderRadius: pr.base,
  },
  toolbar: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: ps.xs,
  },
  editPanel: {
    display: 'grid',
    gap: ps.xs,
    padding: ps.sm,
    background: sc.bg.elevated,
    border: `1px solid ${sc.border.secondary}`,
    borderRadius: pr.base,
  },
  selectedSummary: {
    display: 'grid',
    gap: ps.xs,
    padding: ps.sm,
    background: sc.primary.bg,
    border: `1px solid ${sc.primary.border}`,
    borderRadius: pr.base,
  },
  field: {
    display: 'grid',
    gap: ps.xxs,
    color: sc.text.label,
    fontSize: st.fontSizeSM,
    fontWeight: st.fontWeightMedium,
    lineHeight: st.lineHeightSM,
  },
  input: {
    width: '100%',
    minWidth: 0,
    height: 34,
    padding: `0 ${ps.xs}px`,
    color: sc.text.primary,
    background: sc.bg.container,
    border: `1px solid ${sc.border.default}`,
    borderRadius: pr.base,
    outline: 'none',
  },
  select: {
    width: '100%',
    minWidth: 0,
    height: 34,
    padding: `0 ${ps.xs}px`,
    color: sc.text.primary,
    background: sc.bg.container,
    border: `1px solid ${sc.border.default}`,
    borderRadius: pr.base,
    outline: 'none',
  },
  coordinateGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: ps.xs,
  },
  coordinateItem: {
    display: 'grid',
    gap: 2,
    padding: ps.xs,
    background: sc.bg.container,
    border: `1px solid ${sc.border.secondary}`,
    borderRadius: pr.base,
  },
  resizeHandle: {
    position: 'absolute',
    right: -6,
    bottom: -6,
    width: 14,
    height: 14,
    background: sc.bg.container,
    border: `2px solid ${sc.primary.default}`,
    borderRadius: pr.full,
    cursor: 'nwse-resize',
    pointerEvents: 'auto',
    touchAction: 'none',
  },
  draftOverlay: {
    position: 'absolute',
    border: `2px dashed ${sc.primary.default}`,
    background: sc.primary.bg,
    opacity: 0.7,
    borderRadius: pr.base,
    pointerEvents: 'none',
  },
  loadingBox: {
    minHeight: 360,
    display: 'grid',
    placeItems: 'center',
    gap: ps.xs,
    color: sc.text.secondary,
    background: sc.bg.elevated,
    border: `1px solid ${sc.border.default}`,
    borderRadius: pr.lg,
  },
  loadingStack: {
    display: 'grid',
    placeItems: 'center',
    gap: ps.xs,
  },
} satisfies Record<string, CSSProperties>;

function useNarrowLayout() {
  const [isNarrow, setIsNarrow] = useState(false);

  useEffect(() => {
    const media = window.matchMedia('(max-width: 920px)');
    const update = () => setIsNarrow(media.matches);

    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  return isNarrow;
}

function status(label: string, tone: 'success' | 'warning' | 'neutral') {
  const meta = {
    success: { color: sc.success.text, background: sc.success.bg, border: sc.success.border },
    warning: { color: sc.warning.text, background: sc.warning.bg, border: sc.warning.border },
    neutral: { color: sc.text.secondary, background: sc.bg.container, border: sc.border.default },
  }[tone];

  return <span style={{ ...styles.status, color: meta.color, background: meta.background, border: `1px solid ${meta.border}` }}>{label}</span>;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function roundBox(box: PercentBox): PercentBox {
  return {
    left: Number(box.left.toFixed(2)),
    top: Number(box.top.toFixed(2)),
    width: Number(box.width.toFixed(2)),
    height: Number(box.height.toFixed(2)),
  };
}

function normalizeBox(box: PercentBox): PercentBox {
  const left = box.width < 0 ? box.left + box.width : box.left;
  const top = box.height < 0 ? box.top + box.height : box.top;
  const width = Math.abs(box.width);
  const height = Math.abs(box.height);

  return roundBox({
    left: clamp(left, 0, 100),
    top: clamp(top, 0, 100),
    width: clamp(width, 0, 100 - clamp(left, 0, 100)),
    height: clamp(height, 0, 100 - clamp(top, 0, 100)),
  });
}

export function SlideReviewPreview() {
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const [manifest, setManifest] = useState<PilotManifest | null>(null);
  const [loadError, setLoadError] = useState('');
  const [cropAssets, setCropAssets] = useState<EditableCropAsset[]>([]);
  const [selectedCropId, setSelectedCropId] = useState('');
  const [interaction, setInteraction] = useState<CropInteraction | null>(null);
  const [isDrawingMode, setIsDrawingMode] = useState(false);
  const [drawInteraction, setDrawInteraction] = useState<DrawInteraction | null>(null);
  const [arrowExcluded, setArrowExcluded] = useState(true);
  const [slideApproved, setSlideApproved] = useState(false);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const isNarrow = useNarrowLayout();
  const pageGridStyle: CSSProperties = {
    ...styles.pageGrid,
    gridTemplateColumns: isNarrow ? 'minmax(0, 1fr)' : styles.pageGrid.gridTemplateColumns,
  };
  const headerStyle: CSSProperties = {
    ...styles.header,
    flexDirection: isNarrow ? 'column' : 'row',
  };

  useEffect(() => {
    let mounted = true;

    fetch(PILOT_MANIFEST_URL)
      .then((response) => {
        if (!response.ok) {
          throw new Error('manifest를 불러오지 못했습니다.');
        }
        return response.json() as Promise<PilotManifest>;
      })
      .then((nextManifest) => {
        if (mounted) {
          setManifest(nextManifest);
          setCropAssets(
            nextManifest.imageCandidates.map((candidate) => ({
              id: candidate.id,
              label: candidate.label,
              kind: candidate.kind,
              confidence: candidate.confidence,
              percentBox: candidate.percentBox,
              reviewReason: candidate.reviewReason,
              source: 'auto',
            })),
          );
          setSelectedCropId(nextManifest.imageCandidates[0]?.id ?? '');
          setLoadError('');
        }
      })
      .catch((error) => {
        if (mounted) {
          setLoadError(error instanceof Error ? error.message : 'manifest를 불러오지 못했습니다.');
        }
      });

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!interaction) return;
    const activeInteraction = interaction;

    function handlePointerMove(event: PointerEvent) {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;

      const deltaX = ((event.clientX - activeInteraction.startX) / rect.width) * 100;
      const deltaY = ((event.clientY - activeInteraction.startY) / rect.height) * 100;
      const start = activeInteraction.startBox;

      if (activeInteraction.mode === 'move') {
        const nextBox = roundBox({
          ...start,
          left: clamp(start.left + deltaX, 0, 100 - start.width),
          top: clamp(start.top + deltaY, 0, 100 - start.height),
        });

        setCropAssets((current) =>
          current.map((asset) => (asset.id === activeInteraction.id ? { ...asset, percentBox: nextBox } : asset)),
        );
        return;
      }

      const nextWidth = clamp(start.width + deltaX, 4, 100 - start.left);
      const nextHeight = clamp(start.height + deltaY, 4, 100 - start.top);
      const nextBox = roundBox({
        ...start,
        width: nextWidth,
        height: nextHeight,
      });

      setCropAssets((current) =>
        current.map((asset) => (asset.id === activeInteraction.id ? { ...asset, percentBox: nextBox } : asset)),
      );
    }

    function handlePointerUp() {
      setInteraction(null);
    }

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [interaction]);

  useEffect(() => {
    if (!drawInteraction) return;
    const activeDraw = drawInteraction;

    function handlePointerMove(event: PointerEvent) {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;

      const currentLeft = ((event.clientX - rect.left) / rect.width) * 100;
      const currentTop = ((event.clientY - rect.top) / rect.height) * 100;
      const draftBox = normalizeBox({
        left: activeDraw.startLeft,
        top: activeDraw.startTop,
        width: currentLeft - activeDraw.startLeft,
        height: currentTop - activeDraw.startTop,
      });

      setDrawInteraction({ ...activeDraw, draftBox });
    }

    function handlePointerUp() {
      setDrawInteraction((current) => {
        if (!current) return null;

        const draftBox = normalizeBox(current.draftBox);
        if (draftBox.width < 3 || draftBox.height < 3) {
          return null;
        }

        const nextIndex = cropAssets.length + 1;
        const id = `manual-${Date.now()}`;
        const nextAsset: EditableCropAsset = {
          id,
          label: `새 영역 ${nextIndex}`,
          kind: 'screenshot',
          confidence: 1,
          percentBox: draftBox,
          reviewReason: 'manual_drawn',
          source: 'manual',
        };

        setCropAssets((assets) => [...assets, nextAsset]);
        setSelectedCropId(id);
        setSlideApproved(false);
        return null;
      });
    }

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [cropAssets.length, drawInteraction]);

  function startCropInteraction(event: React.PointerEvent, id: string, mode: CropInteraction['mode']) {
    const asset = cropAssets.find((item) => item.id === id);
    if (!asset) return;

    event.preventDefault();
    event.stopPropagation();
    setSelectedCropId(id);
    setInteraction({
      id,
      mode,
      startX: event.clientX,
      startY: event.clientY,
      startBox: asset.percentBox,
    });
  }

  function resetCrop(id: string) {
    const original = manifest?.imageCandidates.find((candidate) => candidate.id === id)?.percentBox;
    if (!original) return;

    setCropAssets((current) =>
      current.map((asset) => (asset.id === id ? { ...asset, percentBox: original } : asset)),
    );
  }

  function startDrawInteraction(event: React.PointerEvent<HTMLDivElement>) {
    if (!isDrawingMode) return;

    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;

    const left = clamp(((event.clientX - rect.left) / rect.width) * 100, 0, 100);
    const top = clamp(((event.clientY - rect.top) / rect.height) * 100, 0, 100);

    event.preventDefault();
    setSelectedCropId('');
    setDrawInteraction({
      startX: event.clientX,
      startY: event.clientY,
      startLeft: left,
      startTop: top,
      draftBox: { left, top, width: 0, height: 0 },
    });
  }

  function deleteSelectedCrop() {
    if (!selectedCropId) return;

    setCropAssets((current) => {
      const nextAssets = current.filter((asset) => asset.id !== selectedCropId);
      setSelectedCropId(nextAssets[0]?.id ?? '');
      return nextAssets;
    });
    setSlideApproved(false);
  }

  function toggleDrawingMode() {
    setDrawInteraction(null);
    setIsDrawingMode((current) => !current);
  }

  function updateSelectedCrop(patch: Partial<EditableCropAsset>) {
    if (!selectedCropId) return;

    setCropAssets((current) =>
      current.map((asset) => (asset.id === selectedCropId ? { ...asset, ...patch } : asset)),
    );
    setSlideApproved(false);
  }

  function handleKindChange(event: ChangeEvent<HTMLSelectElement>) {
    updateSelectedCrop({ kind: event.target.value as EditableAssetKind });
  }

  function renderCropOverlay(asset: EditableCropAsset, index: number) {
    const box = asset.percentBox;
    const isSelected = selectedCropId === asset.id;
    const color = isSelected ? sc.primary.default : asset.kind === 'annotation' ? sc.warning.default : index === 0 ? sc.info.default : sc.warning.default;

    return (
      <div
        key={asset.id}
        style={{
          ...styles.overlay,
          left: `${box.left}%`,
          top: `${box.top}%`,
          width: `${box.width}%`,
          height: `${box.height}%`,
          borderColor: color,
          borderWidth: isSelected ? 3 : 2,
          zIndex: isSelected ? 3 : 2,
        }}
        onPointerDown={(event) => startCropInteraction(event, asset.id, 'move')}
      >
        <span style={{ ...styles.overlayLabel, background: color }}>{asset.label}</span>
        {isSelected ? (
          <span
            aria-label="crop 크기 조정"
            role="button"
            style={styles.resizeHandle}
            onPointerDown={(event) => startCropInteraction(event, asset.id, 'resize')}
          />
        ) : null}
      </div>
    );
  }

  const selectedCrop = cropAssets.find((asset) => asset.id === selectedCropId);
  const selectedBox = selectedCrop?.percentBox ?? null;

  return (
    <main style={styles.shell}>
      <header style={headerStyle}>
        <div>
          <h1 style={styles.title}>상품 페이지 영역 편집</h1>
          <p style={styles.description}>
            문서에 넣을 이미지 영역을 만들고, 선택한 영역의 이름과 종류를 정합니다.
          </p>
        </div>
        <div style={styles.toolbar}>
          <Button variant="default" disabled={!manifest} onClick={() => setIsPreviewOpen(true)}>
            <FileText size={15} />
            노션 미리보기
          </Button>
          <Button variant="default" disabled={!manifest} onClick={() => setArrowExcluded((current) => !current)}>
            <EyeOff size={15} />
            {arrowExcluded ? '화살표 제외됨' : '화살표 포함'}
          </Button>
          <Button variant={slideApproved ? 'default' : 'primary'} disabled={!manifest} onClick={() => setSlideApproved((current) => !current)}>
            <Check size={15} />
            {slideApproved ? '승인 완료' : '슬라이드 승인'}
          </Button>
        </div>
      </header>

      <section style={pageGridStyle}>
        <Card title={manifest ? `${manifest.slideNumber}. ${manifest.title}` : '슬라이드 로딩'} bordered padding="md">
          <div style={styles.workCardBody}>
            <div style={styles.canvasToolbar}>
              <div style={styles.panelHeader}>
                <strong style={styles.strongText}>이미지 영역</strong>
                <p style={styles.helpText}>영역을 선택해 옮기거나, 새 영역을 그려 문서에 넣을 이미지를 만듭니다.</p>
              </div>
              <Button variant={isDrawingMode ? 'primary' : 'default'} disabled={!manifest} onClick={toggleDrawingMode}>
                <Plus size={15} />
                {isDrawingMode ? '영역 그리는 중' : '새 영역'}
              </Button>
            </div>
            {manifest ? (
              <div style={styles.slideFrame}>
                <div style={styles.slideCanvas}>
                  <img src={manifest.slideImage} alt={`${manifest.title} 슬라이드 렌더`} style={styles.slideImage} />
                  <div
                    ref={canvasRef}
                    style={{
                      ...styles.drawLayer,
                      cursor: isDrawingMode ? 'crosshair' : 'default',
                    }}
                    onPointerDown={startDrawInteraction}
                  >
                    {isDrawingMode ? <span style={styles.drawHint}>마우스로 드래그해서 영역을 만드세요</span> : null}
                    {cropAssets.map((asset, index) => renderCropOverlay(asset, index))}
                    {drawInteraction ? (
                      <div
                        style={{
                          ...styles.draftOverlay,
                          left: `${drawInteraction.draftBox.left}%`,
                          top: `${drawInteraction.draftBox.top}%`,
                          width: `${drawInteraction.draftBox.width}%`,
                          height: `${drawInteraction.draftBox.height}%`,
                        }}
                      />
                    ) : null}
                  </div>
                </div>
              </div>
            ) : (
              <div style={styles.loadingBox}>
                <div style={styles.loadingStack}>
                  {loadError ? null : <RefreshCw className="nm-spin" size={20} color={sc.primary.default} />}
                  <span>{loadError || '실제 슬라이드 산출물을 불러오는 중입니다.'}</span>
                </div>
              </div>
            )}
          </div>
        </Card>

        <div style={styles.sideStack}>
          <Card title="영역 목록" bordered padding="md">
            <div style={styles.candidateList}>
              {cropAssets.map((candidate) => (
                <button
                  key={candidate.id}
                  type="button"
                  style={{
                    ...styles.candidate,
                    textAlign: 'left',
                    cursor: 'pointer',
                    borderColor: selectedCropId === candidate.id ? sc.primary.border : sc.border.secondary,
                  }}
                  onClick={() => setSelectedCropId(candidate.id)}
                >
                  <span style={styles.iconBox}>
                    <ImageIcon size={16} />
                  </span>
                  <div>
                    <strong style={styles.strongText}>{candidate.label}</strong>
                    <span style={styles.smallText}>
                      {candidate.kind} · {candidate.source === 'manual' ? '직접 추가' : '자동 감지'}
                    </span>
                  </div>
                  {status(selectedCropId === candidate.id ? '선택' : '미선택', selectedCropId === candidate.id ? 'success' : 'neutral')}
                </button>
              ))}
              <Button variant="default" disabled={!manifest} onClick={toggleDrawingMode}>
                <Plus size={15} />
                새 영역 만들기
              </Button>
            </div>
          </Card>

          <Card title="선택 영역" bordered padding="md">
            <div style={styles.candidateList}>
              {selectedCrop && selectedBox ? (
                <div style={styles.editPanel}>
                  <div style={styles.selectedSummary}>
                    <strong style={styles.strongText}>{selectedCrop.label}</strong>
                    <span style={styles.smallText}>박스를 드래그하면 위치가 바뀌고, 우하단 점을 잡으면 크기가 바뀝니다.</span>
                  </div>
                  <label style={styles.field}>
                    이름
                    <input
                      style={styles.input}
                      value={selectedCrop.label}
                      onChange={(event) => updateSelectedCrop({ label: event.target.value })}
                    />
                  </label>
                  <label style={styles.field}>
                    문서에 넣을 종류
                    <select style={styles.select} value={selectedCrop.kind} onChange={handleKindChange}>
                      <option value="screenshot">화면 이미지</option>
                      <option value="qr">QR</option>
                      <option value="table_image">표 이미지</option>
                      <option value="annotation">어노테이션</option>
                      <option value="unknown">미분류</option>
                    </select>
                  </label>
                  <div style={styles.coordinateGrid}>
                    <div style={styles.coordinateItem}>
                      <span style={styles.smallText}>왼쪽</span>
                      <strong style={styles.strongText}>{selectedBox.left}%</strong>
                    </div>
                    <div style={styles.coordinateItem}>
                      <span style={styles.smallText}>위</span>
                      <strong style={styles.strongText}>{selectedBox.top}%</strong>
                    </div>
                    <div style={styles.coordinateItem}>
                      <span style={styles.smallText}>너비</span>
                      <strong style={styles.strongText}>{selectedBox.width}%</strong>
                    </div>
                    <div style={styles.coordinateItem}>
                      <span style={styles.smallText}>높이</span>
                      <strong style={styles.strongText}>{selectedBox.height}%</strong>
                    </div>
                  </div>
                  <div style={styles.toolbar}>
                    <Button variant="default" size="sm" onClick={() => resetCrop(selectedCrop.id)} disabled={selectedCrop.source === 'manual'}>
                      초기화
                    </Button>
                    <Button variant="default" size="sm" onClick={deleteSelectedCrop}>
                      <Trash2 size={14} />
                      삭제
                    </Button>
                  </div>
                </div>
              ) : (
                <div style={styles.editPanel}>
                  <strong style={styles.strongText}>선택된 영역 없음</strong>
                  <span style={styles.smallText}>
                    왼쪽 이미지에서 영역을 선택하거나 `새 영역`을 누른 뒤 드래그하세요.
                  </span>
                </div>
              )}
            </div>
          </Card>

        </div>
      </section>

      <Modal
        open={isPreviewOpen}
        onClose={() => setIsPreviewOpen(false)}
        title="노션 미리보기"
        subtitle="현재 선택한 텍스트와 이미지 영역이 문서에 들어가는 순서입니다."
        size={760}
        footer="none"
        closeOnOverlay
      >
        <div style={styles.notionBlock}>
          <h2 style={styles.sectionTitle}>{manifest?.title ?? '슬라이드 제목'}</h2>
          {(manifest?.textCandidates ?? []).slice(1).map((candidate) => (
            <span key={`${candidate.id}-block`} style={styles.smallText}>
              {candidate.text}
            </span>
          ))}
          {cropAssets.map((candidate) => (
            <span key={`${candidate.id}-block`} style={styles.smallText}>
              [{candidate.kind}] {candidate.label}
            </span>
          ))}
        </div>
      </Modal>
    </main>
  );
}
