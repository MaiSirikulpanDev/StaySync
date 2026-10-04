import { Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePropertyDto, UpdatePropertyDto } from './property.dto';

@Injectable()
export class PropertiesService {
  constructor(private readonly prisma: PrismaService) {}

  create(dto: CreatePropertyDto) {
    return this.prisma.property.create({
      data: { ...dto, icalToken: randomBytes(24).toString('hex') },
    });
  }

  list() {
    return this.prisma.property.findMany({ orderBy: { createdAt: 'asc' } });
  }

  async get(id: string) {
    const p = await this.prisma.property.findUnique({ where: { id } });
    if (!p) throw new NotFoundException('Property not found');
    return p;
  }

  async update(id: string, dto: UpdatePropertyDto) {
    await this.get(id);
    return this.prisma.property.update({ where: { id }, data: dto });
  }
}
