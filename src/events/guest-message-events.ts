import { z } from 'zod';

/** Same envelope rules as stay-events.ts. The message text stays in the DB; the event only points at it. */
export const guestMessageEventSchema = z.object({
  eventId: z.uuid(),
  type: z.literal('guest_message.received'),
  version: z.literal(1),
  propertyId: z.uuid(),
  occurredAt: z.iso.datetime(),
  payload: z.object({ guestMessageId: z.uuid(), propertyId: z.uuid() }),
});

export type GuestMessageEvent = z.infer<typeof guestMessageEventSchema>;

export const GUEST_MESSAGE_EVENT = 'guest_message.received';

/** Builds the envelope from an outbox row and validates it; throws on a bad payload. */
export const toGuestEnvelope = (row: {
  id: string;
  type: string;
  payload: unknown;
  createdAt: Date;
}): GuestMessageEvent =>
  guestMessageEventSchema.parse({
    eventId: row.id,
    type: row.type,
    version: 1,
    propertyId: (row.payload as { propertyId?: string } | null)?.propertyId,
    occurredAt: row.createdAt.toISOString(),
    payload: row.payload,
  });
