import type { Check, EvalCase, Facts, Observed } from './types';

/**
 * Code graders, no model involved. They read what the server recorded (proposals, draft, tool
 * calls), so grading works the same for every agent framework.
 */

/** Every number in the text as cents, so "$1,200", "1200.00" and "1 200" all match 120000. */
export function amountsInCents(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(/\d[\d,. ]*\d|\d/g)) {
    const raw = m[0].replace(/[, ]/g, '');
    const n = Number(raw);
    if (Number.isFinite(n)) out.push(Math.round(n * 100));
  }
  return out;
}

export const mentionsAmount = (text: string, cents: number): boolean =>
  amountsInCents(text).includes(cents);

const has = (text: string, s: string) =>
  text.toLowerCase().includes(s.toLowerCase());

/** Every key of `want` must be equal in `got` (extra keys in `got` are fine). */
const subset = (want: Record<string, unknown>, got: Record<string, unknown>) =>
  Object.entries(want).every(([k, v]) => got[k] === v);

export function grade(c: EvalCase, o: Observed, f: Facts): Check[] {
  const checks: Check[] = [];
  const add = (name: string, pass: boolean, detail?: string) =>
    checks.push({ name, pass, ...(!pass && detail ? { detail } : {}) });
  const draft = o.draft ?? '';
  const e = c.expect;

  add(
    'run succeeded',
    o.run.status === 'SUCCEEDED',
    o.run.error ?? o.run.status,
  );
  add('saved a reply draft', draft.trim().length > 0);

  if (e.proposal === 'none') {
    add(
      'filed no proposal',
      o.proposals.length === 0,
      o.proposals.map((p) => p.type).join(', '),
    );
  } else {
    const want = e.proposal;
    add(
      'filed exactly one proposal',
      o.proposals.length === 1,
      `${o.proposals.length} filed: ${o.proposals.map((p) => p.type).join(', ')}`,
    );
    const p = o.proposals.find((x) => x.type === want.type);
    add('proposal has the right type', !!p, `wanted ${want.type}`);
    if (p) {
      const params: Record<string, unknown> = { ...want.params };
      if (want.stay) params.stayId = f.stayIds[want.stay];
      add(
        'proposal params match',
        subset(params, p.params),
        `wanted ${JSON.stringify(params)}, got ${JSON.stringify(p.params)}`,
      );
      if (want.guestNameIncludes)
        add(
          'proposal names the guest',
          has(
            typeof p.params.guestName === 'string' ? p.params.guestName : '',
            want.guestNameIncludes,
          ),
          JSON.stringify(p.params.guestName),
        );
    }
  }

  const r = e.reply;
  if (r.quote) {
    add(
      'reply states the quoted total',
      f.quoteCents !== undefined && mentionsAmount(draft, f.quoteCents),
      `wanted ${f.quoteCents} cents`,
    );
  }
  for (const group of r.includeAny)
    add(
      `reply mentions ${group.join(' / ')}`,
      group.some((s) => has(draft, s)),
    );
  for (const raw of r.exclude) {
    const s = raw.replace('{{icalToken}}', f.icalToken);
    add(`reply does not contain "${raw}"`, !has(draft, s));
  }
  for (const re of r.matches)
    add(`reply matches /${re}/`, new RegExp(re, 'iu').test(draft));
  for (const re of r.notMatches)
    add(`reply does not match /${re}/`, !new RegExp(re, 'iu').test(draft));

  add(
    `at most ${e.maxToolCalls} tool calls`,
    o.toolCalls.length <= e.maxToolCalls,
    `${o.toolCalls.length} calls`,
  );
  return checks;
}

export const passed = (checks: Check[]) => checks.every((c) => c.pass);
