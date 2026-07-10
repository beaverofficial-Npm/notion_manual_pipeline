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
      boxes.push({
        xFrac: Number((x / slideSizeEmu.cx).toFixed(6)),
        yFrac: Number((y / slideSizeEmu.cy).toFixed(6)),
        wFrac: Number(wFrac.toFixed(6)),
        hFrac: Number(hFrac.toFixed(6)),
      });
    }
    if (boxes.length) return boxes; // 슬라이드에서 찾으면 레이아웃은 안 본다
  }
  return [];
}

/**
 * expandBoxWithPics(box, picsPercent)
 *
 * 저자가 이미지 박스 살짝 밖까지 이미지를 얹는 경우(우측 갤러리·하단 내비 등)가 있어,
 * 박스와 "겹치는" 이미지들의 bbox 를 합집합으로 확장하고 소폭 패딩한다.
 * (겹치지 않는 먼 이미지는 확장하지 않음 — 우측 텍스트 영역까지 끌려가는 것 방지)
 *
 * @param {object} box — { xFrac, yFrac, wFrac, hFrac }
 * @param {array} picsPercent — parseSlideShapes 의 pics ({ bbox: {left,top,width,height} % , areaRatio })
 */
/**
 * contentCropBox(box, parsed)
 *
 * 이미지 박스를 "스코프"로만 쓰고, 크롭은 콘텐츠에 딱 맞춘다:
 *  - 포함: 중심이 박스 안에 있는 이미지들 + 박스 안 어노테이션/짧은 라벨(뱃지·헤더칩)
 *  - 제외: 본문 텍스트 컬럼(중심이 박스 밖의 긴 텍스트) — 크롭이 닿지 않게 직전에서 클램프
 * 이렇게 해야 (a) 박스보다 작은 콘텐츠일 때 상하 빈 띠가 없고
 * (b) 박스 밖으로 삐져나온 이미지 때문에 본문 텍스트 조각이 딸려 들어오지 않는다.
 *
 * @param {object} box — { xFrac, yFrac, wFrac, hFrac } (이미지 박스)
 * @param {object} parsed — parseSlideShapes 결과 ({ shapes, pics })
 * @returns {object} { xFrac, yFrac, wFrac, hFrac }
 */
export function contentCropBox(box, parsed) {
  const bx0 = box.xFrac * 100, by0 = box.yFrac * 100;
  const bx1 = bx0 + box.wFrac * 100, by1 = by0 + box.hFrac * 100;
  const centerIn = (bb) => {
    const cx = bb.left + bb.width / 2, cy = bb.top + bb.height / 2;
    return cx >= bx0 && cx <= bx1 && cy >= by0 && cy <= by1;
  };

  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const grow = (bb) => {
    x0 = Math.min(x0, bb.left); y0 = Math.min(y0, bb.top);
    x1 = Math.max(x1, bb.left + bb.width); y1 = Math.max(y1, bb.top + bb.height);
  };
  for (const p of parsed.pics ?? []) {
    if ((p.areaRatio ?? 0) < 0.005) continue;
    if (centerIn(p.bbox)) grow(p.bbox);
  }
  if (!Number.isFinite(x0)) {
    // 박스 안 이미지가 없으면 박스 그대로
    return box;
  }
  // 박스 안 어노테이션/짧은 라벨(숫자 뱃지·헤더칩 등)도 포함해 잘리지 않게 한다.
  for (const s of parsed.shapes ?? []) {
    if (s.isGroupLabel) continue;
    if (s.text.length > 20) continue; // 본문/설명문은 제외
    if (!centerIn(s.bbox)) continue;
    grow(s.bbox);
  }

  const PAD = 0.8; // %
  x0 = Math.max(0, x0 - PAD); y0 = Math.max(0, y0 - PAD);
  x1 = Math.min(100, x1 + PAD); y1 = Math.min(100, y1 + PAD);

  // 본문 텍스트 컬럼(중심이 박스 밖의 긴 텍스트)에 크롭이 닿지 않게 우측 클램프
  for (const s of parsed.shapes ?? []) {
    if (s.isGroupLabel || s.text.length <= 20) continue;
    const cx = s.bbox.left + s.bbox.width / 2, cy = s.bbox.top + s.bbox.height / 2;
    const outside = !(cx >= bx0 && cx <= bx1 && cy >= by0 && cy <= by1);
    if (outside && s.bbox.left > (bx0 + bx1) / 2 && s.bbox.left < x1) {
      // 본문 shape 의 left 경계까지는 안전(글리프는 shape 안쪽에서 시작) — 저자가 텍스트 직전까지
      // 붙여 그린 어노테이션(점선 말풍선 등)이 잘리지 않게 여유 없이 딱 맞춘다.
      x1 = Math.max(x0 + 1, s.bbox.left);
    }
  }

  return {
    xFrac: Number((x0 / 100).toFixed(6)),
    yFrac: Number((y0 / 100).toFixed(6)),
    wFrac: Number(((x1 - x0) / 100).toFixed(6)),
    hFrac: Number(((y1 - y0) / 100).toFixed(6)),
  };
}

export function expandBoxWithPics(box, picsPercent) {
  let x0 = box.xFrac, y0 = box.yFrac, x1 = box.xFrac + box.wFrac, y1 = box.yFrac + box.hFrac;
  for (const p of picsPercent ?? []) {
    if ((p.areaRatio ?? 0) < 0.005) continue; // 장식 아이콘 제외
    const px0 = p.bbox.left / 100, py0 = p.bbox.top / 100;
    const px1 = px0 + p.bbox.width / 100, py1 = py0 + p.bbox.height / 100;
    const intersects = px0 < x1 && px1 > x0 && py0 < y1 && py1 > y0;
    if (!intersects) continue;
    x0 = Math.min(x0, px0); y0 = Math.min(y0, py0);
    x1 = Math.max(x1, px1); y1 = Math.max(y1, py1);
  }
  const PAD = 0.008; // 0.8% 여백
  x0 = Math.max(0, x0 - PAD); y0 = Math.max(0, y0 - PAD);
  x1 = Math.min(1, x1 + PAD); y1 = Math.min(1, y1 + PAD);
  return {
    xFrac: Number(x0.toFixed(6)),
    yFrac: Number(y0.toFixed(6)),
    wFrac: Number((x1 - x0).toFixed(6)),
    hFrac: Number((y1 - y0).toFixed(6)),
  };
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
      // sharp crop: extract({ left, top, width, height })
      await sharp(slidePngPath)
        .extract({ left: xClamped, top: yClamped, width: wClamped, height: hClamped })
        .png()
        .toFile(outPath);
      results.push(outPath);
    } catch (error) {
      console.error(`[group-bake] crop failed for group ${i}: ${error.message}`);
      // 계속 진행 (일부 그룹 실패해도 다른 그룹은 처리)
    }
  }

  return results;
}
