import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CreatePricingRuleDto, QuoteQueryDto } from './pricing.dto';
import { PricingService } from './pricing.service';

@ApiTags('pricing')
@Controller('properties/:id')
export class PricingController {
  constructor(private readonly pricing: PricingService) {}

  @Post('pricing-rules')
  createRule(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreatePricingRuleDto,
  ) {
    return this.pricing.createRule(id, dto);
  }

  @Get('pricing-rules')
  listRules(@Param('id', ParseUUIDPipe) id: string) {
    return this.pricing.listRules(id);
  }

  @Delete('pricing-rules/:ruleId')
  @HttpCode(204)
  deleteRule(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('ruleId', ParseUUIDPipe) ruleId: string,
  ) {
    return this.pricing.deleteRule(id, ruleId);
  }

  @Get('quote')
  quote(@Param('id', ParseUUIDPipe) id: string, @Query() q: QuoteQueryDto) {
    return this.pricing.quote(id, q);
  }
}
