import { Global, Injectable, Logger, Module } from '@nestjs/common';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { createReadStream } from 'node:fs';
import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { InjectConfig } from '../../config/config.module';
import type { AppConfig } from '../../config/config';

export interface StoredObject {
  stream: Readable;
  size?: number;
}

/**
 * Attachment storage (tech stack §12): S3-compatible object storage in production,
 * local filesystem for development. The database keeps metadata only.
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private s3: S3Client | null = null;

  constructor(@InjectConfig() private readonly config: AppConfig) {}

  get driver() {
    return this.config.storage.driver;
  }

  private client(): S3Client {
    const s3 = this.config.storage.s3;
    this.s3 ??= new S3Client({
      region: s3.region,
      endpoint: s3.endpoint,
      forcePathStyle: s3.forcePathStyle,
      credentials:
        s3.accessKey && s3.secretKey ? { accessKeyId: s3.accessKey, secretAccessKey: s3.secretKey } : undefined,
    });
    return this.s3;
  }

  private get bucket(): string {
    const b = this.config.storage.s3.bucket;
    if (!b) throw new Error('S3_BUCKET is not configured');
    return b;
  }

  private localPath(key: string): string {
    const root = path.resolve(this.config.storage.localDir);
    const full = path.resolve(root, key);
    if (!full.startsWith(root + path.sep)) throw new Error('Invalid storage key');
    return full;
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    if (this.driver === 's3') {
      await this.client().send(
        new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }),
      );
      return;
    }
    const file = this.localPath(key);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, body);
  }

  async get(key: string): Promise<StoredObject> {
    if (this.driver === 's3') {
      const res = await this.client().send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      return { stream: res.Body as Readable, size: res.ContentLength };
    }
    const file = this.localPath(key);
    const info = await stat(file);
    return { stream: createReadStream(file), size: info.size };
  }

  async remove(key: string): Promise<void> {
    try {
      if (this.driver === 's3') {
        await this.client().send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
      } else {
        await rm(this.localPath(key), { force: true });
      }
    } catch (err) {
      this.logger.warn(`Failed to delete object ${key}: ${(err as Error).message}`);
    }
  }

  async isHealthy(): Promise<boolean> {
    try {
      if (this.driver === 's3') {
        await this.client().send(new HeadBucketCommand({ Bucket: this.bucket }));
      } else {
        await mkdir(path.resolve(this.config.storage.localDir), { recursive: true });
      }
      return true;
    } catch {
      return false;
    }
  }
}

@Global()
@Module({ providers: [StorageService], exports: [StorageService] })
export class StorageModule {}
