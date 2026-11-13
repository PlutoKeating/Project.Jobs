import { CreateBucketCommand, GetObjectCommand, HeadBucketCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { env, sha256 } from '@pux/core';

/** 证据对象存储（S3 兼容，本地为 MinIO）。对象按内容哈希寻址，写入后不可变。 */
export class BlobStore {
  private client: S3Client;
  private ready?: Promise<void>;
  constructor(private bucket = env.s3Bucket) {
    this.client = new S3Client({ endpoint: env.s3Endpoint, region: 'us-east-1', forcePathStyle: true, credentials: { accessKeyId: env.s3AccessKey, secretAccessKey: env.s3SecretKey } });
  }
  private ensure() {
    this.ready ??= (async () => {
      try { await this.client.send(new HeadBucketCommand({ Bucket: this.bucket })); }
      catch { await this.client.send(new CreateBucketCommand({ Bucket: this.bucket })).catch((e) => { if (!String(e?.name).includes('BucketAlreadyOwnedByYou')) throw e; }); }
    })();
    return this.ready;
  }
  /** 写入并返回 { key, hash }；相同内容只存一份 */
  async put(data: Buffer | string, mime: string, ext = ''): Promise<{ key: string; hash: string; bytes: number }> {
    await this.ensure();
    const buf = typeof data === 'string' ? Buffer.from(data) : data;
    const hash = sha256(buf);
    const key = `sha256/${hash.slice(0, 2)}/${hash}${ext}`;
    const exists = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key })).then(() => true, () => false);
    if (!exists) await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: buf, ContentType: mime }));
    return { key, hash, bytes: buf.length };
  }
  async get(key: string): Promise<Buffer> {
    await this.ensure();
    const r = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    return Buffer.from(await r.Body!.transformToByteArray());
  }
  async getText(key: string) { return (await this.get(key)).toString('utf8'); }
  async ping() { await this.ensure(); return true; }
}

let store: BlobStore | undefined;
export const blobs = () => (store ??= new BlobStore());
