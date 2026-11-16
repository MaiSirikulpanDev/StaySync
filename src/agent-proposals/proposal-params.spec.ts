import { BadRequestException } from '@nestjs/common';
import { parseParams } from './proposal-params';

const stayId = '7b1e2f0e-0000-4000-8000-000000000000';

describe('parseParams', () => {
  it('fixes the stay kind from the proposal type, whatever the agent sends', async () => {
    const p = await parseParams('CREATE_BOOKING', {
      kind: 'BLOCK',
      checkIn: '2026-12-10',
      checkOut: '2026-12-12',
      guestName: 'Ann',
      guests: 2,
    });
    expect(p).toMatchObject({
      type: 'CREATE_BOOKING',
      dto: { kind: 'BOOKING' },
    });
  });

  it('needs a guest name and guest count for a booking, but not for a block', async () => {
    const dates = { checkIn: '2026-12-10', checkOut: '2026-12-12' };
    await expect(parseParams('CREATE_BOOKING', dates)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(parseParams('CREATE_BLOCK', dates)).resolves.toMatchObject({
      dto: { kind: 'BLOCK' },
    });
  });

  it('rejects an impossible date, as the REST API does', async () => {
    await expect(
      parseParams('CHANGE_DATES', {
        stayId,
        checkIn: '2026-02-30',
        checkOut: '2026-03-02',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects unknown params, so an agent cannot smuggle in a propertyId', async () => {
    await expect(
      parseParams('CANCEL_STAY', { stayId, propertyId: stayId }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('accepts a cancel and a date change with a stay id', async () => {
    await expect(parseParams('CANCEL_STAY', { stayId })).resolves.toEqual({
      type: 'CANCEL_STAY',
      stayId,
    });
    await expect(
      parseParams('CHANGE_DATES', {
        stayId,
        checkIn: '2026-12-10',
        checkOut: '2026-12-13',
      }),
    ).resolves.toMatchObject({ type: 'CHANGE_DATES', stayId });
  });
});
