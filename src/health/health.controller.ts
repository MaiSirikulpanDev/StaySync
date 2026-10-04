import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiTags } from '@nestjs/swagger';
import {
  HealthCheck,
  HealthCheckService,
  HealthIndicatorService,
} from '@nestjs/terminus';
import amqp from 'amqplib';
import { Public } from '../common/public.decorator';
import type { Env } from '../config/env.schema';
import { PrismaService } from '../prisma/prisma.service';

@ApiTags('health')
@Public()
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly indicator: HealthIndicatorService,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  @Get()
  @HealthCheck()
  check() {
    return this.health.check([() => this.database(), () => this.rabbitmq()]);
  }

  private async database() {
    const i = this.indicator.check('database');
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return i.up();
    } catch (e) {
      return i.down({ message: (e as Error).message });
    }
  }

  // Connect-and-close probe; the real messaging module arrives in M3.
  private async rabbitmq() {
    const i = this.indicator.check('rabbitmq');
    try {
      const conn = await amqp.connect(this.config.get('RABBITMQ_URL'));
      await conn.close();
      return i.up();
    } catch (e) {
      return i.down({ message: (e as Error).message });
    }
  }
}
