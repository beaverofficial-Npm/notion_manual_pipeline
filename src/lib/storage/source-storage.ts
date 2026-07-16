import 'server-only';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Readable } from 'node:stream';

// 오브젝트 저장소 = R2(S3 호환). 원본 PPT + 변환 결과(렌더/에셋/매니페스트)를 모두 여기에 둔다.
// 버킷 하나(R2_BUCKET)에 key prefix 로 구분: {task}/source/.., {task}/runs/N/slides/.., .../assets/.., manifest.json
// (Supabase Storage 무료 1GB 를 결과 이미지가 금방 채우므로 결과물도 R2 로 옮겼다.)
const endpoint = process.env.R2_ENDPOINT;
const bucket = process.env.R2_BUCKET ?? 'manual-source';
const region = process.env.R2_REGION ?? 'auto';

function client(): S3Client {
  if (!endpoint) {
    throw new Error('R2_ENDPOINT 가 설정되지 않았습니다. 오브젝트 저장소(R2/S3) 환경변수를 설정해야 합니다.');
  }
  return new S3Client({
    region,
    endpoint,
    forcePathStyle: true, // R2/MinIO 호환(path-style)
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID ?? '',
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? '',
    },
  });
}

export function isSourceStorageConfigured(): boolean {
  return Boolean(endpoint);
}

// 브라우저가 원본을 직접 PUT 할 presigned URL.
export async function createSourceUploadUrl(key: string, contentType: string, expiresIn = 600): Promise<string> {
  return getSignedUrl(client(), new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType }), { expiresIn });
}

// 브라우저 <img> 가 이미지를 로드할 presigned GET URL(검수·미리보기 표시용).
export async function presignGetUrl(key: string, expiresIn = 60 * 30): Promise<string> {
  return getSignedUrl(client(), new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn });
}

// 여러 key 를 한 번에 presigned GET(각 서명은 로컬 계산이라 네트워크 왕복 없음).
export async function presignGetUrls(keys: string[], expiresIn = 60 * 30): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  await Promise.all(
    keys.map(async (key) => {
      map.set(key, await presignGetUrl(key, expiresIn));
    }),
  );
  return map;
}

// 서버가 오브젝트 저장(웹 경로: 크롭 재저장 등).
export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  await client().send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }));
}

// 서버가 오브젝트 다운로드(발행 시 이미지 로드).
export async function getObjectBuffer(key: string): Promise<Buffer> {
  const res = await client().send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const chunks: Buffer[] = [];
  for await (const chunk of res.Body as Readable) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

// 원본 서버경유 업로드(폴백). 이제 putObject 와 동일.
export async function putSource(key: string, body: Buffer, contentType: string): Promise<void> {
  return putObject(key, body, contentType);
}

// key 목록 삭제(존재하지 않는 key 는 무시).
export async function deleteObjects(keys: string[]): Promise<void> {
  const clean = keys.filter(Boolean);
  if (!clean.length) return;
  const c = client();
  for (let i = 0; i < clean.length; i += 1000) {
    const chunk = clean.slice(i, i + 1000);
    await c.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: chunk.map((Key) => ({ Key })) } }));
  }
}
export const deleteSources = deleteObjects;

// prefix 로 모든 key 나열(고아 정리·task 삭제·재변환 정리용).
export async function listPrefix(prefix: string): Promise<string[]> {
  const c = client();
  const keys: string[] = [];
  let token: string | undefined;
  do {
    const res = await c.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }));
    for (const obj of res.Contents ?? []) if (obj.Key) keys.push(obj.Key);
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
  return keys;
}
