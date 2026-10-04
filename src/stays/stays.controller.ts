import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  AvailabilityQueryDto,
  CreateStayDto,
  ListStaysQueryDto,
} from './stay.dto';
import { StaysService } from './stays.service';

@ApiTags('stays')
@Controller()
export class StaysController {
  constructor(private readonly stays: StaysService) {}

  @Post('properties/:id/stays')
  create(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateStayDto) {
    return this.stays.create(id, dto);
  }

  @Get('properties/:id/stays')
  list(@Param('id', ParseUUIDPipe) id: string, @Query() q: ListStaysQueryDto) {
    return this.stays.list(id, q);
  }

  @Post('stays/:id/cancel')
  cancel(@Param('id', ParseUUIDPipe) id: string) {
    return this.stays.cancel(id);
  }

  @Get('properties/:id/availability')
  availability(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() q: AvailabilityQueryDto,
  ) {
    return this.stays.availability(id, q);
  }
}
