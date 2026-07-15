import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';

// 원본 PPT 저장소(R2/S3 호환). 워커는 여기서 원본을 내려받아 변환한다.
// 웹의 src/lib/storage/source-storage.ts 와 같은 버킷/설정을 바라본다.
const endpoint = process.env.R2_ENDPOINT;
const bucket = process.env.R2_BUCKET ?? 'manual-source';
const region = process.env.R2_REGION ?? 'auto';

function client() {
  if (!endpoint) throw new Error('R2_ENDPOINT 가 설정되지 않았습니다(워커 원본 저장소 환경변수 필요).');
  return new S3Client({
    region,
    endpoint,
    forcePathStyle: true, // R2/MinIO 호환
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID ?? '',
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? '',
    },
  });
}

export function isSourceStorageConfigured() {
  return Boolean(endpoint);
}

// 원본 PPT 를 Buffer 로 내려받는다.
export async function downloadSource(key) {
  const res = await client().send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const chunks = [];
  for await (const chunk of res.Body) chunks.push(chunk);
  return Buffer.concat(chunks);
}
