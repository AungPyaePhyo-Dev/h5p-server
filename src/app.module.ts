import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { H5PModule } from './h5p/h5p.module';
import { ScormModule } from './scorm/scorm.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    H5PModule,
    ScormModule,
  ],
})
export class AppModule {}
