import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(e: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
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
