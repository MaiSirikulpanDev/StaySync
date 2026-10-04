// Pure pricing. Dates are 'YYYY-MM-DD' strings: nights are calendar dates, so no timezones.
export interface PricingRule {
  id: string;
  type: 'SEASONAL' | 'WEEKEND';
  startDate: string | null;
  endDate: string | null; // exclusive
  rateCents: number | null;
  adjustPercent: number | null;
  minStay: number | null;
  priority: number;
}

export interface PropertyPricing {
  baseRateCents: number;
  minStay: number;
  currency: string;
}

export interface Night {
  date: string;
  rateCents: number;
  ruleIds: string[];
}

export interface Quote {
  nights: Night[];
  totalCents: number;
  currency: string;
  minStay: number;
  meetsMinStay: boolean;
}

const DAY_MS = 86_400_000;

function nightsBetween(checkIn: string, checkOut: string): string[] {
  const out: string[] = [];
  for (let t = Date.parse(checkIn); t < Date.parse(checkOut); t += DAY_MS) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

const covers = (r: PricingRule, date: string) =>
  r.startDate !== null &&
  r.endDate !== null &&
  date >= r.startDate &&
  date < r.endDate;

const byPriorityDesc = (a: PricingRule, b: PricingRule) =>
  b.priority - a.priority;

export function quote(
  property: PropertyPricing,
  rules: PricingRule[],
  checkIn: string,
  checkOut: string,
): Quote {
  const seasonal = rules
    .filter((r) => r.type === 'SEASONAL')
    .sort(byPriorityDesc);
  const weekend = rules
    .filter((r) => r.type === 'WEEKEND' && r.adjustPercent !== null)
    .sort(byPriorityDesc)[0];

  const nights = nightsBetween(checkIn, checkOut).map((date): Night => {
    let rateCents = property.baseRateCents;
    const ruleIds: string[] = [];
    const season = seasonal.find(
      (r) => r.rateCents !== null && covers(r, date),
    );
    if (season) {
      rateCents = season.rateCents!;
      ruleIds.push(season.id);
    }
    const day = new Date(date).getUTCDay();
    if (weekend && (day === 5 || day === 6)) {
      rateCents = Math.round(
        (rateCents * (100 + weekend.adjustPercent!)) / 100,
      );
      ruleIds.push(weekend.id);
    }
    return { date, rateCents, ruleIds };
  });

  const seasonMinStays = seasonal
    .filter((r) => r.minStay !== null && covers(r, checkIn))
    .map((r) => r.minStay!);
  const minStay = seasonMinStays.length
    ? Math.max(...seasonMinStays)
    : property.minStay;
  return {
    nights,
    totalCents: nights.reduce((sum, n) => sum + n.rateCents, 0),
    currency: property.currency,
    minStay,
    meetsMinStay: nights.length >= minStay,
  };
}
