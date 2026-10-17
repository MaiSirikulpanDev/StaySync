import { Module } from '@nestjs/common';
import { OccupancyController } from './occupancy.controller';
import { OccupancyProjection } from './occupancy.projection';

@Module({
  controllers: [OccupancyController],
  providers: [OccupancyProjection],
})
export class OccupancyModule {}
