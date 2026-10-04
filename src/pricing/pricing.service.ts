import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PricingRule as DbRule } from '@prisma/client';
import { toDay } from '../common/dates';
import { PrismaService } from '../prisma/prisma.service';
import { PropertiesService } from '../properties/properties.service';
import { CreatePricingRuleDto, QuoteQueryDto } from './pricing.dto';
import { quote } from './pricing.engine';

const view = (r: DbRule) => ({
  ...r,
  startDate: r.startDate && toDay(r.startDate),
  endDate: r.endDate && toDay(r.endDate),
});

@Injectable()
export class PricingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly properties: PropertiesService,
  ) {}

  async createRule(propertyId: string, dto: CreatePricingRuleDto) {
    await this.properties.get(propertyId);
    if (dto.startDate && dto.endDate && dto.endDate <= dto.startDate) {
      throw new BadRequestException('endDate must be after startDate');
    }
    const r = await this.prisma.pricingRule.create({
      data: {
        ...dto,
        propertyId,
        startDate: dto.startDate ? new Date(dto.startDate) : null,
        endDate: dto.endDate ? new Date(dto.endDate) : null,
      },
    });
    return view(r);
  }

  async listRules(propertyId: string) {
    await this.properties.get(propertyId);
    const rules = await this.prisma.pricingRule.findMany({
      where: { propertyId },
    });
    return rules.map(view);
  }

  async deleteRule(propertyId: string, id: string) {
    const { count } = await this.prisma.pricingRule.deleteMany({
      where: { id, propertyId },
    });
    if (!count) throw new NotFoundException('Pricing rule not found');
  }

  async quote(
    propertyId: string,
    { checkIn, checkOut, guests }: QuoteQueryDto,
  ) {
    const property = await this.properties.get(propertyId);
    if (checkOut <= checkIn) {
      throw new BadRequestException('checkOut must be after checkIn');
    }
    if (guests && guests > property.maxGuests) {
      throw new BadRequestException({
        code: 'GUESTS_EXCEEDED',
        message: `Max ${property.maxGuests} guests`,
      });
    }
    const rules = await this.prisma.pricingRule.findMany({
      where: { propertyId },
    });
    return quote(property, rules.map(view), checkIn, checkOut);
  }
}
