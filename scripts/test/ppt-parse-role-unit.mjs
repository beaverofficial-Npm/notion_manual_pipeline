import assert from 'node:assert/strict';
import { classifyRole } from '../worker/ppt-parse.mjs';

function shape(text, { fromGroup = false, height = 4.5 } = {}) {
  return {
    text,
    paragraphs: [text],
    fromGroup,
    isGroupLabel: false,
    bbox: { left: 10, top: 35, width: 3, height },
  };
}

const annotationNumbers = {
  shapes: [
    shape('매출관리'),
    shape('1', { fromGroup: true }),
    shape('2', { fromGroup: true }),
  ],
};
assert.equal(
  classifyRole(annotationNumbers, 7),
  'content',
  '이미지 그룹 내부 번호 어노테이션은 content 슬라이드를 section으로 바꾸면 안 됩니다.',
);

const actualSectionNumber = {
  shapes: [shape('01.', { height: 10.7 }), shape('매출관리')],
};
assert.equal(classifyRole(actualSectionNumber, 7), 'section');

const groupedSectionNumber = {
  shapes: [shape('01.', { fromGroup: true, height: 10.7 }), shape('매출관리')],
};
assert.equal(
  classifyRole(groupedSectionNumber, 7),
  'section',
  '실제 챕터 표지의 큰 그룹 숫자는 section 판정을 유지해야 합니다.',
);

console.log('PPT role classifier unit passed: grouped annotation numbers stay content.');
