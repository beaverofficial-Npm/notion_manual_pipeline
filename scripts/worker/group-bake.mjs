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
 *    → 각 bbox를 px로 환산해 ImageMagick으로 크롭 → PNG 경로 배열.
 *
 * DB/Supabase 의존 없이 순수 XML 파싱 + 렌더 크롭만 수행.
 * 중첩 그룹(그룹 안 그룹)은 일단 최상위만 처리 // TODO: nested groups
 */

import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

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

  // 슬라이드 PNG 크기 확인 (ImageMagick identify)
  let imageInfo;
  try {
    const { stdout } = await execFileAsync('magick', ['identify', '-format', '%wx%h', slidePngPath]);
    const match = stdout.trim().match(/(\d+)x(\d+)/);
    if (!match) {
      throw new Error(`Could not parse image size: ${stdout}`);
    }
    imageInfo = { w: Number(match[1]), h: Number(match[2]) };
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
      // ImageMagick crop: WIDTHxHEIGHT+X+Y
      const cropGeom = `${wClamped}x${hClamped}+${xClamped}+${yClamped}`;
      await execFileAsync('magick', ['convert', slidePngPath, '-crop', cropGeom, '+repage', outPath]);
      results.push(outPath);
    } catch (error) {
      console.error(`[group-bake] crop failed for group ${i}: ${error.message}`);
      // 계속 진행 (일부 그룹 실패해도 다른 그룹은 처리)
    }
  }

  return results;
}
