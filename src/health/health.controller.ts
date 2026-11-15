import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  HealthCheck,
  HealthCheckService,
  HealthIndicatorService,
} from '@nestjs/terminus';
import { Public } from '../common/public.decorator';
import { OCCUPANCY_GROUP } from '../occupancy/occupancy.projection';
import {
  AGENT_GROUP,
  GUEST_STREAM,
  MessagingService,
  OTA_GROUP,
} from '../messaging/messaging.service';
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
    return this.health.check([
      () => this.database(),
      () => this.kafka(),
      () => this.consumerLag(),
      () => this.dlq(),
    ]);
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

  // Informational: lag and DLQ depth never turn the status red, they are for whoever reads /health.
  private async consumerLag() {
    const i = this.indicator.check('consumerLag');
    try {
      const groups = [OTA_GROUP, OCCUPANCY_GROUP];
      const lags = await Promise.all([
        ...groups.map((g) => this.messaging.lag(g)),
        // Without the optional agent process this only grows: it is not a fault of api or worker.
        this.messaging.lag(AGENT_GROUP, GUEST_STREAM),
      ]);
      return i.up(
        Object.fromEntries(
          [...groups, AGENT_GROUP].map((g, n) => [g, lags[n]]),
        ),
      );
    } catch (e) {
      return i.down({ message: (e as Error).message });
    }
  }

  private async dlq() {
    const i = this.indicator.check('dlq');
    try {
      const [depth, guestMessages] = await Promise.all([
        this.messaging.dlqDepth(),
        this.messaging.dlqDepth(GUEST_STREAM),
      ]);
      return i.up({ depth, guestMessages });
    } catch (e) {
      return i.down({ message: (e as Error).message });
    }
  }
}
