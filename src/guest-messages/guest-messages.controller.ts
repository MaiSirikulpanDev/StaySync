import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CreateGuestMessageDto } from './guest-message.dto';
import { GuestMessagesService } from './guest-messages.service';

@ApiTags('guest-messages')
@Controller()
export class GuestMessagesController {
  constructor(private readonly messages: GuestMessagesService) {}

  @Post('properties/:id/guest-messages')
  create(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateGuestMessageDto,
  ) {
    return this.messages.create(id, dto);
  }

  @Get('guest-messages/:id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.messages.get(id);
  }
}
