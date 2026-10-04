import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PropertiesService } from './properties.service';
import { CreatePropertyDto, UpdatePropertyDto } from './property.dto';

@ApiTags('properties')
@Controller('properties')
export class PropertiesController {
  constructor(private readonly properties: PropertiesService) {}

  @Post()
  create(@Body() dto: CreatePropertyDto) {
    return this.properties.create(dto);
  }

  @Get()
  list() {
    return this.properties.list();
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.properties.get(id);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePropertyDto,
  ) {
    return this.properties.update(id, dto);
  }
}
