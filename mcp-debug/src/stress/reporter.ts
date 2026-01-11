import type { Mutation } from './schema-mutator.js';

interface Tool {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

export type StressOutcome = 'pass' | 'graceful_fail' | 'crash_or_hang';

export interface StressResult {
  tool: string;
  mutation: Mutation;
  outcome: StressOutcome;
  response?: unknown;
  error?: string;
  latencyMs: number;
}

export function generateStressReport(tools: Tool[], results: StressResult[]): string {
  const lines: string[] = [];

  lines.push('# Stress Test Report');
  lines.push('');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push('');

  // Overall summary
  const passed = results.filter((r) => r.outcome === 'pass').length;
  const graceful = results.filter((r) => r.outcome === 'graceful_fail').length;
  const crashed = results.filter((r) => r.outcome === 'crash_or_hang').length;
  const total = results.length;

  // Score: pass + graceful are "good", crash is "bad"
  const goodOutcomes = passed + graceful;
  const score = total > 0 ? Math.round((goodOutcomes / total) * 100) : 0;

  lines.push('## Summary');
  lines.push('');
  lines.push(`- **Total mutations tested:** ${total}`);
  lines.push(`- **Pass (server accepted):** ${passed}`);
  lines.push(`- **Graceful fail (proper error):** ${graceful}`);
  lines.push(`- **Crash/hang (unexpected):** ${crashed}`);
  lines.push(`- **Reliability score:** ${score}%`);
  lines.push('');

  // Outcome legend
  lines.push('### Outcome Legend');
  lines.push('');
  lines.push('| Outcome | Description |');
  lines.push('|---------|-------------|');
  lines.push('| PASS | Server accepted the input without error |');
  lines.push('| GRACEFUL | Server rejected with a proper validation error |');
  lines.push('| CRASH | Server crashed, hung, or returned unexpected error |');
  lines.push('');

  // Per-tool results
  lines.push('## Results by Tool');
  lines.push('');

  const toolNames = [...new Set(results.map((r) => r.tool))];

  for (const toolName of toolNames) {
    const toolResults = results.filter((r) => r.tool === toolName);
    const toolPassed = toolResults.filter((r) => r.outcome === 'pass').length;
    const toolGraceful = toolResults.filter((r) => r.outcome === 'graceful_fail').length;
    const toolCrashed = toolResults.filter((r) => r.outcome === 'crash_or_hang').length;
    const toolTotal = toolResults.length;
    const toolGood = toolPassed + toolGraceful;

    lines.push(`### ${toolName}`);
    lines.push('');
    lines.push(
      `Score: ${toolGood}/${toolTotal} (${Math.round((toolGood / toolTotal) * 100)}%) | ` +
        `Pass: ${toolPassed} | Graceful: ${toolGraceful} | Crash: ${toolCrashed}`
    );
    lines.push('');
    lines.push('| Mutation | Type | Outcome | Details |');
    lines.push('|----------|------|---------|---------|');

    for (const result of toolResults) {
      const status =
        result.outcome === 'pass'
          ? 'PASS'
          : result.outcome === 'graceful_fail'
            ? 'GRACEFUL'
            : 'CRASH';
      const details = result.error
        ? truncate(result.error, 50)
        : result.response
          ? 'OK'
          : '-';
      lines.push(
        `| ${truncate(result.mutation.description, 40)} | ${result.mutation.type} | ${status} | ${details} |`
      );
    }

    lines.push('');
  }

  // Crash/hang details
  const crashes = results.filter((r) => r.outcome === 'crash_or_hang');
  if (crashes.length > 0) {
    lines.push('## Crashes & Hangs');
    lines.push('');
    lines.push('These mutations caused unexpected behavior:');
    lines.push('');

    for (const crash of crashes) {
      lines.push(`### ${crash.tool}: ${crash.mutation.description}`);
      lines.push('');
      lines.push('**Input:**');
      lines.push('```json');
      lines.push(JSON.stringify(crash.mutation.input, null, 2));
      lines.push('```');
      lines.push('');
      lines.push('**Error:**');
      lines.push('```');
      lines.push(crash.error ?? 'Timeout / No response');
      lines.push('```');
      lines.push('');
    }
  }

  return lines.join('\n');
}

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 3) + '...';
}
