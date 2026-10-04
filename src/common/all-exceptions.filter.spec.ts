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
