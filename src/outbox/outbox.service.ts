import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

@Injectable()
export class OutboxService {
  /** Call inside the same transaction as the change it describes. */
  add(
    tx: Prisma.TransactionClient,
    type: string,
    payload: Prisma.InputJsonValue,
  ) {
    return tx.outboxEvent.create({ data: { type, payload } });
  }
}
