import { Prisma } from '@prisma/client';
import {
  ArgumentsHost,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { AllExceptionsFilter } from './all-exceptions.filter';

const run = (e: unknown) => {
  let status = 0;
  let body: unknown;
  const res = {
    status: (s: number) => ((status = s), { json: (b: unknown) => (body = b) }),
  };
  const host = {
    switchToHttp: () => ({ getResponse: () => res }),
  } as unknown as ArgumentsHost;
  new AllExceptionsFilter().catch(e, host);
  return { status, body };
};

describe('AllExceptionsFilter', () => {
  it('formats HttpException as { statusCode, code, message }', () => {
    expect(run(new NotFoundException('gone'))).toEqual({
      status: 404,
      body: { statusCode: 404, code: 'NOT_FOUND', message: 'gone' },
    });
  });

  it('puts validation messages in details', () => {
    const { status, body } = run(new BadRequestException(['a bad', 'b bad']));
    expect(status).toBe(400);
    expect(body).toMatchObject({
      code: 'BAD_REQUEST',
      details: ['a bad', 'b bad'],
    });
  });

  it('hides unknown errors behind a 500', () => {
    expect(run(new Error('db password leaked'))).toEqual({
      status: 500,
      body: {
        statusCode: 500,
        code: 'INTERNAL_ERROR',
        message: 'Internal server error',
      },
    });
  });
});

describe('AllExceptionsFilter database errors', () => {
  const clientVersion = 'test';

  it('maps an exclusion violation (23P01) to 409 DATES_UNAVAILABLE', () => {
    const e = new Prisma.PrismaClientUnknownRequestError(
      'conflicting key value violates exclusion constraint "stay_no_overlap"',
      { clientVersion },
    );
    expect(run(e)).toEqual({
      status: 409,
      body: {
        statusCode: 409,
        code: 'DATES_UNAVAILABLE',
        message: 'Dates are not available',
      },
    });
  });

  it('recognises the violation when surfaced as a raw-query error carrying the pg code', () => {
    const e = new Prisma.PrismaClientKnownRequestError('Raw query failed', {
      code: 'P2010',
      clientVersion,
      meta: { code: '23P01' },
    });
    expect(run(e).status).toBe(409);
  });

  it('maps a unique violation (P2002) to 409 ALREADY_EXISTS', () => {
    const e = new Prisma.PrismaClientKnownRequestError(
      'Unique constraint failed',
      {
        code: 'P2002',
        clientVersion,
      },
    );
    expect(run(e)).toMatchObject({
      status: 409,
      body: { code: 'ALREADY_EXISTS' },
    });
  });

  it('does not mistake other database errors for overlaps', () => {
    const e = new Prisma.PrismaClientUnknownRequestError('connection reset', {
      clientVersion,
    });
    expect(run(e).status).toBe(500);
  });
});
