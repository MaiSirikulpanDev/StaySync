import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiKeyGuard } from './api-key.guard';
import { IS_PUBLIC } from './public.decorator';

const ctx = (headers: Record<string, string>) =>
  ({
    getHandler: () => 'h',
    getClass: () => 'c',
    switchToHttp: () => ({ getRequest: () => ({ headers }) }),
  }) as unknown as ExecutionContext;

const make = (isPublic = false) => {
  const reflector = {
    getAllAndOverride: (k: string) => (k === IS_PUBLIC ? isPublic : undefined),
  } as unknown as Reflector;
  return new ApiKeyGuard(reflector, { get: () => 'secret' } as never);
};

describe('ApiKeyGuard', () => {
  it('allows a request with the right key', () => {
    expect(make().canActivate(ctx({ 'x-api-key': 'secret' }))).toBe(true);
  });

  it('rejects a missing key', () => {
    expect(() => make().canActivate(ctx({}))).toThrow(UnauthorizedException);
  });

  it('rejects a wrong key, including one of different length', () => {
    expect(() => make().canActivate(ctx({ 'x-api-key': 'nope' }))).toThrow(
      UnauthorizedException,
    );
    expect(() => make().canActivate(ctx({ 'x-api-key': 'secreT' }))).toThrow(
      UnauthorizedException,
    );
  });

  it('skips public routes', () => {
    expect(make(true).canActivate(ctx({}))).toBe(true);
  });
});
