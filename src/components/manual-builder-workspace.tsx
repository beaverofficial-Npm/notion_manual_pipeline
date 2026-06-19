'use client';

import {
  Button,
  Card,
  primitiveRadius,
  primitiveSpacing,
  semanticColors,
  semanticTypography,
} from '@sungbinhwang-beaverworksinc/design-system';
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Database,
  ExternalLink,
  FileText,
  Filter,
  Link2,
  Monitor,
  Search,
} from 'lucide-react';
import Link from 'next/link';
import type { CSSProperties } from 'react';
import { useEffect, useMemo, useState } from 'react';
import type { AnchorCandidate, ManualBuilderDataset, ManualBuilderUnitView, ManualPart, AudienceScope } from '@/types/manual-builder';

const ps = primitiveSpacing;
const pr = primitiveRadius;
const sc = semanticColors;
const st = semanticTypography;

interface ManualBuilderWorkspaceProps {
  dataset: ManualBuilderDataset;
}

type CandidateFilter = 'all' | 'high' | 'needs_anchor' | 'pilot';

const partLabel: Record<ManualPart, string> = {
  general_summary: '요약 파트',
  detailed_manual: '세부 매뉴얼',
  appendix: '부록',
  unknown: '미분류',
};

const scopeLabel: Record<AudienceScope, string> = {
  common: '공통',
  franchise: '프랜차이즈',
  general: '일반',
  unknown: '미분류',
};

const styles = {
  shell: {
    width: '100%',
    minHeight: '100vh',
    overflowX: 'hidden',
    background: sc.bg.layout,
    color: sc.text.primary,
  } as CSSProperties,
  header: {
    width: '100%',
    maxWidth: '100vw',
    overflow: 'hidden',
    display: 'grid',
    gap: ps.md,
    padding: `${ps.lg}px ${ps.lg}px ${ps.md}px`,
    background: sc.bg.container,
    borderBottom: `1px solid ${sc.border.default}`,
  } as CSSProperties,
  headerTop: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: ps.md,
    flexWrap: 'wrap',
  } as CSSProperties,
  titleBlock: {
    flex: '1 1 auto',
    display: 'grid',
    gap: ps.xxs,
    minWidth: 0,
    maxWidth: '100%',
  } as CSSProperties,
  title: {
    margin: 0,
    color: sc.text.heading,
    fontSize: st.fontSizeHeading3,
    fontWeight: st.fontWeightStrong,
    lineHeight: st.lineHeightHeading3,
    letterSpacing: 0,
  } as CSSProperties,
  description: {
    margin: 0,
    color: sc.text.secondary,
    fontSize: st.fontSize,
    lineHeight: st.lineHeight,
    maxWidth: '100%',
    overflowWrap: 'anywhere',
    wordBreak: 'break-word',
  } as CSSProperties,
  backLink: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: ps.xxs,
    height: 36,
    padding: `0 ${ps.sm}px`,
    color: sc.text.secondary,
    background: 'transparent',
    border: `1px solid ${sc.border.default}`,
    borderRadius: pr.base,
    textDecoration: 'none',
    fontSize: st.fontSize,
    fontWeight: st.fontWeightMedium,
    lineHeight: st.lineHeight,
  } as CSSProperties,
  metrics: {
    display: 'grid',
    gridTemplateColumns: 'repeat(6, minmax(0, 1fr))',
    gap: ps.sm,
  } as CSSProperties,
  metric: {
    display: 'grid',
    gap: ps.xxs,
    minHeight: 76,
    padding: ps.sm,
    background: sc.bg.elevated,
    border: `1px solid ${sc.border.default}`,
    borderRadius: pr.lg,
  } as CSSProperties,
  metricLabel: {
    color: sc.text.secondary,
    fontSize: st.fontSizeSM,
    lineHeight: st.lineHeightSM,
  } as CSSProperties,
  metricValue: {
    color: sc.text.heading,
    fontSize: st.fontSizeHeading4,
    fontWeight: st.fontWeightStrong,
    lineHeight: st.lineHeightHeading4,
  } as CSSProperties,
  body: {
    width: '100%',
    maxWidth: '100vw',
    display: 'grid',
    gridTemplateColumns: '360px minmax(0, 1fr) 420px',
    gap: ps.sm,
    padding: ps.sm,
    height: 'calc(100vh - 202px)',
    minHeight: 620,
  } as CSSProperties,
  panel: {
    width: '100%',
    minWidth: 0,
    minHeight: 0,
    display: 'flex',
    flexDirection: 'column',
    background: sc.bg.container,
    border: `1px solid ${sc.border.default}`,
    borderRadius: pr.lg,
    overflow: 'hidden',
  } as CSSProperties,
  panelHeader: {
    display: 'grid',
    gap: ps.sm,
    padding: ps.md,
    borderBottom: `1px solid ${sc.border.default}`,
    flexShrink: 0,
  } as CSSProperties,
  panelTitleRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: ps.sm,
  } as CSSProperties,
  panelTitle: {
    display: 'flex',
    alignItems: 'center',
    gap: ps.xs,
    color: sc.text.heading,
    fontSize: st.fontSizeHeading5,
    fontWeight: st.fontWeightStrong,
    lineHeight: st.lineHeightHeading5,
  } as CSSProperties,
  searchBox: {
    display: 'flex',
    alignItems: 'center',
    gap: ps.xs,
    height: 38,
    padding: `0 ${ps.sm}px`,
    background: sc.bg.elevated,
    border: `1px solid ${sc.border.default}`,
    borderRadius: pr.base,
  } as CSSProperties,
  searchInput: {
    minWidth: 0,
    flex: 1,
    height: '100%',
    padding: 0,
    color: sc.text.primary,
    background: 'transparent',
    border: 0,
    outline: 'none',
    fontSize: st.fontSize,
  } as CSSProperties,
  filterRow: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: ps.xs,
  } as CSSProperties,
  select: {
    width: '100%',
    height: 36,
    padding: `0 ${ps.sm}px`,
    color: sc.text.primary,
    background: sc.bg.container,
    border: `1px solid ${sc.border.default}`,
    borderRadius: pr.base,
    outline: 'none',
  } as CSSProperties,
  list: {
    minHeight: 0,
    overflow: 'auto',
    padding: ps.xs,
  } as CSSProperties,
  unitButton: {
    width: '100%',
    display: 'grid',
    gap: ps.xs,
    padding: ps.sm,
    background: 'transparent',
    border: '1px solid transparent',
    borderRadius: pr.base,
    cursor: 'pointer',
    textAlign: 'left',
  } as CSSProperties,
  unitButtonSelected: {
    background: sc.primary.bg,
    borderColor: sc.primary.border,
  } as CSSProperties,
  unitTitle: {
    color: sc.text.heading,
    fontSize: st.fontSize,
    fontWeight: st.fontWeightStrong,
    lineHeight: st.lineHeight,
    overflowWrap: 'anywhere',
  } as CSSProperties,
  unitSub: {
    color: sc.text.secondary,
    fontSize: st.fontSizeSM,
    lineHeight: st.lineHeightSM,
    overflowWrap: 'anywhere',
  } as CSSProperties,
  pillRow: {
    display: 'flex',
    alignItems: 'center',
    gap: ps.xs,
    flexWrap: 'wrap',
  } as CSSProperties,
  pill: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    minHeight: 22,
    padding: `0 ${ps.xs}px`,
    borderRadius: pr.full,
    border: `1px solid ${sc.border.default}`,
    color: sc.text.secondary,
    background: sc.bg.container,
    fontSize: st.fontSizeSM,
    fontWeight: st.fontWeightMedium,
    lineHeight: st.lineHeightSM,
    whiteSpace: 'nowrap',
  } as CSSProperties,
  contentScroll: {
    minHeight: 0,
    overflow: 'auto',
    padding: ps.md,
  } as CSSProperties,
  detailGrid: {
    display: 'grid',
    gap: ps.md,
  } as CSSProperties,
  section: {
    display: 'grid',
    gap: ps.sm,
  } as CSSProperties,
  sectionTitle: {
    margin: 0,
    color: sc.text.heading,
    fontSize: st.fontSizeHeading5,
    fontWeight: st.fontWeightStrong,
    lineHeight: st.lineHeightHeading5,
  } as CSSProperties,
  infoGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: ps.sm,
  } as CSSProperties,
  infoItem: {
    display: 'grid',
    gap: ps.xxs,
    padding: ps.sm,
    background: sc.bg.elevated,
    border: `1px solid ${sc.border.default}`,
    borderRadius: pr.base,
  } as CSSProperties,
  infoLabel: {
    color: sc.text.secondary,
    fontSize: st.fontSizeSM,
    lineHeight: st.lineHeightSM,
  } as CSSProperties,
  infoValue: {
    color: sc.text.heading,
    fontSize: st.fontSize,
    fontWeight: st.fontWeightMedium,
    lineHeight: st.lineHeight,
    overflowWrap: 'anywhere',
  } as CSSProperties,
  textList: {
    display: 'grid',
    gap: ps.xs,
    margin: 0,
    padding: 0,
    listStyle: 'none',
  } as CSSProperties,
  textItem: {
    padding: ps.sm,
    color: sc.text.primary,
    background: sc.bg.elevated,
    border: `1px solid ${sc.border.default}`,
    borderRadius: pr.base,
    fontSize: st.fontSize,
    lineHeight: st.lineHeight,
    overflowWrap: 'anywhere',
  } as CSSProperties,
  keywordCloud: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: ps.xs,
  } as CSSProperties,
  candidateList: {
    display: 'grid',
    gap: ps.xs,
    padding: ps.xs,
    maxHeight: 260,
    overflow: 'auto',
    flexShrink: 0,
  } as CSSProperties,
  candidateButton: {
    display: 'grid',
    gap: ps.xs,
    width: '100%',
    padding: ps.sm,
    background: sc.bg.container,
    border: `1px solid ${sc.border.default}`,
    borderRadius: pr.base,
    cursor: 'pointer',
    textAlign: 'left',
  } as CSSProperties,
  candidateButtonSelected: {
    borderColor: sc.primary.border,
    background: sc.primary.bg,
  } as CSSProperties,
  candidateTop: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: ps.sm,
  } as CSSProperties,
  candidateLabel: {
    color: sc.text.heading,
    fontSize: st.fontSize,
    fontWeight: st.fontWeightStrong,
    lineHeight: st.lineHeight,
    overflowWrap: 'anywhere',
  } as CSSProperties,
  confidence: {
    display: 'inline-flex',
    alignItems: 'center',
    height: 22,
    padding: `0 ${ps.xs}px`,
    borderRadius: pr.full,
    fontSize: st.fontSizeSM,
    fontWeight: st.fontWeightStrong,
    lineHeight: st.lineHeightSM,
    whiteSpace: 'nowrap',
  } as CSSProperties,
  candidateDetail: {
    minHeight: 0,
    display: 'grid',
    gap: ps.sm,
    padding: ps.md,
    borderTop: `1px solid ${sc.border.default}`,
    overflow: 'auto',
  } as CSSProperties,
  emptyState: {
    minHeight: 160,
    display: 'grid',
    placeItems: 'center',
    padding: ps.md,
    color: sc.text.secondary,
    fontSize: st.fontSize,
    lineHeight: st.lineHeight,
    textAlign: 'center',
  } as CSSProperties,
};

function confidenceStyle(confidence: AnchorCandidate['confidence']): CSSProperties {
  if (confidence === 'high') {
    return { color: sc.success.text, background: sc.success.bg, border: `1px solid ${sc.success.border}` };
  }
  if (confidence === 'medium') {
    return { color: sc.warning.text, background: sc.warning.bg, border: `1px solid ${sc.warning.border}` };
  }
  return { color: sc.text.secondary, background: sc.bg.elevated, border: `1px solid ${sc.border.default}` };
}

function metric(label: string, value: string | number) {
  return (
    <div style={styles.metric}>
      <span style={styles.metricLabel}>{label}</span>
      <strong style={styles.metricValue}>{value}</strong>
    </div>
  );
}

function normalize(value: string) {
  return value.replace(/\s+/g, '').toLowerCase();
}

function useNarrowLayout() {
  const [isNarrow, setIsNarrow] = useState(false);

  useEffect(() => {
    const media = window.matchMedia('(max-width: 960px)');
    const update = () => setIsNarrow(media.matches);

    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  return isNarrow;
}

function candidateMatchesFilter(unit: ManualBuilderUnitView, filter: CandidateFilter) {
  if (filter === 'pilot') return Boolean(unit.pilot);
  if (filter === 'needs_anchor') return unit.anchor_group.candidates.length === 0;
  if (filter === 'high') return unit.anchor_group.candidates.some((candidate) => candidate.confidence === 'high');
  return true;
}

function evidenceRows(candidate: AnchorCandidate | null) {
  if (!candidate) return [];
  const preferred = ['table_columns', 'toolbar', 'filters', 'tabs', 'screenshot_file', 'preview', 'class_code', 'screen_id', 'chunk_type'];
  return preferred
    .filter((key) => candidate.evidence[key] != null)
    .map((key) => {
      const value = candidate.evidence[key];
      return {
        key,
        value: Array.isArray(value) ? value.join(', ') : String(value),
      };
    });
}

export function ManualBuilderWorkspace({ dataset }: ManualBuilderWorkspaceProps) {
  const isNarrow = useNarrowLayout();
  const [query, setQuery] = useState('');
  const [part, setPart] = useState<ManualPart | 'all'>('all');
  const [scope, setScope] = useState<AudienceScope | 'all'>('all');
  const [candidateFilter, setCandidateFilter] = useState<CandidateFilter>('pilot');
  const [selectedUnitId, setSelectedUnitId] = useState(dataset.units.find((unit) => unit.pilot?.priority === 1)?.unit_id ?? dataset.units[0]?.unit_id ?? '');
  const [selectedCandidateId, setSelectedCandidateId] = useState('');

  const filteredUnits = useMemo(() => {
    const q = normalize(query);
    return dataset.units
      .filter((unit) => (part === 'all' ? true : unit.taxonomy.manual_part === part))
      .filter((unit) => (scope === 'all' ? true : unit.taxonomy.audience_scope === scope))
      .filter((unit) => candidateMatchesFilter(unit, candidateFilter))
      .filter((unit) => {
        if (!q) return true;
        const blob = normalize(
          [
            unit.unit_id,
            unit.taxonomy.category_title,
            unit.taxonomy.function_title,
            unit.taxonomy.normalized_function_title,
            unit.search.keywords.join(' '),
            unit.anchor_group.candidates.map((candidate) => candidate.label).join(' '),
          ].join(' '),
        );
        return blob.includes(q);
      })
      .sort((a, b) => {
        if (a.pilot && b.pilot) return a.pilot.priority - b.pilot.priority;
        if (a.pilot) return -1;
        if (b.pilot) return 1;
        return Math.min(...a.source.slide_numbers) - Math.min(...b.source.slide_numbers);
      });
  }, [candidateFilter, dataset.units, part, query, scope]);

  const selectedUnit = dataset.units.find((unit) => unit.unit_id === selectedUnitId) ?? filteredUnits[0] ?? dataset.units[0];
  const candidates = selectedUnit?.anchor_group.candidates ?? [];
  const selectedCandidate = candidates.find((candidate) => candidate.candidate_id === selectedCandidateId) ?? candidates[0] ?? null;

  useEffect(() => {
    if (!selectedUnit) return;
    setSelectedCandidateId(selectedUnit.anchor_group.candidates[0]?.candidate_id ?? '');
  }, [selectedUnit?.unit_id]);

  useEffect(() => {
    if (selectedUnit && filteredUnits.some((unit) => unit.unit_id === selectedUnit.unit_id)) return;
    if (filteredUnits[0]) setSelectedUnitId(filteredUnits[0].unit_id);
  }, [filteredUnits, selectedUnit]);

  const topCandidate = selectedUnit?.anchor_group.candidates[0] ?? null;
  const highCount = dataset.units.filter((unit) => unit.anchor_group.candidates.some((candidate) => candidate.confidence === 'high')).length;

  return (
    <main style={styles.shell}>
      <header style={styles.header}>
        <div
          style={{
            ...styles.headerTop,
            flexDirection: isNarrow ? 'column' : 'row',
            alignItems: isNarrow ? 'flex-start' : styles.headerTop.alignItems,
          }}
        >
          <div style={styles.titleBlock}>
            <h1 style={styles.title}>매뉴얼 빌더 · 매장관리 백오피스</h1>
            <p style={styles.description}>
              마스터 PPT에서 추출한 ManualUnit을 실측 화면 Anchor 후보와 연결해 유지보수 기준선을 검토합니다.
            </p>
          </div>
          <Link href="/" style={styles.backLink}>
            <ArrowLeft size={16} />
            변환 화면
          </Link>
        </div>
        <div
          style={{
            ...styles.metrics,
            gridTemplateColumns: isNarrow ? 'minmax(0, 1fr)' : 'repeat(auto-fit, minmax(150px, 1fr))',
          }}
        >
          {metric('ManualUnit', dataset.summary.unitCount)}
          {metric('파일럿', `${dataset.summary.pilotAnchoredCount}/${dataset.summary.pilotCount}`)}
          {metric('실측 Anchor', `${dataset.summary.anchoredUnitCount}/${dataset.summary.unitCount}`)}
          {metric('High 후보', highCount)}
          {metric('프랜차이즈', dataset.summary.franchiseCount)}
          {metric('KMS', dataset.summary.kmsStatus)}
        </div>
      </header>

      <section
        style={{
          ...styles.body,
          gridTemplateColumns: isNarrow ? 'minmax(0, 1fr)' : 'minmax(300px, 360px) minmax(420px, 1fr) minmax(360px, 420px)',
          height: isNarrow ? 'auto' : styles.body.height,
          minHeight: isNarrow ? 0 : styles.body.minHeight,
        }}
      >
        <aside style={styles.panel}>
          <div style={styles.panelHeader}>
            <div style={styles.panelTitleRow}>
              <strong style={styles.panelTitle}>
                <FileText size={18} />
                ManualUnit
              </strong>
              <span style={styles.pill}>{filteredUnits.length}개</span>
            </div>
            <label style={styles.searchBox}>
              <Search size={16} color={sc.text.secondary} />
              <input
                style={styles.searchInput}
                value={query}
                placeholder="기능명, 키워드, 화면명 검색"
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <div style={{ ...styles.filterRow, gridTemplateColumns: isNarrow ? 'minmax(0, 1fr)' : styles.filterRow.gridTemplateColumns }}>
              <select style={styles.select} value={part} onChange={(event) => setPart(event.target.value as ManualPart | 'all')}>
                <option value="all">전체 파트</option>
                <option value="general_summary">요약 파트</option>
                <option value="detailed_manual">세부 매뉴얼</option>
                <option value="appendix">부록</option>
              </select>
              <select style={styles.select} value={scope} onChange={(event) => setScope(event.target.value as AudienceScope | 'all')}>
                <option value="all">전체 범위</option>
                <option value="common">공통</option>
                <option value="franchise">프랜차이즈</option>
              </select>
            </div>
            <select style={styles.select} value={candidateFilter} onChange={(event) => setCandidateFilter(event.target.value as CandidateFilter)}>
              <option value="pilot">파일럿만</option>
              <option value="all">전체 보기</option>
              <option value="high">High 후보 있음</option>
              <option value="needs_anchor">Anchor 없음</option>
            </select>
          </div>
          <div style={styles.list}>
            {filteredUnits.length === 0 ? (
              <div style={styles.emptyState}>조건에 맞는 ManualUnit이 없습니다.</div>
            ) : (
              filteredUnits.map((unit) => {
                const selected = unit.unit_id === selectedUnit?.unit_id;
                const firstCandidate = unit.anchor_group.candidates[0];
                return (
                  <button
                    key={unit.unit_id}
                    type="button"
                    style={{ ...styles.unitButton, ...(selected ? styles.unitButtonSelected : null) }}
                    onClick={() => setSelectedUnitId(unit.unit_id)}
                  >
                    <span style={styles.unitTitle}>{unit.taxonomy.normalized_function_title}</span>
                    <span style={styles.unitSub}>{unit.taxonomy.category_title}</span>
                    <span style={styles.pillRow}>
                      {unit.pilot ? <span style={{ ...styles.pill, color: sc.primary.text, background: sc.primary.bg, borderColor: sc.primary.border }}>P{unit.pilot.priority}</span> : null}
                      <span style={styles.pill}>{partLabel[unit.taxonomy.manual_part]}</span>
                      <span style={styles.pill}>{scopeLabel[unit.taxonomy.audience_scope]}</span>
                      {firstCandidate ? (
                        <span style={{ ...styles.pill, ...confidenceStyle(firstCandidate.confidence) }}>
                          {firstCandidate.confidence}
                        </span>
                      ) : (
                        <span style={{ ...styles.pill, color: sc.error.text, background: sc.error.bg, borderColor: sc.error.border }}>no anchor</span>
                      )}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </aside>

        <section style={styles.panel}>
          <div style={styles.panelHeader}>
            <div style={styles.panelTitleRow}>
              <strong style={styles.panelTitle}>
                <Filter size={18} />
                단위 상세
              </strong>
              {topCandidate ? (
                <span style={{ ...styles.confidence, ...confidenceStyle(topCandidate.confidence) }}>{topCandidate.confidence} · {topCandidate.score}</span>
              ) : (
                <span style={{ ...styles.confidence, color: sc.error.text, background: sc.error.bg, border: `1px solid ${sc.error.border}` }}>Anchor 없음</span>
              )}
            </div>
          </div>
          {selectedUnit ? (
            <div style={styles.contentScroll}>
              <div style={styles.detailGrid}>
                <section style={styles.section}>
                  <h2 style={styles.sectionTitle}>{selectedUnit.taxonomy.normalized_function_title}</h2>
                  <div style={styles.pillRow}>
                    <span style={styles.pill}>{selectedUnit.unit_id}</span>
                    <span style={styles.pill}>slides {selectedUnit.source.slide_numbers.join(', ')}</span>
                    <span style={styles.pill}>{partLabel[selectedUnit.taxonomy.manual_part]}</span>
                    <span style={styles.pill}>{scopeLabel[selectedUnit.taxonomy.audience_scope]}</span>
                  </div>
                </section>

                <section style={styles.section}>
                  <h3 style={styles.sectionTitle}>원문과 정규화</h3>
                  <div style={{ ...styles.infoGrid, gridTemplateColumns: isNarrow ? 'minmax(0, 1fr)' : styles.infoGrid.gridTemplateColumns }}>
                    <div style={styles.infoItem}>
                      <span style={styles.infoLabel}>원본 카테고리</span>
                      <strong style={styles.infoValue}>{selectedUnit.taxonomy.category_title}</strong>
                    </div>
                    <div style={styles.infoItem}>
                      <span style={styles.infoLabel}>원본 기능명</span>
                      <strong style={styles.infoValue}>{selectedUnit.taxonomy.function_title}</strong>
                    </div>
                    <div style={styles.infoItem}>
                      <span style={styles.infoLabel}>정규화 기능명</span>
                      <strong style={styles.infoValue}>{selectedUnit.taxonomy.normalized_function_title}</strong>
                    </div>
                    <div style={styles.infoItem}>
                      <span style={styles.infoLabel}>장 번호</span>
                      <strong style={styles.infoValue}>{selectedUnit.taxonomy.chapter_no ?? '없음'}</strong>
                    </div>
                  </div>
                </section>

                <section style={styles.section}>
                  <h3 style={styles.sectionTitle}>PPT 텍스트 근거</h3>
                  {selectedUnit.content_summary.text_blocks.length === 0 ? (
                    <div style={styles.emptyState}>본문 텍스트 블록이 없습니다.</div>
                  ) : (
                    <ul style={styles.textList}>
                      {selectedUnit.content_summary.text_blocks.slice(0, 8).map((text, index) => (
                        <li key={`${selectedUnit.unit_id}-${index}`} style={styles.textItem}>
                          {text}
                        </li>
                      ))}
                    </ul>
                  )}
                </section>

                <section style={styles.section}>
                  <h3 style={styles.sectionTitle}>검색 키워드</h3>
                  <div style={styles.keywordCloud}>
                    {selectedUnit.search.keywords.slice(0, 24).map((keyword) => (
                      <span key={keyword} style={styles.pill}>
                        {keyword}
                      </span>
                    ))}
                  </div>
                </section>
              </div>
            </div>
          ) : (
            <div style={styles.emptyState}>ManualUnit을 선택하세요.</div>
          )}
        </section>

        <aside style={styles.panel}>
          <div style={styles.panelHeader}>
            <div style={styles.panelTitleRow}>
              <strong style={styles.panelTitle}>
                <Link2 size={18} />
                Anchor 후보
              </strong>
              <span style={styles.pill}>{candidates.length}개</span>
            </div>
            <div style={styles.pillRow}>
              {dataset.summary.kmsStatus === 'available' ? (
                <span style={{ ...styles.pill, color: sc.success.text, background: sc.success.bg, borderColor: sc.success.border }}>
                  <Database size={14} />
                  KMS 연결
                </span>
              ) : (
                <span style={{ ...styles.pill, color: sc.warning.text, background: sc.warning.bg, borderColor: sc.warning.border }}>
                  <AlertCircle size={14} />
                  KMS 대기
                </span>
              )}
              <span style={styles.pill}>
                <Monitor size={14} />
                실측 {dataset.summary.realmeasureScreenCount}
              </span>
            </div>
          </div>

          {candidates.length === 0 ? (
            <div style={styles.emptyState}>이 ManualUnit에는 아직 Anchor 후보가 없습니다.</div>
          ) : (
            <>
              <div style={styles.candidateList}>
                {candidates.map((candidate) => {
                  const selected = candidate.candidate_id === selectedCandidate?.candidate_id;
                  return (
                    <button
                      key={candidate.candidate_id}
                      type="button"
                      style={{ ...styles.candidateButton, ...(selected ? styles.candidateButtonSelected : null) }}
                      onClick={() => setSelectedCandidateId(candidate.candidate_id)}
                    >
                      <span style={styles.candidateTop}>
                        <span style={styles.candidateLabel}>{candidate.label}</span>
                        <span style={{ ...styles.confidence, ...confidenceStyle(candidate.confidence) }}>{candidate.score}</span>
                      </span>
                      <span style={styles.pillRow}>
                        <span style={styles.pill}>{candidate.candidate_type}</span>
                        <span style={{ ...styles.pill, ...confidenceStyle(candidate.confidence) }}>{candidate.confidence}</span>
                      </span>
                    </button>
                  );
                })}
              </div>

              <div style={styles.candidateDetail}>
                <section style={styles.section}>
                  <h3 style={styles.sectionTitle}>매칭 근거</h3>
                  <div style={styles.keywordCloud}>
                    {selectedCandidate?.match_reason.map((reason) => (
                      <span key={reason} style={styles.pill}>
                        <CheckCircle2 size={14} />
                        {reason}
                      </span>
                    ))}
                  </div>
                </section>

                <section style={styles.section}>
                  <h3 style={styles.sectionTitle}>일치 키워드</h3>
                  <div style={styles.keywordCloud}>
                    {selectedCandidate?.matched_terms.map((term) => (
                      <span key={term} style={styles.pill}>
                        {term}
                      </span>
                    ))}
                  </div>
                </section>

                <section style={styles.section}>
                  <h3 style={styles.sectionTitle}>증거 데이터</h3>
                  <div style={{ ...styles.infoGrid, gridTemplateColumns: isNarrow ? 'minmax(0, 1fr)' : styles.infoGrid.gridTemplateColumns }}>
                    {evidenceRows(selectedCandidate).map((row) => (
                      <div key={row.key} style={styles.infoItem}>
                        <span style={styles.infoLabel}>{row.key}</span>
                        <strong style={styles.infoValue}>{row.value}</strong>
                      </div>
                    ))}
                  </div>
                  {selectedCandidate?.url ? (
                    <Button variant="default" onClick={() => window.open(selectedCandidate.url ?? '', '_blank', 'noopener,noreferrer')}>
                      <ExternalLink size={15} />
                      실측 URL 열기
                    </Button>
                  ) : null}
                </section>
              </div>
            </>
          )}
        </aside>
      </section>
    </main>
  );
}
