import { Injectable, NotFoundException } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { Writable } from 'stream';
import { v4 as uuid } from 'uuid';
import { PrismaService } from '../prisma/prisma.service';
import { Block, LessonPayload, exportLessonScorm } from './lesson-exporter';

export type LessonInput = {
  title: string;
  description?: string;
  blocks: Block[];
};

@Injectable()
export class LessonService {
  private readonly dataDir = path.resolve(process.env.H5P_DATA_DIR || './h5p-data');

  constructor(private readonly prisma: PrismaService) {}

  private assetsDirFor(lessonId: string): string {
    return path.join(this.dataDir, 'scorm-assets', lessonId);
  }

  async list() {
    return this.prisma.scormLesson.findMany({
      orderBy: { updatedAt: 'desc' },
      select: { id: true, title: true, description: true, updatedAt: true },
    });
  }

  async get(id: string): Promise<LessonPayload> {
    const row = await this.prisma.scormLesson.findUnique({ where: { id } });
    if (!row) throw new NotFoundException(`lesson ${id} not found`);
    return {
      id: row.id,
      title: row.title,
      description: row.description,
      blocks: row.blocks as unknown as Block[],
    };
  }

  async create(input: LessonInput): Promise<{ id: string }> {
    const id = uuid();
    await this.prisma.scormLesson.create({
      data: {
        id,
        title: input.title,
        description: input.description ?? '',
        blocks: normalizeBlocks(input.blocks) as any,
      },
    });
    // Ensure assets directory exists up-front so uploads can land in it.
    fs.mkdirSync(this.assetsDirFor(id), { recursive: true });
    return { id };
  }

  async update(id: string, input: LessonInput): Promise<void> {
    const existing = await this.get(id);
    const nextBlocks = normalizeBlocks(input.blocks);

    await this.prisma.scormLesson.update({
      where: { id },
      data: {
        title: input.title,
        description: input.description ?? '',
        blocks: nextBlocks as any,
      },
    });

    // Clean up asset files that are no longer referenced.
    const kept = new Set(collectUploadFilenames(nextBlocks));
    const orphaned = collectUploadFilenames(existing.blocks).filter((f) => !kept.has(f));
    for (const filename of orphaned) {
      const abs = path.join(this.assetsDirFor(id), filename);
      try { fs.unlinkSync(abs); } catch { /* ignore */ }
    }
  }

  async remove(id: string): Promise<void> {
    await this.prisma.scormLesson.delete({ where: { id } });
    const dir = this.assetsDirFor(id);
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }

  async duplicate(sourceId: string): Promise<{ id: string }> {
    const src = await this.get(sourceId);
    const newId = uuid();
    // Copy asset files to the new lesson's dir so upload-kind blocks resolve.
    const srcDir = this.assetsDirFor(sourceId);
    const dstDir = this.assetsDirFor(newId);
    fs.mkdirSync(dstDir, { recursive: true });
    if (fs.existsSync(srcDir)) {
      for (const filename of fs.readdirSync(srcDir)) {
        fs.copyFileSync(path.join(srcDir, filename), path.join(dstDir, filename));
      }
    }
    await this.prisma.scormLesson.create({
      data: {
        id: newId,
        title: `${src.title} (copy)`,
        description: src.description,
        blocks: normalizeBlocks(src.blocks) as any,
      },
    });
    return { id: newId };
  }

  async saveUpload(
    lessonId: string,
    originalName: string,
    buffer: Buffer,
  ): Promise<{ filename: string; url: string }> {
    // Ensure lesson exists.
    await this.get(lessonId);
    const dir = this.assetsDirFor(lessonId);
    fs.mkdirSync(dir, { recursive: true });
    const safe = safeFilename(originalName);
    const filename = `${Date.now()}-${uuid().slice(0, 8)}-${safe}`;
    fs.writeFileSync(path.join(dir, filename), buffer);
    return {
      filename,
      url: `/scorm/lesson/${lessonId}/assets/${encodeURIComponent(filename)}`,
    };
  }

  async readAsset(lessonId: string, filename: string): Promise<{ path: string; contentType: string }> {
    const abs = path.join(this.assetsDirFor(lessonId), filename);
    if (!abs.startsWith(this.assetsDirFor(lessonId)) || !fs.existsSync(abs)) {
      throw new NotFoundException(`asset not found`);
    }
    return { path: abs, contentType: guessContentType(filename) };
  }

  async exportZip(id: string, out: Writable): Promise<void> {
    const lesson = await this.get(id);
    exportLessonScorm(lesson, this.assetsDirFor(id), out);
  }
}

function normalizeBlocks(blocks: Block[]): Block[] {
  return blocks.map((b) => {
    const id = b.id || uuid();
    if (b.type === 'quiz') {
      return {
        id,
        type: 'quiz',
        passThreshold: b.passThreshold ?? 70,
        questions: (b.questions || []).map((q) => ({
          id: q.id || uuid(),
          prompt: q.prompt,
          choices: (q.choices || []).map((c) => ({ id: c.id || uuid(), text: c.text })),
          correctChoiceId: q.correctChoiceId,
        })),
      };
    }
    if (b.type === 'hotspot') {
      return {
        id,
        type: 'hotspot',
        src: b.src,
        requireAll: b.requireAll ?? true,
        hotspots: (b.hotspots || []).map((h) => ({
          id: h.id || uuid(),
          x: clampPct(h.x),
          y: clampPct(h.y),
          title: h.title || '',
          body: h.body || '',
        })),
      };
    }
    return { ...b, id };
  });
}

function clampPct(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, n));
}

function collectUploadFilenames(blocks: Block[]): string[] {
  const out: string[] = [];
  for (const b of blocks) {
    if (b.type === 'image') out.push(b.src.filename);
    else if (b.type === 'video' && b.src.kind === 'upload') out.push(b.src.filename);
    else if (b.type === 'hotspot') out.push(b.src.filename);
  }
  return out;
}

function safeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || 'file';
}

function guessContentType(name: string): string {
  const ext = path.extname(name).toLowerCase();
  switch (ext) {
    case '.png': return 'image/png';
    case '.jpg':
    case '.jpeg': return 'image/jpeg';
    case '.gif': return 'image/gif';
    case '.webp': return 'image/webp';
    case '.svg': return 'image/svg+xml';
    case '.mp4': return 'video/mp4';
    case '.webm': return 'video/webm';
    case '.ogg': return 'video/ogg';
    case '.mov': return 'video/quicktime';
    default: return 'application/octet-stream';
  }
}
