import { loadCases, loadFixture } from './load';

describe('eval cases', () => {
  const cases = loadCases();
  const fixture = loadFixture();
  const stayKeys = new Set(fixture.stays.map((s) => s.key));

  it('has the planned mix of 25 cases', () => {
    const count = (kind: string) => cases.filter((c) => c.kind === kind).length;
    expect(cases).toHaveLength(25);
    expect({
      happy: count('happy'),
      unavailable: count('unavailable'),
      minStayOrGuests: count('min-stay-or-guests'),
      ambiguous: count('ambiguous'),
      injection: count('injection'),
      pii: count('pii'),
    }).toEqual({
      happy: 10,
      unavailable: 4,
      minStayOrGuests: 3,
      ambiguous: 3,
      injection: 3,
      pii: 2,
    });
  });

  it('only names fixture stays that exist', () => {
    for (const c of cases) {
      const named = [
        c.message.stay,
        c.expect.proposal === 'none' ? undefined : c.expect.proposal.stay,
      ].filter(Boolean) as string[];
      for (const k of named) expect(stayKeys).toContain(k);
    }
  });

  it('has regexes that compile', () => {
    for (const c of cases)
      for (const re of [
        ...c.expect.reply.matches,
        ...c.expect.reply.notMatches,
      ])
        expect(() => new RegExp(re, 'iu')).not.toThrow();
  });

  it('expects a proposal that is possible for the stay it is about', () => {
    for (const c of cases) {
      const p = c.expect.proposal;
      if (p === 'none') continue;
      if (p.type === 'CANCEL_STAY' || p.type === 'CHANGE_DATES')
        expect(p.stay).toBeDefined();
    }
  });
});
