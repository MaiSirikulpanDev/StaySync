import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CreateChannelDto } from './channel.dto';
import { ChannelsService } from './channels.service';

@ApiTags('channels')
@Controller('properties/:id/channels')
export class ChannelsController {
  constructor(private readonly channels: ChannelsService) {}

  @Post()
  create(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateChannelDto,
  ) {
    return this.channels.create(id, dto);
  }

  @Get()
  list(@Param('id', ParseUUIDPipe) id: string) {
    return this.channels.list(id);
  }

  @Delete(':channelId')
  @HttpCode(204)
  delete(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('channelId', ParseUUIDPipe) channelId: string,
  ) {
    return this.channels.delete(id, channelId);
  }
}
