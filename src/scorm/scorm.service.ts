import { Injectable, NotFoundException } from '@nestjs/common';
import { v4 as uuid } from 'uuid';
import { Writable } from 'stream';
import { PrismaService } from '../prisma/prisma.service';
import { exportQuizScorm, Question, QuizPayload } from './scorm-exporter';

export type QuizInput = {
  title: string;
  description?: string;
  passThreshold?: number;
  questions: Question[];
};

@Injectable()
export class ScormService {
  constructor(private readonly prisma: PrismaService) {}

  async list() {
    return this.prisma.scormQuiz.findMany({
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        title: true,
        description: true,
        passThreshold: true,
        updatedAt: true,
      },
    });
  }

  async get(id: string): Promise<QuizPayload> {
    const row = await this.prisma.scormQuiz.findUnique({ where: { id } });
    if (!row) throw new NotFoundException(`quiz ${id} not found`);
    return {
      id: row.id,
      title: row.title,
      description: row.description,
      passThreshold: row.passThreshold,
      questions: row.questions as unknown as Question[],
    };
  }

  async create(input: QuizInput): Promise<{ id: string }> {
    const id = uuid();
    await this.prisma.scormQuiz.create({
      data: {
        id,
        title: input.title,
        description: input.description ?? '',
        passThreshold: input.passThreshold ?? 70,
        questions: normalizeQuestions(input.questions) as any,
      },
    });
    return { id };
  }

  async update(id: string, input: QuizInput): Promise<void> {
    await this.prisma.scormQuiz.update({
      where: { id },
      data: {
        title: input.title,
        description: input.description ?? '',
        passThreshold: input.passThreshold ?? 70,
        questions: normalizeQuestions(input.questions) as any,
      },
    });
  }

  async remove(id: string): Promise<void> {
    await this.prisma.scormQuiz.delete({ where: { id } });
  }

  async exportZip(id: string, out: Writable): Promise<void> {
    const quiz = await this.get(id);
    exportQuizScorm(quiz, out);
  }
}

function normalizeQuestions(qs: Question[]): Question[] {
  return qs.map((q) => ({
    id: q.id || uuid(),
    prompt: q.prompt,
    choices: q.choices.map((c) => ({ id: c.id || uuid(), text: c.text })),
    correctChoiceId: q.correctChoiceId,
  }));
}
