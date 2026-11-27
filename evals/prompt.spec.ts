import { readFileSync } from 'node:fs';

// agents/adk is its own ESM package, so jest cannot import it; the prompt is compared as text.
const promptIn = (file: string) => {
  const m = /`(You are the guest-inbox[\s\S]*?)`/.exec(
    readFileSync(file, 'utf8'),
  );
  if (!m) throw new Error(`no task prompt found in ${file}`);
  return m[1];
};

describe('the two agents', () => {
  it('get the same task prompt, so the comparison is about the model and the framework', () => {
    const claude = promptIn('src/agent/run-agent.ts');
    const adk = promptIn('agents/adk/src/prompt.ts');
    expect(claude).toContain('guest-inbox assistant');
    expect(claude).toContain('${today}');
    expect(adk).toBe(claude);
  });
});
