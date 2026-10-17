import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { context, propagation, SpanKind } from '@opentelemetry/api';
import { inSpan } from '../../tracing/trace';
import type { Env } from '../../config/env.schema';

export interface AvailabilityDay {
  date: string;
  available: boolean;
  rateCents?: number;
}

@Injectable()
export class OtaClient {
  constructor(private readonly config: ConfigService<Env, true>) {}

  /** Replaces the OTA's calendar for a listing. Idempotent, so safe to retry and to duplicate. */
  async pushAvailability(listingId: string, days: AvailabilityDay[]) {
    await inSpan('ota push', SpanKind.CLIENT, context.active(), async () => {
      const headers: Record<string, string> = {
        'content-type': 'application/json',
      };
      propagation.inject(context.active(), headers);
      const res = await fetch(
        `${this.config.get('OTA_BASE_URL')}/listings/${encodeURIComponent(listingId)}/availability`,
        {
          method: 'PUT',
          headers,
          body: JSON.stringify({ days }),
          signal: AbortSignal.timeout(5000),
        },
      );
      if (!res.ok) throw new Error(`OTA push failed: HTTP ${res.status}`);
    });
  }
}
