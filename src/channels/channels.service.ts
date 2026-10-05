import { Injectable, NotFoundException } from '@nestjs/common';
import { ChannelType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PropertiesService } from '../properties/properties.service';
import { CreateChannelDto } from './channel.dto';

@Injectable()
export class ChannelsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly properties: PropertiesService,
  ) {}

  /** A duplicate OTA listing hits the unique index and becomes 409 in the exception filter. */
  async create(propertyId: string, dto: CreateChannelDto) {
    await this.properties.get(propertyId);
    const config =
      dto.type === ChannelType.ICAL
        ? { url: dto.url }
        : { listingId: dto.listingId };
    return this.prisma.channel.create({
      data: { propertyId, type: dto.type, config },
    });
  }

  async list(propertyId: string) {
    await this.properties.get(propertyId);
    return this.prisma.channel.findMany({
      where: { propertyId },
      orderBy: { id: 'asc' },
    });
  }

  async delete(propertyId: string, id: string) {
    const { count } = await this.prisma.channel.deleteMany({
      where: { id, propertyId },
    });
    if (!count) throw new NotFoundException('Channel not found');
  }
}
