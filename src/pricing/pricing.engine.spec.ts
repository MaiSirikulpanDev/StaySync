import { PricingRule, quote } from './pricing.engine';

const property = { baseRateCents: 10000, minStay: 1, currency: 'AUD' };

const seasonal = (o: Partial<PricingRule> & { id: string }): PricingRule => ({
  type: 'SEASONAL',
  startDate: '2026-12-20',
  endDate: '2027-01-05',
  rateCents: 20000,
  adjustPercent: null,
  minStay: null,
  priority: 0,
  ...o,
});
const weekend = (o: Partial<PricingRule> & { id: string }): PricingRule => ({
  type: 'WEEKEND',
  startDate: null,
  endDate: null,
  rateCents: null,
  adjustPercent: 20,
  minStay: null,
  priority: 0,
  ...o,
});

// 2026-10-05 is a Monday; Fri = 10-09, Sat = 10-10
describe('pricing engine', () => {
  it('charges the base rate for every night with no rules', () => {
    const q = quote(property, [], '2026-10-05', '2026-10-08');
    expect(q.nights.map((n) => n.rateCents)).toEqual([10000, 10000, 10000]);
    expect(q.totalCents).toBe(30000);
    expect(q.currency).toBe('AUD');
  });

  it('prices a 1-night stay and treats checkout as exclusive', () => {
    const q = quote(property, [], '2026-10-05', '2026-10-06');
    expect(q.nights).toEqual([
      { date: '2026-10-05', rateCents: 10000, ruleIds: [] },
    ]);
  });

  it('replaces the base rate inside a seasonal window, end date exclusive', () => {
    const q = quote(
      property,
      [seasonal({ id: 's', endDate: '2026-12-22' })],
      '2026-12-20',
      '2026-12-23',
    );
    expect(q.nights.map((n) => n.rateCents)).toEqual([20000, 20000, 10000]);
    expect(q.nights[0].ruleIds).toEqual(['s']);
  });

  it('lets the highest priority win when seasonal rules overlap', () => {
    const rules = [
      seasonal({ id: 'lo', rateCents: 15000, priority: 1 }),
      seasonal({ id: 'hi', rateCents: 30000, priority: 5 }),
    ];
    const q = quote(property, rules, '2026-12-21', '2026-12-22');
    expect(q.nights[0]).toMatchObject({ rateCents: 30000, ruleIds: ['hi'] });
  });

  it('adds the weekend percentage on Friday and Saturday nights only', () => {
    const q = quote(
      property,
      [weekend({ id: 'w' })],
      '2026-10-08',
      '2026-10-12',
    );
    expect(q.nights.map((n) => n.rateCents)).toEqual([
      10000, 12000, 12000, 10000,
    ]);
    expect(q.nights[1].ruleIds).toEqual(['w']);
  });

  it('applies the weekend uplift on top of a seasonal rate', () => {
    const q = quote(
      property,
      [
        seasonal({ id: 's', startDate: '2026-10-01', endDate: '2026-11-01' }),
        weekend({ id: 'w' }),
      ],
      '2026-10-09',
      '2026-10-10',
    );
    expect(q.nights[0]).toEqual({
      date: '2026-10-09',
      rateCents: 24000,
      ruleIds: ['s', 'w'],
    });
  });

  it('uses the highest priority weekend rule', () => {
    const rules = [
      weekend({ id: 'a', adjustPercent: 10 }),
      weekend({ id: 'b', adjustPercent: 50, priority: 2 }),
    ];
    expect(
      quote(property, rules, '2026-10-09', '2026-10-10').nights[0].rateCents,
    ).toBe(15000);
  });

  it('supports negative weekend adjustments', () => {
    const q = quote(
      property,
      [weekend({ id: 'w', adjustPercent: -10 })],
      '2026-10-09',
      '2026-10-10',
    );
    expect(q.nights[0].rateCents).toBe(9000);
  });

  it('rounds to whole cents', () => {
    const p = { ...property, baseRateCents: 9999 };
    const q = quote(
      p,
      [weekend({ id: 'w', adjustPercent: 15 })],
      '2026-10-09',
      '2026-10-10',
    );
    expect(q.nights[0].rateCents).toBe(11499); // 11498.85
  });

  it('ignores seasonal rules that do not cover the night', () => {
    const q = quote(
      property,
      [seasonal({ id: 's' })],
      '2026-10-05',
      '2026-10-06',
    );
    expect(q.nights[0].ruleIds).toEqual([]);
  });

  it('ignores a rule with a null rate or percent', () => {
    const rules = [
      seasonal({
        id: 's',
        rateCents: null,
        startDate: '2026-10-01',
        endDate: '2026-11-01',
      }),
      weekend({ id: 'w', adjustPercent: null }),
    ];
    const q = quote(property, rules, '2026-10-09', '2026-10-10');
    expect(q.nights[0]).toEqual({
      date: '2026-10-09',
      rateCents: 10000,
      ruleIds: [],
    });
  });

  describe('minStay', () => {
    it('defaults to the property minStay', () => {
      const q = quote(
        { ...property, minStay: 2 },
        [],
        '2026-10-05',
        '2026-10-06',
      );
      expect(q).toMatchObject({ minStay: 2, meetsMinStay: false });
      expect(
        quote({ ...property, minStay: 2 }, [], '2026-10-05', '2026-10-07')
          .meetsMinStay,
      ).toBe(true);
    });

    it('is overridden by the highest seasonal minStay covering check-in', () => {
      const rules = [
        seasonal({ id: 'a', minStay: 3 }),
        seasonal({ id: 'b', minStay: 5 }),
      ];
      const q = quote(property, rules, '2026-12-21', '2026-12-24');
      expect(q).toMatchObject({ minStay: 5, meetsMinStay: false });
    });

    it('ignores seasonal minStay when check-in is outside the window or minStay is null', () => {
      const rules = [
        seasonal({ id: 'a', minStay: 5 }),
        seasonal({ id: 'b', minStay: null }),
      ];
      expect(quote(property, rules, '2026-10-05', '2026-10-06').minStay).toBe(
        1,
      );
      expect(quote(property, rules, '2026-12-21', '2026-12-22').minStay).toBe(
        5,
      );
    });
  });
});

it('ignores seasonal rules without dates', () => {
  const r = seasonal({ id: 's', startDate: null, endDate: null, minStay: 9 });
  const q = quote(property, [r], '2026-10-05', '2026-10-06');
  expect(q).toMatchObject({ minStay: 1 });
  expect(q.nights[0].ruleIds).toEqual([]);
});
