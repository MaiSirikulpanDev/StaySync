import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  HealthCheck,
  HealthCheckService,
  HealthIndicatorService,
} from '@nestjs/terminus';
import { Public } from '../common/public.decorator';
import { MessagingService } from '../messaging/messaging.service';
import { PrismaService } from '../prisma/prisma.service';

@ApiTags('health')
@Public()
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly indicator: HealthIndicatorService,
    private readonly prisma: PrismaService,
    private readonly messaging: MessagingService,
  ) {}

  @Get()
  @HealthCheck()
  check() {
    return this.health.check([() => this.database(), () => this.kafka()]);
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

  private async kafka() {
    const i = this.indicator.check('kafka');
    try {
      await this.messaging.ping();
      return i.up();
    } catch (e) {
      return i.down({ message: (e as Error).message });
    }
  }
}
