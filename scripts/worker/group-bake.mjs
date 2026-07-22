/**
 * 고정 캡처 코어.
 *
 * 마스터 덱의 모든 content slide는 동일한 왼쪽 이미지 박스를 사용한다.
 * 이 모듈은 자동 탐지·그룹 추론·본문 shape 제거를 하지 않고 다음 계약만 제공한다.
 *   1. 실측 고정 좌표
 *   2. padding 없는 좌표 정규화
 *   3. 렌더 PNG의 해당 영역 크롭
 */
import path from 'node:path';
import sharp from 'sharp';

// 작은 Railway 컨테이너에서 여러 장을 처리할 때 메모리 급증을 막는다.
sharp.cache(false);
sharp.concurrency(1);

export const FIXED_CAPTURE_BOX = Object.freeze({
  xFrac: 0.036458,
  yFrac: 0.171296,
  wFrac: 0.606771,
  hFrac: 0.694444,
});

/** 좌표를 이미지 범위 안으로만 제한한다. padding·확장·본문 경계 보정은 없다. */
export function boxCropRect(box) {
  const xFrac = Math.max(0, Math.min(1, box.xFrac));
  const yFrac = Math.max(0, Math.min(1, box.yFrac));
  return {
    xFrac: Number(xFrac.toFixed(6)),
    yFrac: Number(yFrac.toFixed(6)),
    wFrac: Number(Math.max(0, Math.min(1 - xFrac, box.wFrac)).toFixed(6)),
    hFrac: Number(Math.max(0, Math.min(1 - yFrac, box.hFrac)).toFixed(6)),
  };
}

/** 렌더된 슬라이드 PNG에서 지정 영역을 잘라 PNG 파일로 저장한다. */
export async function cropGroups(slidePngPath, boxes, outDir, slideNumber) {
  if (!boxes?.length) return [];

  const metadata = await sharp(slidePngPath).metadata();
  if (!metadata.width || !metadata.height) {
    throw new Error(`[fixed-crop] 이미지 크기를 읽지 못했습니다: ${slidePngPath}`);
  }

  const results = [];
  for (let index = 0; index < boxes.length; index += 1) {
    const box = boxCropRect(boxes[index]);
    const left = Math.max(0, Math.round(box.xFrac * metadata.width));
    const top = Math.max(0, Math.round(box.yFrac * metadata.height));
    const width = Math.max(1, Math.min(Math.round(box.wFrac * metadata.width), metadata.width - left));
    const height = Math.max(1, Math.min(Math.round(box.hFrac * metadata.height), metadata.height - top));
    const outputPath = path.join(
      outDir,
      `slide-${String(slideNumber).padStart(3, '0')}-group-${String(index).padStart(2, '0')}.png`,
    );

    try {
      let pipeline = sharp(slidePngPath).extract({ left, top, width, height });
      if (process.env.RENDER_SHARPEN !== '0') pipeline = pipeline.sharpen({ sigma: 1.7, m1: 0, m2: 3 });
      await pipeline.png().toFile(outputPath);
      results.push(outputPath);
    } catch (error) {
      console.error(`[fixed-crop] slide ${slideNumber} crop ${index} failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return results;
}
