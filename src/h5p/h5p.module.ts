import { Module } from '@nestjs/common';
import { H5PService } from './h5p.service';
import { H5PController } from './h5p.controller';

@Module({
  providers: [H5PService],
  controllers: [H5PController],
})
export class H5PModule {}
