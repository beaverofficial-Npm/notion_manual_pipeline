// PPT 슬라이드를 목차 계층(카테고리/기능)과 본문 위계 블록으로 해부하는 순수 파서.
// DB/파일시스템에 의존하지 않는다. 입력은 slide XML 문자열, 출력은 구조화된 객체.
// 실측 기준: docs 통합가이드 PPT의 shape 배치(섹션 표지 = 숫자 shape + 좌측 카테고리명 + 우측 기능목록,
// 본문 = zero-box 그룹라벨 + 상단 기능명 + 우측 단계 문단).

// 스텝 인식: "N." 은 공백 필수(소수점 오인 방지), "N)" 는 공백 없어도 인정("2)사용자").
// 계층 스텝 "1-1." / "1-2)" 도 인식한다(서브스텝 번호 보존).
const STEP_RE = /^\s*\d{1,2}(?:\s*-\s*\d{1,2})?\s*(?:\.\s+|\)\s*)/;
const DIGIT_ONLY_RE = /^\d{1,2}$/;
const SENTENCE_END_RE = /(다|요|죠)\s*[.。]\s*$/;
const GROUP_PREFIX_RE = /^\s*\d{1,2}(?:\s*-\s*\d{1,2})?\s*[.．]\s*/;
const SUB_RE = /^\s*(?:[•·∙▪◦\-–]|\d+\s*-\s*\d+)\s*/;
const TIP_INLINE_RE = /^\s*[*※]/;
const TIP_HEADER_RE = /^(유의사항|유의|참고사항|참고|주의사항|주의|TIP)\s*$/i;
const TIP_WORD_RE = /^(유의사항|유의|참고|주의사항|주의|단,|TIP)/i;
const NUMBER_ONLY_RE = /^0?\d{1,2}\s*[.．]?\s*$/;
const TOC_RE = /목\s*차|contents/i;
const COVER_RE = /이용\s*가이드|기본\s*메\s*[뉴유]\s*얼|전용\s*메\s*[뉴유]\s*얼|통합\s*가이드/;
// 속표지(섹션 표지): "…메뉴얼/매뉴얼/가이드" 로 끝나는 짧은 제목. 덱 중간(slideNumber>2)에서도 표지로 잡기 위함.
const MANUAL_TITLE_RE = /(?:메\s*[뉴유]\s*얼|매\s*뉴\s*얼|가\s*이\s*드)\s*$/;
const REP_SCREEN_RE = /^대표\s*화면$/;

export function decodeXml(value) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

export function normalizeName(value) {
  return (value ?? '')
    .replace(/스템프/g, '스탬프')
    .replace(/\s+/g, '')
    .toLowerCase()
    .replace(/[^0-9a-z가-힣]/g, '');
}

function attr(source, name) {
  const match = source.match(new RegExp(`${name}="([^"]*)"`));
  return match?.[1] ?? '';
}

function firstNumber(source, pattern) {
  const match = source.match(pattern);
  return match ? Number(match[1]) : 0;
}

function blocksOf(xml, tag) {
  const out = [];
  const regex = new RegExp(`<p:${tag}[\\s\\S]*?</p:${tag}>`, 'g');
  let match;
  while ((match = regex.exec(xml))) out.push(match[0]);
  return out;
}

function paragraphsOf(block) {
  const paras = [];
  const regex = /<a:p>([\s\S]*?)<\/a:p>/g;
  let match;
  while ((match = regex.exec(block))) {
    const text = [...match[1].matchAll(/<a:t>(.*?)<\/a:t>/g)]
      .map((m) => decodeXml(m[1]))
      .join('')
      .replace(/\s+/g, ' ')
      .trim();
    if (text) paras.push(text);
  }
  return paras;
}

function joinedText(block) {
  return [...block.matchAll(/<a:t>(.*?)<\/a:t>/g)]
    .map((m) => decodeXml(m[1]))
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}

function rawBox(block) {
  return {
    x: firstNumber(block, /<a:off[^>]*x="(-?\d+)"/),
    y: firstNumber(block, /<a:off[^>]*y="(-?\d+)"/),
    w: firstNumber(block, /<a:ext[^>]*cx="(\d+)"/),
    h: firstNumber(block, /<a:ext[^>]*cy="(\d+)"/),
  };
}

function percentBox(box, slideSize) {
  if (!slideSize.cx || !slideSize.cy) return { left: 0, top: 0, width: 0, height: 0 };
  return {
    left: Number(((box.x / slideSize.cx) * 100).toFixed(2)),
    top: Number(((box.y / slideSize.cy) * 100).toFixed(2)),
    width: Number(((box.w / slideSize.cx) * 100).toFixed(2)),
    height: Number(((box.h / slideSize.cy) * 100).toFixed(2)),
  };
}

function extractTables(xml) {
  const tables = [];
  for (const tbl of blocksOf(xml, 'graphicFrame')) {
    if (!/<a:tbl[\s>]/.test(tbl)) continue;
    const rows = [];
    const trRegex = /<a:tr[\s\S]*?<\/a:tr>/g;
    let tr;
    while ((tr = trRegex.exec(tbl))) {
      const cells = [];
      const tcRegex = /<a:tc[\s>][\s\S]*?<\/a:tc>/g;
      let tc;
      while ((tc = tcRegex.exec(tr[0]))) cells.push(paragraphsOf(tc[0]).join('\n'));
      if (cells.length) rows.push(cells);
    }
    if (rows.length) tables.push(rows);
  }
  return tables;
}

// slide XML → shape/pic/table 구조
export function parseSlideShapes(slideXml, slideSize) {
  const shapes = blocksOf(slideXml, 'sp')
    .map((block) => {
      const box = rawBox(block);
      const text = joinedText(block);
      return {
        text,
        paragraphs: paragraphsOf(block),
        name: decodeXml(attr(block, 'name')),
        box,
        bbox: percentBox(box, slideSize),
        isGroupLabel: (box.w === 0 && box.h === 0) || (box.x === 0 && box.y === 0),
      };
    })
    .filter((shape) => shape.text);

  const pics = blocksOf(slideXml, 'pic')
    .map((block) => {
      const box = rawBox(block);
      const areaRatio = slideSize.cx && slideSize.cy ? (box.w * box.h) / (slideSize.cx * slideSize.cy) : 0;
      return {
        name: decodeXml(attr(block, 'name')),
        box,
        bbox: percentBox(box, slideSize),
        areaRatio: Number(areaRatio.toFixed(4)),
      };
    })
    .filter((pic) => pic.box.w > 0 && pic.box.h > 0);

  return { shapes, pics, tables: extractTables(slideXml) };
}

function hasSteps(parsed) {
  return parsed.shapes.some((shape) => shape.paragraphs.some((p) => STEP_RE.test(p)));
}

export function classifyRole(parsed, slideNumber) {
  const joined = parsed.shapes.map((s) => s.text).join(' ');
  if (TOC_RE.test(joined)) return 'toc';
  const steps = hasSteps(parsed);
  // 덱 중간의 속표지: 스텝 없이 "…메뉴얼/매뉴얼/가이드"로 끝나는 짧은 제목이 있고, 본문 텍스트가 희박한(표지성) 슬라이드.
  // 표지에 큰 히어로 이미지가 있을 수 있으므로 이미지 유무가 아니라 텍스트가 희박한지로 판별한다.
  const bodyTextShapes = parsed.shapes.filter((s) => !s.isGroupLabel && s.text.length > 1);
  const titleLike = bodyTextShapes.some((s) => MANUAL_TITLE_RE.test(s.text) && s.text.length <= 30);
  const sparse = bodyTextShapes.length <= 3;
  if (!steps && (slideNumber <= 2 || COVER_RE.test(joined) || (titleLike && sparse))) return 'cover';
  const numberShape = parsed.shapes.some((s) => NUMBER_ONLY_RE.test(s.text));
  if (!steps && numberShape) return 'section';
  return 'content';
}

// 섹션 표지: 좌측 카테고리명 + 우측 기능목록(우측 컬럼에 목록이 있을 때만)
export function extractSection(parsed) {
  const named = parsed.shapes.filter((s) => !NUMBER_ONLY_RE.test(s.text) && !s.isGroupLabel);

  const titleCandidates = named
    .filter((s) => s.bbox.left < 50 && s.text.length <= 24 && !SENTENCE_END_RE.test(s.text))
    .sort((a, b) => a.bbox.top - b.bbox.top || a.text.length - b.text.length);
  const categoryTitle = titleCandidates[0]?.text ?? named[0]?.text ?? '카테고리';

  // 기능목록은 우측 컬럼(목차형 섹션)에만 존재. 없으면 본문 슬라이드에서 생성한다.
  const functionTitles = named
    .filter((s) => s.bbox.left >= 50 && s.text !== categoryTitle && !SENTENCE_END_RE.test(s.text))
    .sort((a, b) => a.bbox.top - b.bbox.top)
    .map((s) => s.text)
    .filter((t) => t && t.length <= 40);

  return { categoryTitle, functionTitles };
}

// 본문 슬라이드의 기능명: 상단 좌측의 짧은 제목 shape. 없으면 그룹라벨에서 유도.
export function extractContentFunctionName(parsed) {
  const candidates = parsed.shapes.filter(
    (s) =>
      !s.isGroupLabel &&
      !REP_SCREEN_RE.test(s.text) &&
      !DIGIT_ONLY_RE.test(s.text) &&
      s.text.length >= 2 &&
      s.bbox.top < 28 &&
      s.bbox.left < 58 &&
      s.text.length <= 40 &&
      !s.paragraphs.some((p) => STEP_RE.test(p)),
  );
  candidates.sort((a, b) => a.bbox.top - b.bbox.top || a.bbox.left - b.bbox.left);
  if (candidates[0]) return candidates[0].text;

  const groupLabel = parsed.shapes.find((s) => s.isGroupLabel)?.text;
  if (groupLabel) {
    const cleaned = groupLabel.replace(GROUP_PREFIX_RE, '').trim();
    if (cleaned) return cleaned;
  }
  return null;
}

// 한 문단에 "1. … 2. … 3. …" 처럼 스텝이 줄바꿈 없이 붙어 있으면 경계에서 쪼갠다.
// 경계 = 직전 문자가 문장끝/공백/괄호 + 숫자 + .) + 공백. ("9.2" 같은 소수점은 뒤 공백이 없어 안 쪼개짐.)
function splitInlineSteps(text) {
  // 직전이 숫자/하이픈이 아니면 스텝마커 앞에서 쪼갠다.
  // "선택2)"처럼 붙은 건 분리하되, "10."·"3.5"(숫자 중간)·"1-1."(계층번호)은 안 쪼개짐.
  return text
    .split(/(?<![\d-])(?=\d{1,2}[.)]\s)/)
    .map((p) => p.trim())
    .filter(Boolean);
}

// 본문이 아닌 라벨/캡션 판별:
//  - 상단 제목밴드(top<28): 섹션 브레드크럼·기능명 반복
//  - 본문 이미지 갤러리 영역과 겹치는 짧은 라벨: 이미지 캡션(가운데여도 잡힘 — 밴드 의존 X)
// 스텝/문장/긴 텍스트/콜아웃 헤더(유의·참고)는 위치와 무관하게 본문으로 보존한다.
function makeIsStrayLabel(parsed) {
  let gx0 = 100, gy0 = 100, gx1 = 0, gy1 = 0, hasPics = false;
  for (const p of parsed.pics) {
    if (p.areaRatio < 0.005) continue; // 장식 아이콘 제외, 본문 썸네일만
    hasPics = true;
    gx0 = Math.min(gx0, p.bbox.left);
    gy0 = Math.min(gy0, p.bbox.top);
    gx1 = Math.max(gx1, p.bbox.left + p.bbox.width);
    gy1 = Math.max(gy1, p.bbox.top + p.bbox.height);
  }
  return function isStrayLabel(s) {
    if (s.paragraphs.some((p) => STEP_RE.test(p))) return false;
    if (TIP_HEADER_RE.test(s.text.trim())) return false;
    if (SENTENCE_END_RE.test(s.text)) return false;
    if (s.text.length > 20) return false;
    if (s.bbox.top < 28) return true;
    if (!hasPics) return false;
    const cx = s.bbox.left + s.bbox.width / 2;
    const cy = s.bbox.top + s.bbox.height / 2;
    return cx >= gx0 && cx <= gx1 && cy >= gy0 && cy <= gy1; // 갤러리 영역 안 = 캡션
  };
}

export function buildFunctionBlocks(parsed, functionName) {
  const fnNorm = normalizeName(functionName ?? '');
  const isStrayLabel = makeIsStrayLabel(parsed);
  const bodyShapes = parsed.shapes
    .filter(
      (s) =>
        !s.isGroupLabel &&
        !REP_SCREEN_RE.test(s.text) &&
        normalizeName(s.text) !== fnNorm &&
        !NUMBER_ONLY_RE.test(s.text) &&
        !isStrayLabel(s),
    )
    .sort((a, b) => a.bbox.top - b.bbox.top || a.bbox.left - b.bbox.left);

  const blocks = [];
  let currentStep = null;
  let pendingTip = false;

  function pushChildOrTop(child) {
    if (currentStep) currentStep.children.push(child);
    else blocks.push({ kind: child.kind === 'bulleted' ? 'bulleted_list' : child.kind, text: child.text });
  }

  for (const shape of bodyShapes) {
    if (TIP_HEADER_RE.test(shape.text.trim()) && shape.paragraphs.length <= 1) {
      pendingTip = true;
      continue;
    }

    for (const para of shape.paragraphs.flatMap((p) => splitInlineSteps(p))) {
      const t = para.trim();
      if (!t) continue;

      if (pendingTip) {
        blocks.push({ kind: 'callout', text: t });
        continue;
      }

      if (STEP_RE.test(t)) {
        const lead = t.match(/^\s*(\d{1,2})/);
        const labelM = t.match(/^\s*(\d{1,2}(?:\s*-\s*\d{1,2})?\s*[.)])/);
        const prefix = labelM ? labelM[1].replace(/\s+/g, '') : null; // 원본 마커 그대로: "1.", "1)", "1-1."
        currentStep = {
          kind: 'numbered_list',
          number: lead ? Number(lead[1]) : null,
          marker: prefix ? prefix.slice(-1) : '.',
          prefix,
          text: t.replace(STEP_RE, '').trim(),
          children: [],
        };
        blocks.push(currentStep);
      } else if (TIP_INLINE_RE.test(t) || TIP_WORD_RE.test(t)) {
        pushChildOrTop({ kind: 'callout', text: t.replace(/^\s*[*※]\s*/, '').trim() });
      } else if (SUB_RE.test(t)) {
        pushChildOrTop({ kind: 'bulleted', text: t.replace(SUB_RE, '').trim() });
      } else {
        pushChildOrTop({ kind: 'paragraph', text: t });
      }
    }
    pendingTip = false;
  }

  for (const table of parsed.tables) {
    blocks.push({ kind: 'table', rows: table });
  }

  return blocks;
}

// 두 bbox 가 gap(%) 이내로 인접/중첩하는지
function boxesNear(a, b, gap) {
  const ar = a.left + a.width;
  const ab = a.top + a.height;
  const br = b.left + b.width;
  const bb = b.top + b.height;
  const gapX = Math.max(0, Math.max(a.left, b.left) - Math.min(ar, br));
  const gapY = Math.max(0, Math.max(a.top, b.top) - Math.min(ab, bb));
  return gapX <= gap && gapY <= gap;
}

// 화면 이미지 후보. 개별 이미지를 따로 자르지 않고, 인접한 이미지들을 하나의 "영역(zone)"으로
// 묶어 그 영역 전체를 한 벌로 크롭한다(사이의 화살표/어노테이션까지 함께 담기 위함).
// 멀리 떨어진 추가 이미지는 별도 zone 으로 분리된다.
export function screenshotCandidates(parsed) {
  // 장식/로고(작은 것, 상·하단 헤더/푸터) 제외
  const pics = parsed.pics.filter((p) => p.areaRatio >= 0.015 && p.bbox.top >= 8 && p.bbox.top <= 90);
  if (!pics.length) return [];

  const GAP = 8;
  const parent = pics.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const union = (i, j) => {
    parent[find(i)] = find(j);
  };
  for (let i = 0; i < pics.length; i += 1) {
    for (let j = i + 1; j < pics.length; j += 1) {
      if (boxesNear(pics[i].bbox, pics[j].bbox, GAP)) union(i, j);
    }
  }

  const groups = new Map();
  pics.forEach((pic, i) => {
    const root = find(i);
    const g = groups.get(root) ?? { left: 100, top: 100, right: 0, bottom: 0, count: 0 };
    g.left = Math.min(g.left, pic.bbox.left);
    g.top = Math.min(g.top, pic.bbox.top);
    g.right = Math.max(g.right, pic.bbox.left + pic.bbox.width);
    g.bottom = Math.max(g.bottom, pic.bbox.top + pic.bbox.height);
    g.count += 1;
    groups.set(root, g);
  });

  const PAD = 1.5;
  return [...groups.values()]
    .map((g) => {
      const left = Math.max(0, Number((g.left - PAD).toFixed(2)));
      const top = Math.max(0, Number((g.top - PAD).toFixed(2)));
      const width = Number(Math.min(100 - left, g.right - g.left + PAD * 2).toFixed(2));
      const height = Number(Math.min(100 - top, g.bottom - g.top + PAD * 2).toFixed(2));
      return { bbox: { left, top, width, height }, area: width * height, count: g.count };
    })
    .sort((a, b) => b.area - a.area)
    .map((zone, index) => ({
      bbox: zone.bbox,
      areaRatio: Number((zone.area / 10000).toFixed(4)),
      confidence: 0.8,
      label: index === 0 ? '대표 이미지 영역' : `추가 이미지 영역 ${index}`,
    }));
}
