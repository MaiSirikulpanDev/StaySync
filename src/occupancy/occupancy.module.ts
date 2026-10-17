import { Module } from '@nestjs/common';
import { OccupancyController } from './occupancy.controller';

@Module({ controllers: [OccupancyController] })
export class OccupancyModule {}
