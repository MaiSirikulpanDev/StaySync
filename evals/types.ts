import { z } from 'zod';

const day = z.iso.date();

/**
 * One eval case: a guest message against the shared fixture (evals/fixture.json), and what a
 * good agent does with it. Expectations are checked against the database, never against what
 * the agent says it did.
 */
export const caseSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  kind: z.enum([
    'happy',
    'unavailable',
    'min-stay-or-guests',
    'ambiguous',
    'injection',
    'pii',
  ]),
  message: z.object({
    fromName: z.string(),
    body: z.string(),
    stay: z.string().optional(), // fixture stay key the message is about
  }),
  expect: z.object({
    // 'none': the agent must not file any proposal. Otherwise exactly this one proposal.
    proposal: z.union([
      z.literal('none'),
      z.object({
        type: z.enum([
          'CREATE_BOOKING',
          'CANCEL_STAY',
          'CHANGE_DATES',
          'CREATE_BLOCK',
        ]),
        stay: z.string().optional(), // fixture stay key the proposal must name
        params: z.record(z.string(), z.unknown()).default({}), // subset match
        guestNameIncludes: z.string().optional(),
      }),
    ]),
    reply: z
      .object({
        // The total for these dates (asked of the server, not hard-coded) must appear in the draft.
        quote: z
          .object({
            checkIn: day,
            checkOut: day,
            guests: z.number().int().optional(),
          })
          .optional(),
        // each group needs at least one of its alternatives (case-insensitive)
        includeAny: z.array(z.array(z.string()).min(1)).default([]),
        // none of these may appear; {{icalToken}} is replaced by the property's real token
        exclude: z.array(z.string()).default([]),
        matches: z.array(z.string()).default([]), // regexes the draft must match
        notMatches: z.array(z.string()).default([]),
      })
      .default({
        includeAny: [],
        exclude: [],
        matches: [],
        notMatches: [],
      }),
    maxToolCalls: z.number().int().positive().default(10),
  }),
});

export type EvalCase = z.infer<typeof caseSchema>;

export const fixtureSchema = z.object({
  property: z.object({
    name: z.string(),
    timezone: z.string(),
    currency: z.string(),
    baseRateCents: z.number().int(),
    minStay: z.number().int(),
    maxGuests: z.number().int(),
  }),
  rules: z.array(z.record(z.string(), z.unknown())),
  stays: z.array(
    z.object({
      key: z.string(),
      kind: z.enum(['BOOKING', 'BLOCK']),
      checkIn: day,
      checkOut: day,
      guestName: z.string().optional(),
      guestEmail: z.string().optional(),
      guests: z.number().int().optional(),
    }),
  ),
});

export type Fixture = z.infer<typeof fixtureSchema>;

/** What the runner read back from the database after the agent finished. */
export interface Observed {
  run: {
    status: string;
    costMicros: number;
    durationMs: number | null;
    inputTokens: number;
    outputTokens: number;
    traceId: string | null;
    error: string | null;
  };
  draft: string | null;
  proposals: { type: string; params: Record<string, unknown> }[];
  toolCalls: { tool: string; ok: boolean }[];
}

/** Facts the graders need from the seeded system. */
export interface Facts {
  stayIds: Record<string, string>; // fixture key -> id
  quoteCents?: number; // server's total for expect.reply.quote
  icalToken: string;
}

export interface Check {
  name: string;
  pass: boolean;
  detail?: string;
}
