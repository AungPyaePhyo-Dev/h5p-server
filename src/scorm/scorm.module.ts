import { Module } from '@nestjs/common';
import { ScormService } from './scorm.service';
import { ScormController } from './scorm.controller';
import { LessonService } from './lesson.service';
import { LessonController } from './lesson.controller';

@Module({
  providers: [ScormService, LessonService],
  controllers: [ScormController, LessonController],
})
export class ScormModule {}
