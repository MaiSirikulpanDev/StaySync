import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { timingSafeEqual } from 'node:crypto';
import type { Env } from '../config/env.schema';
import { IS_PUBLIC } from './public.decorator';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly config: ConfigService<Env, true>,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    if (
      this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
        context.getHandler(),
        context.getClass(),
      ])
    ) {
      return true;
    }
    const given = context.switchToHttp().getRequest<Request>().headers[
      'x-api-key'
    ];
    const expected = Buffer.from(this.config.get('API_KEY'));
    const got = Buffer.from(typeof given === 'string' ? given : '');
    if (got.length !== expected.length || !timingSafeEqual(got, expected)) {
      throw new UnauthorizedException('Invalid or missing API key');
    }
    return true;
  }
}
