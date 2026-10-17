import { z } from 'zod';

/** Producer and consumers import this one file, so the wire format cannot drift. */
const payload = z.object({
  stayId: z.uuid(),
  propertyId: z.uuid(),
  source: z.enum(['DIRECT', 'ICAL', 'MOCK_OTA']),
  kind: z.enum(['BOOKING', 'BLOCK']),
  checkIn: z.iso.date(),
  checkOut: z.iso.date(),
});

const envelope = <T extends string>(type: T) =>
  z.object({
    eventId: z.uuid(), // the outbox row id: a re-published event keeps it, consumers dedupe on it
    type: z.literal(type),
    version: z.literal(1), // a new version gets its own schema; unknown ones fail here and go to the DLQ
    propertyId: z.uuid(),
    occurredAt: z.iso.datetime(),
    payload,
  });

export const stayEventSchema = z.discriminatedUnion('type', [
  envelope('stay.created'),
  envelope('stay.cancelled'),
  envelope('stay.updated'),
]);

export type StayEvent = z.infer<typeof stayEventSchema>;

/** Builds the envelope from an outbox row and validates it; throws on a bad payload. */
export const toEnvelope = (row: {
  id: string;
  type: string;
  payload: unknown;
  createdAt: Date;
}): StayEvent =>
  stayEventSchema.parse({
    eventId: row.id,
    type: row.type,
    version: 1,
    propertyId: (row.payload as { propertyId?: string } | null)?.propertyId,
    occurredAt: row.createdAt.toISOString(),
    payload: row.payload,
  });
