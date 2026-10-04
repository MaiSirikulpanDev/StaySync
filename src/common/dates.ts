import { registerDecorator, ValidationOptions } from 'class-validator';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** True for a real calendar date written as YYYY-MM-DD (rejects 2026-02-30). */
export const isDateOnly = (v: unknown): v is string =>
  typeof v === 'string' &&
  DAY.test(v) &&
  new Date(v).toISOString().slice(0, 10) === v;

/** Postgres DATE column value -> 'YYYY-MM-DD'. */
export const toDay = (d: Date) => d.toISOString().slice(0, 10);

export function IsDateOnly(options?: ValidationOptions): PropertyDecorator {
  return (target, propertyName) =>
    registerDecorator({
      name: 'isDateOnly',
      target: target.constructor,
      propertyName: propertyName as string,
      options: {
        message: `${String(propertyName)} must be a valid YYYY-MM-DD date`,
        ...options,
      },
      validator: { validate: isDateOnly },
    });
}
