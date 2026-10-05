import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import type { Env } from '../../config/env.schema';
import { verifySignature } from './hmac';

/** Verifies x-ota-signature = HMAC_SHA256(secret, rawBody). Needs `rawBody: true` on the app. */
@Injectable()
export class OtaWebhookGuard implements CanActivate {
  constructor(private readonly config: ConfigService<Env, true>) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<RawBodyRequest<Request>>();
    const signature = req.headers['x-ota-signature'];
    const secret = String(this.config.get('OTA_WEBHOOK_SECRET'));
    if (
      !req.rawBody ||
      typeof signature !== 'string' ||
      !verifySignature(secret, req.rawBody, signature)
    ) {
      throw new UnauthorizedException('Invalid webhook signature');
    }
    return true;
  }
}
