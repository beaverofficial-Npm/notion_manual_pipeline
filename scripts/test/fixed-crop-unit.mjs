import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { FIXED_CAPTURE_BOX, boxCropRect, cropGroups, shouldUseFixedCapture } from '../worker/group-bake.mjs';

assert.equal(shouldUseFixedCapture('group_bake', 'content'), true);
assert.equal(shouldUseFixedCapture('group_bake', 'section'), false);
assert.equal(shouldUseFixedCapture('capture', 'content'), false);

const width = 1000;
const height = 600;
const channels = 3;
const sourcePixels = Buffer.alloc(width * height * channels);
for (let y = 0; y < height; y += 1) {
  for (let x = 0; x < width; x += 1) {
    const offset = (y * width + x) * channels;
    sourcePixels[offset] = x % 256;
    sourcePixels[offset + 1] = y % 256;
    sourcePixels[offset + 2] = (x + y) % 256;
  }
}

const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'manual-fixed-crop-unit-'));
const sourcePath = path.join(tempDirectory, 'source.png');
try {
  await sharp(sourcePixels, { raw: { width, height, channels } }).png().toFile(sourcePath);
  const previousSharpen = process.env.RENDER_SHARPEN;
  process.env.RENDER_SHARPEN = '0';
  const [outputPath] = await cropGroups(sourcePath, [boxCropRect(FIXED_CAPTURE_BOX)], tempDirectory, 1);
  if (previousSharpen === undefined) delete process.env.RENDER_SHARPEN;
  else process.env.RENDER_SHARPEN = previousSharpen;

  assert(outputPath, '고정 크롭 결과 파일이 생성되어야 합니다.');
  const expectedLeft = Math.round(FIXED_CAPTURE_BOX.xFrac * width);
  const expectedTop = Math.round(FIXED_CAPTURE_BOX.yFrac * height);
  const expectedWidth = Math.round(FIXED_CAPTURE_BOX.wFrac * width);
  const expectedHeight = Math.round(FIXED_CAPTURE_BOX.hFrac * height);
  const { data, info } = await sharp(outputPath).raw().toBuffer({ resolveWithObject: true });
  assert.equal(info.width, expectedWidth);
  assert.equal(info.height, expectedHeight);

  const sourceOffset = (expectedTop * width + expectedLeft) * channels;
  assert.deepEqual([...data.subarray(0, channels)], [...sourcePixels.subarray(sourceOffset, sourceOffset + channels)]);

  const outputLastOffset = ((expectedHeight - 1) * expectedWidth + expectedWidth - 1) * channels;
  const sourceLastX = expectedLeft + expectedWidth - 1;
  const sourceLastY = expectedTop + expectedHeight - 1;
  const sourceLastOffset = (sourceLastY * width + sourceLastX) * channels;
  assert.deepEqual(
    [...data.subarray(outputLastOffset, outputLastOffset + channels)],
    [...sourcePixels.subarray(sourceLastOffset, sourceLastOffset + channels)],
  );
  console.log(`fixed crop unit passed: ${expectedLeft},${expectedTop} ${expectedWidth}x${expectedHeight}`);
} finally {
  await rm(tempDirectory, { recursive: true, force: true });
}
