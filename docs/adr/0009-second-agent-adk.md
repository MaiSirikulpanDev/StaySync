# 9. A second agent on Google ADK, behind the same server

Status: draft (Phase 3, M17). The first two sections are decisions and what building the agent showed. The third lists what only real runs can answer; it is empty on purpose until they are done.

## Decision

The second agent is built with Google's Agent Development Kit (`@google/adk`) and Gemini, against **the same MCP server, the same prompt, the same cases and the same graders** as the Claude agent. That keeps the comparison about the model and the framework, and it shows the guardrails (ADR 0008) hold for a framework they were not written for: the server, not the agent, decides what can change.

- It lives in `agents/adk` with its own `package.json`. The plan gave the reason as "ADK needs zod 3", which is **no longer true**: `@google/adk` 2.5 depends on zod 4, like the app. The separation stays for the other reasons: `api`, `worker` and the Claude agent never load a Google SDK, and the app image does not carry its dependency tree.
- Only the eval runner calls it, as a child process (`evals/adapters/adk.ts`): input as JSON on stdin, result as the last stdout line. ADK logs to stdout too, so the runner reads the last line that parses as a result. It is not wired to Kafka: a second production path would add nothing to a comparison that needs the same inputs and graders.
- The adapter speaks the same `RunAgent` interface as the Claude agent, so the runner, the graders and the report do not know which agent ran.
- The prompt is copied, not shared, because the two packages cannot import each other; `evals/prompt.spec.ts` fails if the copies differ.

## What building it showed

- **Tools.** ADK has no built-in tools unless they are added, so the allow-list is the `MCPToolset` name filter and nothing else. The Claude agent needs `tools: []` plus `allowedTools` plus `dontAsk`. A test checks that a tool outside the list is never offered to the model.
- **Connection.** `MCPToolset` takes request headers through `transportOptions.requestInit.headers`; its older `header` field is deprecated and ignored when `transportOptions` is set. The run id and the StaySync key go there.
- **No trace context.** The Claude agent hands its trace context to the MCP connection (M16); the ADK agent runs in its own process without tracing, so its tool calls appear as server-side spans only.
- **Cost.** The free tier is not billed, so the agent records 0 cost, and the table must say so. Tokens are recorded; thinking tokens count as output, because they are billed as output.
- **Abort.** On a timeout the first version reported a failed run, not a timed-out one: ADK did not throw, so the abort did not reach the `catch`. The run now checks the abort signal on every exit path (error event, end of the stream without a final answer, exception). I did not find out which of the first two it was.
- **Module format.** `@google/adk` is ESM-first, so `agents/adk` is an ESM package built with `tsc` and run with `node`, with no ts-node.
- **Rate limits.** The free tier's limits are low and change, so the runner has `--pause`; a run that hits a limit is recorded as a failed run, not retried.

## Still to learn from real runs

To fill in after the first run of each agent on the 25 cases: pass rate and pass^3, cost and latency per run, how the tool-call behaviour differs (number of calls, calls to tools that do not exist, malformed arguments), the failure modes (what each does with the injection cases, how each fails on rate limits or timeouts), and how the developer experience compared. None of that is written here, because none of it has been measured.
