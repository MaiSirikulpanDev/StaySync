import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/public.decorator';
import { OtaWebhookDto } from './ota-webhook.dto';
import { OtaWebhookGuard } from './ota-webhook.guard';
import { OtaWebhookService } from './ota-webhook.service';

@ApiTags('webhooks')
@Public() // authenticated by HMAC instead of the API key
@UseGuards(OtaWebhookGuard)
@Controller('webhooks/mock-ota')
export class OtaWebhookController {
  constructor(private readonly webhook: OtaWebhookService) {}

  @Post()
  @HttpCode(200)
  receive(
    @Headers('x-ota-event-id') eventId: string | undefined,
    @Body() dto: OtaWebhookDto,
  ) {
    if (!eventId) {
      throw new BadRequestException('x-ota-event-id header is required');
    }
    return this.webhook.handle(eventId, dto);
  }
}
