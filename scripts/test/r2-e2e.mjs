// R2(S3 호환) 원본 저장소 e2e 검증 — prod Supabase DB 는 건드리지 않는다(R2 경로만 격리 검증).
// 실행: node --env-file=.env.staging scripts/test/r2-e2e.mjs <big.pptx 경로>
//  1) presigned PUT(브라우저 직접 업로드 방식)으로 50MB+ 파일 업로드
//  2) 워커 코드(downloadSource)로 다시 받아 sha256 대조(왕복 무결)
//  3) 받은 파일을 soffice 로 변환(파이프라인 무결)
import { S3Client, CreateBucketCommand, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { downloadSource, isSourceStorageConfigured } from '../worker/source-storage.mjs';
import { execFile } from 'node:child_process';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import path from 'node:path';
import crypto from 'node:crypto';

const execFileAsync = promisify(execFile);
const CT = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

function sha(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

async function main() {
  const bigPath = process.argv[2];
  if (!bigPath) throw new Error('사용법: node --env-file=.env.staging scripts/test/r2-e2e.mjs <big.pptx>');
  if (!isSourceStorageConfigured()) throw new Error('R2_ENDPOINT 미설정 (--env-file=.env.staging 확인)');

  const endpoint = process.env.R2_ENDPOINT;
  const bucket = process.env.R2_BUCKET;
  const s3 = new S3Client({
    region: process.env.R2_REGION ?? 'auto',
    endpoint,
    forcePathStyle: true,
    credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY },
  });
  console.log(`R2 endpoint=${endpoint} bucket=${bucket}`);

  // 1) 버킷 확보
  try {
    await s3.send(new CreateBucketCommand({ Bucket: bucket }));
    console.log(`[버킷] 생성됨: ${bucket}`);
  } catch (e) {
    if (['BucketAlreadyOwnedByYou', 'BucketAlreadyExists'].includes(e.name)) console.log(`[버킷] 이미 존재: ${bucket}`);
    else throw e;
  }

  // 2) 원본 로드
  const bigBuf = await readFile(bigPath);
  const srcHash = sha(bigBuf);
  const mb = (bigBuf.length / 1024 / 1024).toFixed(1);
  console.log(`[원본] ${mb}MB sha=${srcHash.slice(0, 12)} (50MB 초과=${bigBuf.length > 52428800})`);

  // 3) presigned PUT (2단계: 브라우저가 서버 안 거치고 직접 올리는 방식)
  const key = `e2e-test/${Date.now()}-test-big.pptx`;
  const putUrl = await getSignedUrl(s3, new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: CT }), { expiresIn: 600 });
  const t0 = Date.now();
  const putRes = await fetch(putUrl, { method: 'PUT', body: bigBuf, headers: { 'Content-Type': CT } });
  if (!putRes.ok) throw new Error(`presigned PUT 실패 ${putRes.status}: ${await putRes.text()}`);
  console.log(`[업로드] presigned PUT ${putRes.status} OK (${((Date.now() - t0) / 1000).toFixed(1)}s) → ${key}`);

  const head = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
  console.log(`[저장확인] R2 객체 크기 ${(Number(head.ContentLength) / 1024 / 1024).toFixed(1)}MB`);

  // 4) 워커 코드(downloadSource)로 회수 + 해시 대조
  const dlBuf = await downloadSource(key);
  const dlHash = sha(dlBuf);
  const match = srcHash === dlHash;
  console.log(`[다운로드] 워커 downloadSource ${(dlBuf.length / 1024 / 1024).toFixed(1)}MB sha=${dlHash.slice(0, 12)} 왕복일치=${match}`);
  if (!match) throw new Error('왕복 sha256 불일치 — R2 저장/회수 손상');

  // 5) soffice 변환(파이프라인 무결)
  const tmp = path.join(path.dirname(bigPath), 'e2e-render');
  await rm(tmp, { recursive: true, force: true });
  await mkdir(tmp, { recursive: true });
  const pptOut = path.join(tmp, 'in.pptx');
  await writeFile(pptOut, dlBuf);
  const soffice = process.env.SOFFICE_BIN ?? '/opt/homebrew/bin/soffice';
  const t1 = Date.now();
  await execFileAsync(
    soffice,
    [`-env:UserInstallation=file://${path.join(tmp, 'prof')}`, '--headless', '--norestore', '--convert-to', 'pdf', '--outdir', tmp, pptOut],
    { maxBuffer: 1024 * 1024 * 16, timeout: 180000, killSignal: 'SIGKILL' },
  );
  const pdf = (await readdir(tmp)).find((f) => f.toLowerCase().endsWith('.pdf'));
  if (!pdf) throw new Error('soffice 변환 실패(PDF 미생성)');
  const pdfSize = (await readFile(path.join(tmp, pdf))).length;
  console.log(`[변환] soffice PDF 생성 ${pdf} (${(pdfSize / 1024 / 1024).toFixed(1)}MB, ${((Date.now() - t1) / 1000).toFixed(1)}s)`);

  // 정리
  await rm(tmp, { recursive: true, force: true });
  console.log('\n✅ 1단계 e2e 통과: 60MB PPTX → R2 presigned PUT → 워커 다운로드(해시일치) → soffice 변환');
  console.log('   (Supabase Free 50MB 한도였다면 업로드 자체가 거부됐을 크기)');
}

main().catch((e) => {
  console.error('\n❌ e2e 실패:', e instanceof Error ? e.message : e);
  process.exit(1);
});
