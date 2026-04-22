import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { H5PService } from './h5p.service';
import { H5PController } from './h5p.controller';
import { ContentRecord } from './content-record.entity';

@Module({
  imports: [TypeOrmModule.forFeature([ContentRecord])],
  providers: [H5PService],
  controllers: [H5PController],
})
export class H5PModule {}
