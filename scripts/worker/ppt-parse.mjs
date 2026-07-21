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
// 유의/참고 헤더 — 본문 보존 판별(isStrayLabel)에만 사용. 콜아웃 변환은 하지 않는다(원본 그대로 노출).
const TIP_HEADER_RE = /^(유의사항|유의|참고사항|참고|주의사항|주의|TIP)\s*$/i;
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

// 문단 내 수동 줄바꿈 <a:br>(rPr 자식을 가진 짝태그형 포함)을 구분자로 치환.
// 무시하고 run 을 이어붙이면 "…있어요a. 일괄 설정 시a-1.…" 처럼 줄이 뭉개진다(실측 04#60/61).
function splitBreaks(inner) {
  return inner
    .replace(/<a:br\b[^>]*>[\s\S]*?<\/a:br>/g, '\u0000')
    .replace(/<a:br\b[^>]*\/>/g, '\u0000')
    .split('\u0000');
}

function runsText(segment) {
  return [...segment.matchAll(/<a:t>(.*?)<\/a:t>/g)]
    .map((m) => decodeXml(m[1]))
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}

function paragraphsOf(block) {
  const paras = [];
  const regex = /<a:p>([\s\S]*?)<\/a:p>/g;
  let match;
  while ((match = regex.exec(block))) {
    for (const seg of splitBreaks(match[1])) {
      const text = runsText(seg);
      if (text) paras.push(text);
    }
  }
  return paras;
}

function joinedText(block) {
  return splitBreaks(block)
    .map(runsText)
    .filter(Boolean)
    .join(' ')
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

// spTree 를 그룹 변환(off/ext ↔ chOff/chExt) 추적하며 걸어, 그룹 안 도형까지 **절대 좌표**로 수집한다.
// (그룹 안 sp/pic 은 좌표가 그룹-내부 기준이라, 변환 없이 읽으면 (0,0) 등 쓰레기 값 →
//  "그룹라벨"로 오인돼 본문에서 통째로 증발했다. 예: 키오스크 상품설정 설명 텍스트)
function collectDrawables(segment, tf, out, inGroup = false) {
  const tokenRe = /<p:grpSp\b[^>]*>|<\/p:grpSp>|<p:sp>[\s\S]*?<\/p:sp>|<p:pic>[\s\S]*?<\/p:pic>/g;
  let depth = 0;
  let grpStart = -1;
  let m;
  while ((m = tokenRe.exec(segment))) {
    const t = m[0];
    if (t.startsWith('<p:grpSp')) {
      if (depth === 0) grpStart = m.index + t.length;
      depth += 1;
      continue;
    }
    if (t.startsWith('</p:grpSp')) {
      depth -= 1;
      if (depth === 0 && grpStart >= 0) {
        const inner = segment.slice(grpStart, m.index);
        const pr = inner.match(/<p:grpSpPr\b[\s\S]*?<\/p:grpSpPr>/)?.[0] ?? '';
        const offX = firstNumber(pr, /<a:off[^>]*x="(-?\d+)"/);
        const offY = firstNumber(pr, /<a:off[^>]*y="(-?\d+)"/);
        const extX = firstNumber(pr, /<a:ext[^>]*cx="(\d+)"/);
        const extY = firstNumber(pr, /<a:ext[^>]*cy="(\d+)"/);
        const chOffX = firstNumber(pr, /<a:chOff[^>]*x="(-?\d+)"/);
        const chOffY = firstNumber(pr, /<a:chOff[^>]*y="(-?\d+)"/);
        const chExtX = firstNumber(pr, /<a:chExt[^>]*cx="(\d+)"/);
        const chExtY = firstNumber(pr, /<a:chExt[^>]*cy="(\d+)"/);
        const gx = extX && chExtX ? extX / chExtX : 1;
        const gy = extY && chExtY ? extY / chExtY : 1;
        const child = {
          ox: tf.ox + (offX - chOffX * gx) * tf.sx,
          oy: tf.oy + (offY - chOffY * gy) * tf.sy,
          sx: tf.sx * gx,
          sy: tf.sy * gy,
        };
        collectDrawables(inner, child, out, true);
        grpStart = -1;
      }
      continue;
    }
    if (depth > 0) continue; // 그룹 내부는 위 재귀에서 처리
    out.push({ kind: t.startsWith('<p:sp>') ? 'sp' : 'pic', block: t, tf, inGroup });
  }
}

// slide XML → shape/pic/table 구조 (그룹 안 도형 포함, 전부 절대 좌표)
export function parseSlideShapes(slideXml, slideSize) {
  const treeMatch = slideXml.match(/<p:spTree[^>]*>([\s\S]*?)<\/p:spTree>/);
  const tree = treeMatch ? treeMatch[1] : slideXml;
  const drawables = [];
  collectDrawables(tree, { ox: 0, oy: 0, sx: 1, sy: 1 }, drawables);

  const absBox = (block, tf) => {
    const b = rawBox(block);
    return {
      x: Math.round(tf.ox + b.x * tf.sx),
      y: Math.round(tf.oy + b.y * tf.sy),
      w: Math.round(b.w * tf.sx),
      h: Math.round(b.h * tf.sy),
    };
  };

  const shapes = drawables
    .filter((d) => d.kind === 'sp')
    .map(({ block, tf, inGroup }) => {
      const box = absBox(block, tf);
      const text = joinedText(block);
      return {
        text,
        paragraphs: paragraphsOf(block),
        name: decodeXml(attr(block, 'name')),
        box,
        bbox: percentBox(box, slideSize),
        fromGroup: Boolean(inGroup),
        isGroupLabel: (box.w === 0 && box.h === 0) || (box.x === 0 && box.y === 0),
      };
    })
    .filter((shape) => shape.text);

  const pics = drawables
    .filter((d) => d.kind === 'pic')
    .map(({ block, tf }) => {
      const box = absBox(block, tf);
      const areaRatio = slideSize.cx && slideSize.cy ? (box.w * box.h) / (slideSize.cx * slideSize.cy) : 0;
      return {
        id: attr(block, 'id'),
        name: decodeXml(attr(block, 'name')),
        relationshipId: attr(block, 'r:embed'),
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
  // 챕터 표지: 큰 챕터 숫자("01."~, h≥6% — 실측: 챕터 10.7~12.0 vs 뱃지 ≤4.7)가 있으면
  // 우측 메뉴의 "3-1. 매출캘린더" 같은 라벨이 스텝으로 오인되더라도 표지다.
  const bigNumberShape = parsed.shapes.some(
    (s) => !s.isGroupLabel && NUMBER_ONLY_RE.test(s.text) && s.bbox.height >= 6,
  );
  if (bigNumberShape) return 'section';
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
  // 브레드크럼 예외: 맨 위 후보가 작은 라벨이고, 같은 열 바로 아래에 훨씬 큰(1.8×↑) 텍스트가
  // 붙어 있으면(간격<2.5%) 그 아래 큰 것이 실제 제목이다. (실측: 브레드크럼 h2.6% + 제목 h5.4%, 간격 0.5%)
  // 그 외에는 기존 "맨 위" 규칙 유지 — 전수 스캔에서 넓은 규칙(최대높이)은 다른 덱 36곳을 역행시켰음.
  if (candidates.length >= 2) {
    const a = candidates[0];
    const b = candidates[1];
    const gap = b.bbox.top - (a.bbox.top + a.bbox.height);
    const sameColumn = Math.abs(a.bbox.left - b.bbox.left) < 5;
    // 크기 가드: 브레드크럼은 작고(h≤3.5), 제목은 제목 크기(h≤7)여야 한다.
    // (없으면 여러 줄 문장·본문 컨테이너(h 8.9~66 실측)가 제목으로 승격되는 오발동)
    const aIsSmallLabel = (a.bbox.height ?? 99) <= 3.5;
    const bIsTitleSized = (b.bbox.height ?? 99) <= 7;
    if (sameColumn && gap < 2.5 && aIsSmallLabel && bIsTitleSized && (b.bbox.height ?? 0) >= (a.bbox.height ?? 0) * 1.8) {
      return b.text;
    }
  }
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
  // 문단 안에 "1. … 2. …"처럼 붙은 스텝을 경계에서 쪼갠다.
  // 분리 조건: 직전 문자가 숫자/하이픈 아님("10."·"3.5"·"1-1." 보호) + **괄호 밖**일 것.
  // 괄호 안 숫자 "(참고1)"·"비고(주1)"은 스텝 마커가 아니다 — 쪼개면 "(참고 / 1)…"로 줄이 깨진다.
  const parts = [];
  let start = 0;
  let depth = 0;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '(' || ch === '（' || ch === '[' || ch === '【') depth += 1;
    else if (ch === ')' || ch === '）' || ch === ']' || ch === '】') { if (depth > 0) depth -= 1; }
    if (depth > 0) continue;
    if (i > start && /\d/.test(ch) && !/[\d-]/.test(text[i - 1]) && /^\d{1,2}[.)]\s/.test(text.slice(i))) {
      parts.push(text.slice(start, i));
      start = i;
    }
  }
  parts.push(text.slice(start));
  return parts.map((p) => p.trim()).filter(Boolean);
}

// 본문이 아닌 라벨/캡션 판별:
//  - 상단 제목밴드(top<28): 섹션 브레드크럼·기능명 반복
//  - 본문 이미지 갤러리 영역과 겹치는 짧은 라벨: 이미지 캡션(가운데여도 잡힘 — 밴드 의존 X)
// 스텝/문장/긴 텍스트/콜아웃 헤더(유의·참고)는 위치와 무관하게 본문으로 보존한다.
function makeIsStrayLabel(parsed) {
  // 불변 레이아웃: 왼쪽 = 이미지 판(우변 ≤64.3%), 본문 컬럼은 66.2%~ 에서 시작.
  // 따라서 "판 측" 판정은 이미지 합집합(갤러리)이 아니라 중심 x ≤ 65.5% 하나로 충분하다.
  // (갤러리 합집합 방식은 ①우측 참조 이미지가 섞이면 본문 컬럼을 덮어 본문이 증발하고
  //  ②판 아래 캡션("▲설정 적용 예시" 등)은 이미지 합집합 밖이라 못 걸렀다 — 실측으로 폐기)
  const PLATE_MAX_CENTER_X = 65.5;
  const hasPics = parsed.pics.some((p) => p.areaRatio >= 0.005); // 장식 아이콘 제외
  const onPlateSide = (s) => hasPics && s.bbox.left + s.bbox.width / 2 <= PLATE_MAX_CENTER_X;
  return function isStrayLabel(s) {
    // 최상단 밴드는 제목·브레드크럼 전용 영역 — "2. 키오스크 화면설명" 같은 번호 달린
    // 브레드크럼이 스텝으로 승격돼 본문을 삼키는 것 방지. 판정은 **중심 y** 기준:
    // 우측 본문 텍스트박스는 위(T5~10)에서 시작해도 키가 커서 중심이 40% 부근이고,
    // 브레드크럼은 중심까지 상단(≈12%)에 있다. top 기준으로 하면 본문 통째 증발(실측 5장).
    if (s.bbox.top + s.bbox.height / 2 < 16) return true;
    // 판 측 "그룹" 텍스트(말풍선·주석·캡션·그룹 라벨)는 스텝 형태여도 무조건 픽셀 —
    // 시각 덩어리의 일부다. (그룹이어도 우측 본문 컬럼이면 본문으로 계속 — 예: 키오#46 설명)
    if (s.fromGroup && onPlateSide(s)) return true;
    if (s.paragraphs.some((p) => STEP_RE.test(p))) return false;
    if (TIP_HEADER_RE.test(s.text.trim())) return false;
    if (SENTENCE_END_RE.test(s.text)) return false;
    if (s.text.length > 20) return false;
    if (s.bbox.top < 28) return true;
    // 톱레벨 짧은 라벨(비문장·≤20자)이 판 측 = 이미지 위 라벨/캡션
    if (onPlateSide(s)) return true;
    return false;
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

  function pushChildOrTop(child) {
    if (currentStep) currentStep.children.push(child);
    else blocks.push({ kind: child.kind === 'bulleted' ? 'bulleted_list' : child.kind, text: child.text });
  }

  // 유의/참고(※·유의사항 등)는 콜아웃으로 변환하지 않고 원본 텍스트 그대로 내보낸다.
  // (콜아웃 변환 과정에서 빈 박스·내용 누락이 잦았음 — PPT에 보이는 그대로가 정답)
  for (const shape of bodyShapes) {
    for (const para of shape.paragraphs.flatMap((p) => splitInlineSteps(p))) {
      const t = para.trim();
      if (!t) continue;

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
      } else if (SUB_RE.test(t)) {
        pushChildOrTop({ kind: 'bulleted', text: t.replace(SUB_RE, '').trim() });
      } else {
        pushChildOrTop({ kind: 'paragraph', text: t });
      }
    }
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
