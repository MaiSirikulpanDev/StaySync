import { stayEventSchema, toEnvelope } from './stay-events';

const id = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
const payload = {
  stayId: id(1),
  propertyId: id(2),
  source: 'DIRECT',
  kind: 'BOOKING',
  checkIn: '2026-10-05',
  checkOut: '2026-10-08',
};
const row = {
  id: id(3),
  type: 'stay.created',
  payload,
  createdAt: new Date('2026-10-05T01:02:03.000Z'),
};

describe('toEnvelope', () => {
  it('wraps an outbox row, keeping its id as eventId and the property as key', () => {
    expect(toEnvelope(row)).toEqual({
      eventId: id(3),
      type: 'stay.created',
      version: 1,
      propertyId: id(2),
      occurredAt: '2026-10-05T01:02:03.000Z',
      payload,
    });
  });

  it('rejects an unknown type or a payload missing fields', () => {
    expect(() => toEnvelope({ ...row, type: 'stay.exploded' })).toThrow();
    expect(() => toEnvelope({ ...row, payload: {} })).toThrow();
  });
});

describe('stayEventSchema', () => {
  const valid = toEnvelope(row);

  it('accepts all three event types', () => {
    for (const type of ['stay.created', 'stay.cancelled', 'stay.updated'])
      expect(stayEventSchema.safeParse({ ...valid, type }).success).toBe(true);
  });

  it('rejects an unknown version', () => {
    expect(stayEventSchema.safeParse({ ...valid, version: 2 }).success).toBe(
      false,
    );
  });
});
