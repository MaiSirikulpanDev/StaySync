# 5. M5 deviations from PLAN.md

Status: accepted

- **Overlap conflicts are detected by the database, not by the pure diff.** PLAN §7.3 lists "conflict" among the
  diff unit tests. Deciding an overlap in code would duplicate the `stay_no_overlap` constraint, which is the real
  guard (ADR 0001). `diffStays` returns create/update/cancel; each change runs in its own transaction and an
  exclusion violation becomes a `SyncIssue{CONFLICT}`. The e2e suite covers conflicts.
- **`externalId` of imported stays is `<channelId>:<uid>`.** `Stay` has no channel column, and two ICAL channels on one
  property must not cancel each other's events when a UID is missing from the other feed.
- **One open `SyncIssue` per problem.** A feed that stays broken would otherwise add a row on every 15-minute poll.
- **`cron` added as a direct dependency.** `@nestjs/schedule` needs it, and `ICAL_POLL_CRON` is read from config at
  runtime, which the `@Cron()` decorator cannot do.
- **All-day dates are read with local getters.** `node-ical` returns them as local midnight; `toISOString()` shifts
  the day in timezones ahead of UTC. A unit test runs the parser in four timezones.
- **Known ceilings (marked `ponytail:` in code):** timed events use their UTC date rather than the listing's timezone,
  recurring events (RRULE) are not expanded, and the sync lock is per process.
- **Echo:** the export includes imported ICAL blocks (PLAN: "one VEVENT per CONFIRMED stay"), so a channel can see
  its own events again as external blocks. Harmless double-blocking; filter by source if it ever matters.
