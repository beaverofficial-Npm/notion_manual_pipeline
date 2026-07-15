import 'server-only';
import { S3Client, PutObjectCommand, DeleteObjectsCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

// 원본 PPT 저장소 = R2(S3 호환).
// Supabase Storage 의 파일당 50MB 업로드 한도(Free 플랜)를 벗어나기 위해, 큰 원본 PPT 만
// 이 버킷으로 보낸다. 렌더/에셋/매니페스트(작은 파일)는 그대로 Supabase Storage 를 쓴다.
// R2 자격증명이 없으면(로컬 미설정) 호출 시 명확히 실패한다 — 조용한 오작동 방지.
const endpoint = process.env.R2_ENDPOINT;
const bucket = process.env.R2_BUCKET ?? 'manual-source';
const region = process.env.R2_REGION ?? 'auto';

function client(): S3Client {
  if (!endpoint) {
    throw new Error('R2_ENDPOINT 가 설정되지 않았습니다. 원본 저장소(R2/S3) 환경변수를 설정해야 업로드할 수 있습니다.');
  }
  return new S3Client({
    region,
    endpoint,
    forcePathStyle: true, // R2/MinIO 호환(path-style 접근)
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID ?? '',
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? '',
    },
  });
}

export function isSourceStorageConfigured(): boolean {
  return Boolean(endpoint);
}

// 2단계: 브라우저가 원본을 직접 PUT 할 presigned URL(서버는 파일 바이트를 받지 않는다).
export async function createSourceUploadUrl(key: string, contentType: string, expiresIn = 600): Promise<string> {
  return getSignedUrl(client(), new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType }), { expiresIn });
}

// 1단계/폴백: 서버 경유 업로드.
export async function putSource(key: string, body: Buffer, contentType: string): Promise<void> {
  await client().send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }));
}

// task 삭제 시 원본 정리(존재하지 않는 키는 무시된다).
export async function deleteSources(keys: string[]): Promise<void> {
  const clean = keys.filter(Boolean);
  if (!clean.length) return;
  const c = client();
  for (let i = 0; i < clean.length; i += 1000) {
    const chunk = clean.slice(i, i + 1000);
    await c.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: chunk.map((Key) => ({ Key })) } }));
  }
}
