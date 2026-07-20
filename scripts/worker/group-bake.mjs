/**
 * group-bake.mjs — 그룹 베이크 코어 모듈
 *
 * PPT의 그룹(`<p:grpSp>`)을 한 장 이미지로 굽는 재사용 가능 모듈.
 * 스펙: docs/planning/CONVERTER_TWO_WAY_MODE_SPEC.md §3
 *
 * 1. parseGroupBoxes(slideXml, slideSizeEmu)
 *    → 슬라이드의 모든 최상위 그룹의 bbox를 슬라이드 비율 `[{xFrac, yFrac, wFrac, hFrac}]`로 반환.
 *
 * 2. cropGroups(slidePngPath, boxes, outDir, slideNumber)
 *    → 각 bbox를 px로 환산해 sharp로 크롭 → PNG 경로 배열.
 *
 * DB/Supabase 의존 없이 순수 XML 파싱 + 렌더 크롭만 수행.
 * 중첩 그룹(그룹 안 그룹)은 일단 최상위만 처리 // TODO: nested groups
 */

import sharp from 'sharp';
import path from 'node:path';

// 작은 컨테이너(Railway)에서 OOM 방지: sharp 메모리 캐시/동시성 제한 (capture 발행 경로와 동일).
sharp.cache(false);
sharp.concurrency(1);

/**
 * XML 속성 추출 (정규식 기반, 단순 케이스용)
 */
function attr(source, name) {
  const match = source.match(new RegExp(`${name}="([^"]*)"`));
  return match?.[1] ?? '';
}

/**
 * 첫 번째 숫자 매칭
 */
function firstNumber(source, pattern) {
  const match = source.match(pattern);
  return match ? Number(match[1]) : 0;
}

/**
 * 모든 `<p:grpSp>...</p:grpSp>` 블록 추출 (spTree 직하위만)
 *
 * spTree의 grpSpPr(레이아웃용, 0값)을 제외하고,
 * spTree 직하위의 실제 데이터 그룹들만 추출.
 *
 * 중첩 그룹은 현재 무시 (각 grpSp 내부의 자식 grpSp는 불필요).
 */
function extractTopLevelGroups(slideXml) {
  const groups = [];

  // spTree 구간 추출
  const spTreeMatch = slideXml.match(/<p:spTree[^>]*>([\s\S]*?)<\/p:spTree>/);
  if (!spTreeMatch) {
    console.warn('[group-bake] spTree not found');
    return groups;
  }
  const spTreeContent = spTreeMatch[1];

  // spTree 직하위(최상위) grpSp 만 추출 — 중첩 깊이를 추적해 top-level 만 잡는다.
  // (비탐욕 정규식은 중첩 그룹을 잘못 쪼갠다: 배지 같은 내부 그룹이 별도 top-level 로 떨어져 나오고
  //  최상위 그룹 bbox 도 망가진다. 깊이 카운팅으로 정확히 최상위 경계만 잡는다.)
  const tokenRe = /<p:grpSp\b[^>]*>|<\/p:grpSp>/g;
  let depth = 0;
  let startIdx = -1;
  let token;
  while ((token = tokenRe.exec(spTreeContent))) {
    const isClose = token[0].startsWith('</');
    if (!isClose) {
      if (depth === 0) startIdx = token.index;
      depth += 1;
    } else {
      depth -= 1;
      if (depth === 0 && startIdx >= 0) {
        groups.push(spTreeContent.slice(startIdx, token.index + token[0].length));
        startIdx = -1;
      }
    }
  }

  return groups;
}

/**
 * grpSp 블록에서 xfrm 정보 추출
 * `<p:grpSpPr><a:xfrm><a:off x="..." y="..."/><a:ext cx="..." cy="..."/></a:xfrm></p:grpSpPr>`
 *
 * @returns {{ x: number, y: number, cx: number, cy: number }} EMU 단위
 */
function extractGroupTransform(grpSpBlock) {
  // grpSpPr 찾기 (더 관대한 정규식)
  const grpSpPrMatch = grpSpBlock.match(/<p:grpSpPr\b[\s\S]*?<\/p:grpSpPr>/);
  if (!grpSpPrMatch) {
    console.warn('[group-bake] grpSpPr not found in group block');
    return null;
  }
  const grpSpPr = grpSpPrMatch[0];

  // a:xfrm 내부의 a:off, a:ext 추출
  // a:off와 a:ext는 별도 태그일 수 있음
  const x = firstNumber(grpSpPr, /a:off[^>]*x="(-?\d+)"/);
  const y = firstNumber(grpSpPr, /a:off[^>]*y="(-?\d+)"/);
  const cx = firstNumber(grpSpPr, /a:ext[^>]*cx="(\d+)"/);
  const cy = firstNumber(grpSpPr, /a:ext[^>]*cy="(\d+)"/);

  if (cx === 0 || cy === 0) {
    console.warn('[group-bake] transform values are zero or not found', { x, y, cx, cy });
    return null;
  }

  return { x, y, cx, cy };
}

/**
 * 그룹의 bbox를 슬라이드 대비 비율로 변환
 *
 * @param {object} xfrm — { x, y, cx, cy } (EMU)
 * @param {object} slideSize — { cx, cy } (EMU)
 * @returns {object} { xFrac, yFrac, wFrac, hFrac } (0~1.0, 퍼센트 아님)
 */
function fractionBox(xfrm, slideSize) {
  if (!slideSize.cx || !slideSize.cy) {
    console.warn('[group-bake] slideSize invalid');
    return null;
  }

  return {
    xFrac: Number((xfrm.x / slideSize.cx).toFixed(6)),
    yFrac: Number((xfrm.y / slideSize.cy).toFixed(6)),
    wFrac: Number((xfrm.cx / slideSize.cx).toFixed(6)),
    hFrac: Number((xfrm.cy / slideSize.cy).toFixed(6)),
  };
}

/**
 * parseImageBoxes(slideXml, layoutXml, slideSizeEmu)
 *
 * 슬라이드(또는 그 레이아웃)의 "이미지 박스"(텍스트 없는 큰 사각형 컨테이너) bbox를 찾는다.
 * 가이드 덱은 좌측에 이미지 박스를 두고 그 안에 화면 이미지를 배치한다 —
 * 구덱은 박스가 슬라이드 안에, 레이아웃 v2 덱은 slideLayout 에 있다(슬라이드 우선, 없으면 레이아웃).
 * 이 박스를 그대로 크롭하면 그룹 파싱보다 안정적으로 "저자가 의도한 이미지 영역"이 나온다.
 *
 * @returns {array} [{ xFrac, yFrac, wFrac, hFrac }, ...] (슬라이드 비율 0~1)
 */
export function parseImageBoxes(slideXml, layoutXml, slideSizeEmu) {
  if (!slideSizeEmu?.cx || !slideSizeEmu?.cy) return [];
  for (const source of [slideXml, layoutXml]) {
    if (!source) continue;
    const boxes = [];
    for (const m of source.matchAll(/<p:sp>([\s\S]*?)<\/p:sp>/g)) {
      const sp = m[1];
      const geom = sp.match(/<a:prstGeom prst="([^"]+)"/)?.[1] ?? '';
      if (!/rect/i.test(geom)) continue;
      const text = [...sp.matchAll(/<a:t>(.*?)<\/a:t>/g)].map((x) => x[1]).join('').trim();
      if (text) continue; // 텍스트 있는 사각형은 컨테이너가 아니다
      const x = firstNumber(sp, /<a:off[^>]*x="(-?\d+)"/);
      const y = firstNumber(sp, /<a:off[^>]*y="(-?\d+)"/);
      const cx = firstNumber(sp, /<a:ext[^>]*cx="(\d+)"/);
      const cy = firstNumber(sp, /<a:ext[^>]*cy="(\d+)"/);
      if (!cx || !cy) continue;
      const wFrac = cx / slideSizeEmu.cx;
      const hFrac = cy / slideSizeEmu.cy;
      if (wFrac < 0.3 || hFrac < 0.3) continue; // 이미지 컨테이너 크기 미만은 장식/뱃지 — 스킵
      // 이미지박스는 항상 "왼쪽 판"이다 — 중심이 슬라이드 오른쪽 절반이면 텍스트 패널 배경이므로 제외.
      const centerX = (x + cx / 2) / slideSizeEmu.cx;
      if (centerX > 0.5) continue;
      boxes.push({
        xFrac: Number((x / slideSizeEmu.cx).toFixed(6)),
        yFrac: Number((y / slideSizeEmu.cy).toFixed(6)),
        wFrac: Number(wFrac.toFixed(6)),
        hFrac: Number(hFrac.toFixed(6)),
      });
    }
    if (boxes.length) {
      // 후보가 여럿이어도 판은 하나 — 가장 큰 것 하나만 쓴다(호출부는 [0] 사용).
      boxes.sort((a, b) => b.wFrac * b.hFrac - a.wFrac * a.hFrac);
      return boxes;
    }
  }
  return [];
}

/**
 * bodyTextLeftBoundary(parsed, box)
 *
 * 판 오른쪽 본문 텍스트 컬럼의 시작(left, %). 없으면 null.
 * 크롭 우측 이중 안전컷의 기준으로만 쓴다.
 */
export function bodyTextLeftBoundary(parsed, box) {
  const boxR = (box.xFrac + box.wFrac) * 100;
  const lefts = (parsed?.shapes ?? [])
    .filter((s) => !s.isGroupLabel && (s.text ?? '').length > 20 && s.bbox.left > boxR)
    .map((s) => s.bbox.left);
  return lefts.length ? Math.min(...lefts) : null;
}

/**
 * boxCropRect(box, parsed)
 *
 * 확정 규칙(성빈님, 재논의 금지): **크롭 = 왼쪽 이미지박스(연회색 판) 그 영역만.**
 * 주변 요소를 살리려는 합집합·연쇄·픽셀확장은 전부 폐기 — 그 예외들이 사고의 근원이었다.
 * 판보다 삐져나온 요소는 판 끝에서 잘린다(작성 규약의 영역 — 코드가 판단하지 않는다).
 *
 * rect = 판 ± PAD(0.8%). 우측은 본문 텍스트 직전(-0.3%)을 절대 못 넘는 이중 안전컷.
 *
 * @param {object} box — { xFrac, yFrac, wFrac, hFrac } (이미지박스)
 * @param {object} parsed — parseSlideShapes 결과 (우측 텍스트 경계 산출용)
 * @returns {object} { xFrac, yFrac, wFrac, hFrac }
 */
export function boxCropRect(box, parsed) {
  const PAD = 0.8; // %
  const x0 = Math.max(0, box.xFrac * 100 - PAD);
  const y0 = Math.max(0, box.yFrac * 100 - PAD);
  let x1 = Math.min(100, (box.xFrac + box.wFrac) * 100 + PAD);
  const y1 = Math.min(100, (box.yFrac + box.hFrac) * 100 + PAD);
  const textL = bodyTextLeftBoundary(parsed, box);
  if (textL !== null) x1 = Math.min(x1, textL - 0.3); // 본문 텍스트는 어떤 경우에도 침범 불가
  return {
    xFrac: Number((x0 / 100).toFixed(6)),
    yFrac: Number((y0 / 100).toFixed(6)),
    wFrac: Number(((x1 - x0) / 100).toFixed(6)),
    hFrac: Number(((y1 - y0) / 100).toFixed(6)),
  };
}

/**
 * stripOutsideTextShapes(slideXml, box, slideSizeEmu)
 *
 * 크롭용 렌더에서 본문 텍스트를 "픽셀부터" 없애기 위해, 슬라이드 XML에서
 * 이미지박스 밖의 **최상위** 텍스트 shape(<p:sp>)를 제거한 XML을 반환한다.
 * (마스킹·클램프로는 저자가 본문 컬럼까지 걸쳐 그린 말풍선과 본문 글자를
 *  같은 사각형 안에서 분리할 수 없음 — 텍스트를 렌더 전에 지우는 것이 유일한 무손실 해법.
 *  본문 텍스트는 어차피 파서가 추출해 노션 텍스트 블록으로 들어간다.)
 *
 * 그룹(<p:grpSp>) 내부 shape 는 좌표가 그룹-로컬이라 판정 불가 + 시각 덩어리의
 * 일부(말풍선·뱃지)이므로 절대 건드리지 않는다 — 깊이 추적으로 최상위만 제거.
 *
 * @param {string} slideXml — slide*.xml 원문
 * @param {object} box — 이미지박스 { xFrac, yFrac, wFrac, hFrac }
 * @param {object} slideSizeEmu — { cx, cy } (EMU)
 * @returns {string|null} 제거된 XML (제거할 것이 없으면 null)
 */
export function stripOutsideTextShapes(slideXml, box, slideSizeEmu) {
  if (!slideXml || !box || !slideSizeEmu?.cx || !slideSizeEmu?.cy) return null;
  const treeMatch = slideXml.match(/<p:spTree[^>]*>[\s\S]*?<\/p:spTree>/);
  if (!treeMatch) return null;
  const tree = treeMatch[0];

  const bx0 = box.xFrac * 100, by0 = box.yFrac * 100;
  const bx1 = bx0 + box.wFrac * 100, by1 = by0 + box.hFrac * 100;

  // 최상위 <p:sp> 만 수집(그룹 내부 제외) — grpSp 깊이 추적.
  const tokenRe = /<p:grpSp\b[^>]*>|<\/p:grpSp>|<p:sp>[\s\S]*?<\/p:sp>/g;
  let depth = 0;
  const removals = [];
  let token;
  while ((token = tokenRe.exec(tree))) {
    const t = token[0];
    if (t.startsWith('<p:grpSp')) { depth += 1; continue; }
    if (t.startsWith('</p:grpSp')) { depth -= 1; continue; }
    if (depth !== 0) continue; // 그룹 내부 sp — 보호
    // 텍스트 없는 도형(콜아웃 박스·화살표)은 시각요소 — 보호
    const text = [...t.matchAll(/<a:t>(.*?)<\/a:t>/g)].map((m) => m[1]).join('').trim();
    if (!text) continue;
    const x = firstNumber(t, /<a:off[^>]*x="(-?\d+)"/);
    const y = firstNumber(t, /<a:off[^>]*y="(-?\d+)"/);
    const cx = firstNumber(t, /<a:ext[^>]*cx="(\d+)"/);
    const cy = firstNumber(t, /<a:ext[^>]*cy="(\d+)"/);
    const centerX = ((x + cx / 2) / slideSizeEmu.cx) * 100;
    const centerY = ((y + cy / 2) / slideSizeEmu.cy) * 100;
    const centerInside = centerX >= bx0 && centerX <= bx1 && centerY >= by0 && centerY <= by1;
    if (centerInside) continue; // 박스 안 라벨(헤더칩 등)은 이미지의 일부 — 보호
    removals.push(t);
  }
  if (!removals.length) return null;

  let newTree = tree;
  for (const block of removals) newTree = newTree.replace(block, '');
  return slideXml.replace(tree, newTree);
}

/**
 * parseGroupBoxes(slideXml, slideSizeEmu)
 *
 * 슬라이드 XML에서 최상위 그룹들의 bbox를 슬라이드 비율로 산출.
 *
 * @param {string} slideXml — slide*.xml 내용
 * @param {object} slideSizeEmu — { cx, cy } EMU 단위
 * @returns {array} [{ xFrac, yFrac, wFrac, hFrac }, ...] 또는 빈 배열
 */
export function parseGroupBoxes(slideXml, slideSizeEmu) {
  if (!slideXml || !slideSizeEmu) {
    console.warn('[group-bake] invalid input to parseGroupBoxes');
    return [];
  }

  const groups = extractTopLevelGroups(slideXml);
  if (groups.length === 0) {
    console.log('[group-bake] no groups found in slide');
    return [];
  }

  const boxes = [];
  for (const grpBlock of groups) {
    // 그림(<p:pic>)이 없는 최상위 그룹은 순수 주석 묶음(배지 클러스터 등) → 스킵
    const picCount = (grpBlock.match(/<p:pic\b/g) || []).length;
    if (picCount === 0) continue;

    const xfrm = extractGroupTransform(grpBlock);
    if (!xfrm) continue;

    const box = fractionBox(xfrm, slideSizeEmu);
    if (box) boxes.push(box);
  }

  return boxes;
}

/**
 * cropGroups(slidePngPath, boxes, outDir, slideNumber)
 *
 * 렌더된 슬라이드 PNG에서 각 그룹 bbox를 크롭해 개별 PNG로 저장.
 *
 * @param {string} slidePngPath — 렌더된 슬라이드 PNG 경로
 * @param {array} boxes — [{ xFrac, yFrac, wFrac, hFrac }, ...]
 * @param {string} outDir — 크롭 결과 저장 디렉터리
 * @param {number} slideNumber — 슬라이드 번호 (파일명용)
 * @returns {array} 생성된 PNG 경로 배열 또는 빈 배열
 */
export async function cropGroups(slidePngPath, boxes, outDir, slideNumber) {
  if (!boxes || boxes.length === 0) {
    console.log(`[group-bake] no boxes to crop for slide ${slideNumber}`);
    return [];
  }

  // 슬라이드 PNG 크기 확인 (sharp metadata — 시스템 바이너리 불필요)
  let imageInfo;
  try {
    const meta = await sharp(slidePngPath).metadata();
    if (!meta.width || !meta.height) {
      throw new Error(`Could not read image size: ${slidePngPath}`);
    }
    imageInfo = { w: meta.width, h: meta.height };
  } catch (error) {
    throw new Error(`[group-bake] identify failed: ${error.message}`);
  }

  const results = [];
  for (let i = 0; i < boxes.length; i += 1) {
    const box = boxes[i];

    // 비율 → 픽셀 변환
    const x = Math.round(box.xFrac * imageInfo.w);
    const y = Math.round(box.yFrac * imageInfo.h);
    const w = Math.round(box.wFrac * imageInfo.w);
    const h = Math.round(box.hFrac * imageInfo.h);

    // 픽셀 범위 clamp
    const xClamped = Math.max(0, x);
    const yClamped = Math.max(0, y);
    const wClamped = Math.max(1, Math.min(w, imageInfo.w - xClamped));
    const hClamped = Math.max(1, Math.min(h, imageInfo.h - yClamped));

    const outPath = path.join(outDir, `slide-${String(slideNumber).padStart(3, '0')}-group-${String(i).padStart(2, '0')}.png`);

    try {
      // 크롭 후 언샤프 마스크로 경계를 또렷하게 — 저해상도 스크린샷의 체감 선명도를 올린다.
      // 무손실 렌더 위에 얹으므로 아티팩트를 강조하지 않는다. RENDER_SHARPEN=0 이면 끈다.
      let pipeline = sharp(slidePngPath).extract({ left: xClamped, top: yClamped, width: wClamped, height: hClamped });
      if (process.env.RENDER_SHARPEN !== '0') pipeline = pipeline.sharpen({ sigma: 1.7, m1: 0, m2: 3 });
      await pipeline.png().toFile(outPath);
      results.push(outPath);
    } catch (error) {
      console.error(`[group-bake] crop failed for group ${i}: ${error.message}`);
      // 계속 진행 (일부 그룹 실패해도 다른 그룹은 처리)
    }
  }

  return results;
}
