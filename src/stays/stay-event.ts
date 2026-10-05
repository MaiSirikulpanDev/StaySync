import { Stay } from '@prisma/client';
import { toDay } from '../common/dates';

/** Payload of stay.created / stay.cancelled outbox events. */
export const eventPayload = (s: Stay) => ({
  stayId: s.id,
  propertyId: s.propertyId,
  source: s.source,
  kind: s.kind,
  checkIn: toDay(s.checkIn),
  checkOut: toDay(s.checkOut),
});
