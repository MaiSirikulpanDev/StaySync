import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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
    const res = await fetch(
      `${this.config.get('OTA_BASE_URL')}/listings/${encodeURIComponent(listingId)}/availability`,
      {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ days }),
        signal: AbortSignal.timeout(5000),
      },
    );
    if (!res.ok) throw new Error(`OTA push failed: HTTP ${res.status}`);
  }
}
