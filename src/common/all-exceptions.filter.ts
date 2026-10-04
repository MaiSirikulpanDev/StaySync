import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Response } from 'express';

/**
 * Postgres 23P01 (exclusion violation). Prisma has no P-code for it: it surfaces as an
 * unknown-request error naming the constraint, or as P2010 with meta.code for raw queries.
 */
export function isOverlapError(e: unknown): boolean {
  const meta = (e as { meta?: { code?: string } }).meta;
  return (
    meta?.code === '23P01' ||
    (e instanceof Error && /stay_no_overlap|23P01/.test(e.message))
  );
}

const conflict = (code: string, message: string) => ({
  statusCode: 409,
  code,
  message,
});

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(e: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    if (isOverlapError(e)) {
      return res
        .status(409)
        .json(conflict('DATES_UNAVAILABLE', 'Dates are not available'));
    }
    // 23505 on (source, externalId); inbound sync (M4/M5) will handle this itself to stay idempotent.
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === 'P2002'
    ) {
      return res
        .status(409)
        .json(conflict('ALREADY_EXISTS', 'Resource already exists'));
    }
    if (!(e instanceof HttpException)) {
      this.logger.error(e);
      return res.status(500).json({
        statusCode: 500,
        code: 'INTERNAL_ERROR',
        message: 'Internal server error',
      });
    }
    const statusCode = e.getStatus();
    const r = e.getResponse();
    const o = typeof r === 'object' ? (r as Record<string, unknown>) : {};
    const details = Array.isArray(o.message) ? o.message : o.details;
    const message = Array.isArray(o.message)
      ? 'Validation failed'
      : typeof r === 'string'
        ? r
        : String(o.message);
    res.status(statusCode).json({
      statusCode,
      code: (o.code as string) ?? HttpStatus[statusCode] ?? 'ERROR',
      message,
      ...(details ? { details } : {}),
    });
  }
}
