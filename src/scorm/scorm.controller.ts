import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { ScormService, QuizInput } from './scorm.service';

@Controller('scorm')
export class ScormController {
  constructor(private readonly scorm: ScormService) {}

  @Get('quiz')
  list() {
    return this.scorm.list();
  }

  @Get('quiz/:id')
  get(@Param('id') id: string) {
    return this.scorm.get(id);
  }

  @Post('quiz')
  create(@Body() body: QuizInput) {
    return this.scorm.create(body);
  }

  @Put('quiz/:id')
  async update(@Param('id') id: string, @Body() body: QuizInput) {
    await this.scorm.update(id, body);
    return { ok: true };
  }

  @Delete('quiz/:id')
  async remove(@Param('id') id: string) {
    await this.scorm.remove(id);
    return { ok: true };
  }

  // GET /scorm/quiz/:id/export — stream a SCORM 1.2 zip for this quiz.
  @Get('quiz/:id/export')
  async exportQuiz(@Param('id') id: string, @Res() res: Response) {
    const quiz = await this.scorm.get(id);
    const filename = `${quiz.title || id}.zip`.replace(/[^a-zA-Z0-9._ -]/g, '_');
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    await this.scorm.exportZip(id, res);
  }
}
