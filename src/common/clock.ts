import { Injectable } from '@nestjs/common';

/** Injectable "today" so tests can pin the date. */
@Injectable()
export class Clock {
  today(): string {
    return new Date().toISOString().slice(0, 10);
  }
}
