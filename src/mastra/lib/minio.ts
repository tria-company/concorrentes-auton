/**
 * MinIO (S3-compatible) archive helper. Configurado pelo env:
 *   MINIO_ENDPOINT, MINIO_ACCESS_KEY, MINIO_SECRET_KEY, MINIO_BUCKET (default: concorrentes-auton)
 * Quando MINIO_ENDPOINT não está setado, todas as funções viram no-op — pipeline continua usando URLs CDN externos.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';

const ENDPOINT = process.env.MINIO_ENDPOINT;
const BUCKET = process.env.MINIO_BUCKET ?? 'concorrentes-auton';
const MAX_BYTES = Number(process.env.MINIO_MAX_BYTES ?? 50 * 1024 * 1024); // 50 MB hard cap por arquivo

let _client: S3Client | null = null;
function client(): S3Client {
  if (_client) return _client;
  const ak = process.env.MINIO_ACCESS_KEY;
  const sk = process.env.MINIO_SECRET_KEY;
  if (!ENDPOINT || !ak || !sk) throw new Error('MinIO env ausente (MINIO_ENDPOINT/ACCESS_KEY/SECRET_KEY)');
  _client = new S3Client({
    endpoint: ENDPOINT,
    region: 'us-east-1',
    credentials: { accessKeyId: ak, secretAccessKey: sk },
    forcePathStyle: true,
  });
  return _client;
}

export function minioEnabled(): boolean {
  return !!(ENDPOINT && process.env.MINIO_ACCESS_KEY && process.env.MINIO_SECRET_KEY);
}

export function minioPublicUrl(key: string): string {
  return `${ENDPOINT!.replace(/\/$/, '')}/${BUCKET}/${key}`;
}

export async function exists(key: string): Promise<boolean> {
  try {
    await client().send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    return true;
  } catch (e: any) {
    if (e?.$metadata?.httpStatusCode === 404 || e?.name === 'NotFound') return false;
    throw e;
  }
}

/** Baixa URL externa e sobe pro MinIO; retorna URL pública. Idempotente (HEAD antes). */
export async function archiveUrl(sourceUrl: string, key: string): Promise<string> {
  if (await exists(key)) return minioPublicUrl(key);

  const res = await fetch(sourceUrl);
  if (!res.ok) throw new Error(`download HTTP ${res.status}`);

  const cl = Number(res.headers.get('content-length') ?? 0);
  if (cl > MAX_BYTES) throw new Error(`tamanho ${cl} > limite ${MAX_BYTES}`);

  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.byteLength > MAX_BYTES) throw new Error(`tamanho real ${buf.byteLength} > limite ${MAX_BYTES}`);

  await client().send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: buf,
    ContentType: res.headers.get('content-type') ?? 'application/octet-stream',
  }));
  return minioPublicUrl(key);
}

/** Deriva extensão da URL (ex: '.mp4', '.jpg'). Default no fallback. */
export function extOf(url: string, fallback = '.bin'): string {
  try {
    const u = new URL(url);
    const m = u.pathname.match(/\.([a-zA-Z0-9]{1,5})$/);
    return m ? `.${m[1].toLowerCase()}` : fallback;
  } catch { return fallback; }
}
