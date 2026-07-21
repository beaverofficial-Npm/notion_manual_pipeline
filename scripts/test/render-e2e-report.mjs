import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import sharp from 'sharp';
import { downloadSource } from '../worker/source-storage.mjs';

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function formatBytes(value) {
  const bytes = Number(value ?? 0);
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function pickRepresentativeSlides(baseline, modified) {
  const baselineAssets = new Map((baseline.assets ?? []).map((asset) => [Number(asset.slideNumber), asset]));
  const modifiedAssets = new Map((modified.assets ?? []).map((asset) => [Number(asset.slideNumber), asset]));
  const eligible = [...baselineAssets.keys()]
    .filter((slideNumber) => {
      const before = baselineAssets.get(slideNumber);
      const after = modifiedAssets.get(slideNumber);
      return after && before.sha256 !== after.sha256;
    })
    .sort((a, b) => a - b);
  if (!eligible.length) return [];
  return [...new Set([eligible[0], eligible[Math.floor(eligible.length / 2)], eligible.at(-1)])];
}

async function comparisonImage(beforeBytes, afterBytes, slideNumber, outputPath) {
  const panelWidth = 800;
  const headerHeight = 56;
  async function panel(bytes, label) {
    const resized = await sharp(bytes).resize({ width: panelWidth, fit: 'inside' }).png().toBuffer();
    const metadata = await sharp(resized).metadata();
    const header = Buffer.from(
      `<svg width="${panelWidth}" height="${headerHeight}"><rect width="100%" height="100%" fill="#111827"/><text x="20" y="37" fill="#fff" font-family="Arial, sans-serif" font-size="24" font-weight="700">${label} · slide ${slideNumber}</text></svg>`,
    );
    return sharp({ create: { width: panelWidth, height: metadata.height + headerHeight, channels: 3, background: '#fff' } })
      .composite([
        { input: header, top: 0, left: 0 },
        { input: resized, top: headerHeight, left: 0 },
      ])
      .png()
      .toBuffer();
  }
  const [before, after] = await Promise.all([panel(beforeBytes, 'BEFORE'), panel(afterBytes, 'AFTER')]);
  const [beforeInfo, afterInfo] = await Promise.all([sharp(before).metadata(), sharp(after).metadata()]);
  const height = Math.max(beforeInfo.height, afterInfo.height);
  await sharp({ create: { width: panelWidth * 2 + 20, height, channels: 3, background: '#dbe3ef' } })
    .composite([{ input: before, left: 0, top: 0 }, { input: after, left: panelWidth + 20, top: 0 }])
    .webp({ quality: 88 })
    .toFile(outputPath);
}

const reportPath = path.resolve(option('--report') ?? '');
const outputDirectory = path.resolve(option('--output') ?? '');
const environmentName = option('--environment') ?? 'local';
const title = option('--title') ?? `PPT 변환 파이프라인 ${environmentName} 검수 결과`;
if (!option('--report') || !option('--output')) {
  throw new Error('사용법: node --env-file=<env> scripts/test/render-e2e-report.mjs --report <report.json> --output <directory> [--environment local|production]');
}

const report = JSON.parse(await readFile(reportPath, 'utf8'));
await mkdir(path.join(outputDirectory, 'assets'), { recursive: true });
const visibleChangeCoverage = (report.checks ?? [])
  .filter((item) => item.code === 'MODIFIED_VISIBLE_ASSET_COVERAGE_LOW')
  .map((item) => ({
    caseId: String(item.message ?? '').split(':')[0],
    pass: item.pass,
    expectedAssetSlides: item.details?.expectedAssetSlides,
    requiredVisibleChanges: item.details?.requiredVisibleChanges,
    actualVisibleChanges: item.details?.actualVisibleChanges,
  }));
const durableSummary = {
  schemaVersion: report.schemaVersion,
  startedAt: report.startedAt,
  finishedAt: report.finishedAt,
  baseUrl: report.baseUrl,
  expectedRenderProvider: report.expectedRenderProvider,
  expectedCaptureBox: report.expectedCaptureBox,
  summary: report.summary,
  cases: (report.cases ?? []).map((item) => ({
    caseId: item.caseId,
    logicalDeck: item.logicalDeck,
    variant: item.variant,
    taskId: item.taskId,
    jobId: item.jobId,
    runNumber: item.runNumber,
    source: item.source,
    runPrefix: item.runPrefix,
    manifestPath: item.manifestPath,
    renderProvider: item.renderProvider,
    captureBox: item.captureBox,
    cropPadding: item.cropPadding,
    cropGate: item.cropGate,
    changedSlides: item.changedSlides,
  })),
  checks: {
    passed: (report.checks ?? []).filter((item) => item.pass).length,
    failed: (report.checks ?? []).filter((item) => !item.pass),
  },
  visibleChangeCoverage,
  failures: report.failures ?? [],
};
await writeFile(path.join(outputDirectory, 'report-summary.json'), `${JSON.stringify(durableSummary, null, 2)}\n`, 'utf8');

const visualEvidence = [];
for (const logicalDeck of [...new Set((report.cases ?? []).map((item) => item.logicalDeck))].sort()) {
  const baseline = report.cases.find((item) => item.logicalDeck === logicalDeck && item.variant === 'baseline');
  const modified = report.cases.find((item) => item.logicalDeck === logicalDeck && item.variant === 'same_name_modified');
  if (!baseline || !modified) continue;
  const baselineAssets = new Map((baseline.assets ?? []).map((asset) => [Number(asset.slideNumber), asset]));
  const modifiedAssets = new Map((modified.assets ?? []).map((asset) => [Number(asset.slideNumber), asset]));
  for (const slideNumber of pickRepresentativeSlides(baseline, modified)) {
    const beforeAsset = baselineAssets.get(slideNumber);
    const afterAsset = modifiedAssets.get(slideNumber);
    const outputName = `${logicalDeck}-slide-${String(slideNumber).padStart(3, '0')}.webp`;
    await comparisonImage(
      await downloadSource(beforeAsset.storagePath),
      await downloadSource(afterAsset.storagePath),
      slideNumber,
      path.join(outputDirectory, 'assets', outputName),
    );
    visualEvidence.push({ logicalDeck, slideNumber, outputName });
  }
}

const failuresByCase = new Map();
for (const failure of report.failures ?? []) {
  if (!failure.caseId) continue;
  const list = failuresByCase.get(failure.caseId) ?? [];
  list.push(failure);
  failuresByCase.set(failure.caseId, list);
}
const checksPassed = (report.checks ?? []).filter((item) => item.pass).length;
const checksFailed = (report.checks ?? []).filter((item) => !item.pass).length;
const overallPassed = report.summary?.overall === 'passed' && checksFailed === 0 && (report.failures ?? []).length === 0;
const coverageByCase = new Map(visibleChangeCoverage.map((item) => [item.caseId, item]));

const caseRows = (report.cases ?? []).map((item) => {
  const failed = failuresByCase.has(item.caseId);
  const coverage = coverageByCase.get(item.caseId);
  return `<tr>
    <td><code>${escapeHtml(item.caseId)}</code></td>
    <td>${escapeHtml(item.variant)}</td>
    <td>${escapeHtml(item.source?.fileName)}</td>
    <td>${formatBytes(item.source?.fileSize)}</td>
    <td>${coverage ? `${coverage.actualVisibleChanges} / ${coverage.requiredVisibleChanges}` : '—'}</td>
    <td>${item.cropGate?.checkedAssets ?? 0} / ${item.cropGate?.expectedAssetSlides ?? 0}</td>
    <td><span class="badge ${failed ? 'bad' : 'good'}">${failed ? 'FAIL' : 'PASS'}</span></td>
  </tr>`;
}).join('\n');

const evidenceSections = [...new Set(visualEvidence.map((item) => item.logicalDeck))].map((logicalDeck) => {
  const images = visualEvidence.filter((item) => item.logicalDeck === logicalDeck)
    .map((item) => `<figure><img src="assets/${encodeURIComponent(item.outputName)}" alt="${escapeHtml(logicalDeck)} slide ${item.slideNumber} before and after"><figcaption>${escapeHtml(logicalDeck)} · slide ${item.slideNumber}</figcaption></figure>`)
    .join('\n');
  return `<section><h3>${escapeHtml(logicalDeck)}</h3><div class="gallery">${images}</div></section>`;
}).join('\n');

const failureRows = (report.failures ?? []).length
  ? (report.failures ?? []).map((item) => `<li><code>${escapeHtml(item.code)}</code> ${escapeHtml(item.caseId ?? '')} — ${escapeHtml(item.message)}</li>`).join('\n')
  : '<li>실패 없음</li>';

const html = `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
:root{color-scheme:light;font-family:Inter,Pretendard,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#172033;background:#f4f7fb}body{margin:0}main{max-width:1440px;margin:auto;padding:40px 28px 80px}h1{margin:0 0 10px;font-size:34px}h2{margin-top:42px}h3{margin-top:28px}.sub{color:#62708a}.summary{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:14px;margin:26px 0}.card{background:white;border:1px solid #dbe3ef;border-radius:14px;padding:18px;box-shadow:0 5px 16px #1c2b4a0a}.card b{display:block;font-size:27px;margin-top:6px}.badge{display:inline-block;padding:4px 9px;border-radius:999px;font-weight:800;font-size:12px}.good{background:#d9f9e5;color:#08783c}.bad{background:#ffe0e0;color:#b42318}table{border-collapse:collapse;width:100%;background:#fff;border-radius:12px;overflow:hidden;font-size:13px}th,td{border-bottom:1px solid #e6ebf2;padding:10px 12px;text-align:left;vertical-align:top}th{background:#edf2f9;position:sticky;top:0}.table-wrap{overflow:auto;border:1px solid #dbe3ef;border-radius:12px}.gallery{display:grid;grid-template-columns:repeat(auto-fit,minmax(520px,1fr));gap:16px}figure{margin:0;background:#fff;border:1px solid #dbe3ef;border-radius:12px;overflow:hidden}figure img{display:block;width:100%;height:auto}figcaption{padding:10px 14px;color:#4d5d78;font-weight:700}code{font-family:"SFMono-Regular",Consolas,monospace;font-size:.92em}.method{background:#fff;border-left:5px solid #3867d6;padding:18px 22px;border-radius:8px}.method li{margin:7px 0}@media(max-width:700px){main{padding:24px 14px}.gallery{grid-template-columns:1fr}h1{font-size:27px}}
</style></head><body><main>
<h1>${escapeHtml(title)}</h1>
<p class="sub">환경: <b>${escapeHtml(environmentName)}</b> · 기준 URL: <code>${escapeHtml(report.baseUrl)}</code> · 완료: ${escapeHtml(report.finishedAt)}</p>
<div class="summary">
  <div class="card">최종 판정<b><span class="badge ${overallPassed ? 'good' : 'bad'}">${overallPassed ? '100% PASS' : 'FAIL'}</span></b></div>
  <div class="card">실행 케이스<b>${report.cases?.length ?? 0}</b></div>
  <div class="card">비교 검사 통과<b>${checksPassed}</b></div>
  <div class="card">비교 검사 실패<b>${checksFailed}</b></div>
  <div class="card">렌더러<b style="font-size:18px">${escapeHtml(report.expectedRenderProvider)}</b></div>
</div>
<section class="method"><h2 style="margin-top:0">검수 기준</h2><ol>
<li>각 업로드가 새 task/job/source/run 경로를 생성하고 이전 결과를 재사용하지 않는지 검증</li>
<li>동일 파일명·동일 바이트, 동일 파일명·수정 바이트, 다른 파일명·동일 바이트, 다른 파일명·수정 바이트, 동일 크기·수정 바이트 조합 검증</li>
<li>Microsoft Graph(PowerPoint) 렌더 출처, 고정 캡처 좌표, crop padding 0을 manifest에서 검증</li>
<li>수정 fixture는 실제 캡처 이미지 SHA가 전체 이미지 페이지의 절반 이상 바뀌고, 선언하지 않은 페이지는 바뀌지 않았는지 비교</li>
<li>동일 바이트 재실행은 bytes SHA를 우선 비교하고, Graph의 극미세 안티앨리어싱 차이는 양자화 시각 지문으로 재확인</li>
<li>PPT에서 표준 이미지 박스가 감지된 슬라이드 집합과 실제 생성 asset 슬라이드 집합이 정확히 같은지 비교</li>
<li>모든 group_bake 이미지가 고정 좌표·padding 0으로 동일한 출력 크기를 갖는지 전수 검사</li>
</ol></section>
<h2>케이스별 결과</h2><div class="table-wrap"><table><thead><tr><th>Case</th><th>Variant</th><th>Source</th><th>Size</th><th>Visible changed / Min</th><th>Crops / Expected</th><th>Result</th></tr></thead><tbody>${caseRows}</tbody></table></div>
<h2>대표 전후 이미지</h2>${evidenceSections || '<p>시각 증거 없음</p>'}
<h2>실패 목록</h2><ul>${failureRows}</ul>
<p class="sub">검수 요약 데이터: <a href="report-summary.json">report-summary.json</a></p>
</main></body></html>`;

const htmlPath = path.join(outputDirectory, 'index.html');
await writeFile(htmlPath, html, 'utf8');
console.log(htmlPath);
