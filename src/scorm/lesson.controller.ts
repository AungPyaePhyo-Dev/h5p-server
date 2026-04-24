import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import * as fs from 'fs';
import { LessonInput, LessonService } from './lesson.service';

// @types/multer no longer augments the Express namespace in a way TS picks
// up under our tsconfig; define the narrow subset we use.
type UploadedFile = {
  originalname: string;
  buffer: Buffer;
  mimetype: string;
  size: number;
};

@Controller('scorm/lesson')
export class LessonController {
  constructor(private readonly lessons: LessonService) {}

  @Get()
  list() {
    return this.lessons.list();
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.lessons.get(id);
  }

  @Post()
  create(@Body() body: LessonInput) {
    return this.lessons.create(body);
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() body: LessonInput) {
    await this.lessons.update(id, body);
    return { ok: true };
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    await this.lessons.remove(id);
    return { ok: true };
  }

  @Post(':id/duplicate')
  duplicate(@Param('id') id: string) {
    return this.lessons.duplicate(id);
  }

  // POST /scorm/lesson/:id/upload — multipart form, field name "file".
  // Returns { filename, url } — client stores `filename` on the block.
  @Post(':id/upload')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 200 * 1024 * 1024 } }))
  async upload(
    @Param('id') id: string,
    @UploadedFile() file: UploadedFile,
  ) {
    if (!file) throw new BadRequestException('no file');
    return this.lessons.saveUpload(id, file.originalname, file.buffer);
  }

  // GET /scorm/lesson/:id/assets/:filename — serve uploaded file (for preview in the authoring UI).
  @Get(':id/assets/:filename')
  async asset(
    @Param('id') id: string,
    @Param('filename') filename: string,
    @Res() res: Response,
  ) {
    const { path: abs, contentType } = await this.lessons.readAsset(id, filename);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'private, max-age=60');
    fs.createReadStream(abs).pipe(res);
  }

  // GET /scorm/lesson/:id/export — stream the SCORM 1.2 zip.
  @Get(':id/export')
  async exportLesson(@Param('id') id: string, @Res() res: Response) {
    const lesson = await this.lessons.get(id);
    const filename = `${lesson.title || id}.zip`.replace(/[^a-zA-Z0-9._ -]/g, '_');
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    await this.lessons.exportZip(id, res);
  }
}
