import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';

// 오브젝트 저장소(R2/S3). 워커는 원본을 내려받아 변환하고, 결과(렌더/에셋/매니페스트)를 여기에 올린다.
// 웹의 src/lib/storage/source-storage.ts 와 같은 버킷/설정. 버킷 하나에 key prefix 로 구분.
const endpoint = process.env.R2_ENDPOINT;
const bucket = process.env.R2_BUCKET ?? 'manual-source';
const region = process.env.R2_REGION ?? 'auto';

function client() {
  if (!endpoint) throw new Error('R2_ENDPOINT 가 설정되지 않았습니다(워커 오브젝트 저장소 환경변수 필요).');
  return new S3Client({
    region,
    endpoint,
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID ?? '',
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? '',
    },
  });
}

export function isSourceStorageConfigured() {
  return Boolean(endpoint);
}

// 원본/결과 오브젝트를 Buffer 로 내려받는다.
export async function downloadSource(key) {
  const res = await client().send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const chunks = [];
  for await (const chunk of res.Body) chunks.push(chunk);
  return Buffer.concat(chunks);
}

// 결과 오브젝트를 올린다(렌더/에셋 PNG, 매니페스트 JSON).
export async function putObject(key, body, contentType) {
  await client().send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }));
}

// key 목록 삭제(재변환 시 이전 run 결과 정리 — 누수 방지).
export async function deleteObjects(keys) {
  const clean = keys.filter(Boolean);
  if (!clean.length) return;
  const c = client();
  for (let i = 0; i < clean.length; i += 1000) {
    const chunk = clean.slice(i, i + 1000);
    await c.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: chunk.map((Key) => ({ Key })) } }));
  }
}

// prefix 로 모든 key 나열.
export async function listPrefix(prefix) {
  const c = client();
  const keys = [];
  let token;
  do {
    const res = await c.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }));
    for (const obj of res.Contents ?? []) if (obj.Key) keys.push(obj.Key);
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
  return keys;
}
