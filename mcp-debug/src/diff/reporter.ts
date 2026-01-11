import type { TraceComparison } from './comparator.js';

export function generateDiffReport(
  comparison: TraceComparison,
  baselinePath: string,
  currentPath: string
): string {
  const lines: string[] = [];

  lines.push('# Trace Diff Report');
  lines.push('');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push('');
  lines.push(`- **Baseline:** ${baselinePath}`);
  lines.push(`- **Current:** ${currentPath}`);
  lines.push('');

  // Summary
  lines.push('## Summary');
  lines.push('');
  lines.push(`| Metric | Value |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Baseline calls | ${comparison.baselineCalls} |`);
  lines.push(`| Current calls | ${comparison.currentCalls} |`);
  lines.push(`| Added calls | ${comparison.added.length} |`);
  lines.push(`| Removed calls | ${comparison.removed.length} |`);
  lines.push(`| Changed calls | ${comparison.changed.length} |`);
  lines.push(`| Latency regressions | ${comparison.latencyChanges.filter(l => l.changePercent > 0).length} |`);
  lines.push('');

  // Status
  const hasChanges =
    comparison.added.length > 0 ||
    comparison.removed.length > 0 ||
    comparison.changed.length > 0;

  if (!hasChanges) {
    lines.push('**Status:** No behavioral changes detected.');
    lines.push('');
    return lines.join('\n');
  }

  lines.push('**Status:** Changes detected - review below.');
  lines.push('');

  // Added calls
  if (comparison.added.length > 0) {
    lines.push('## Added Calls');
    lines.push('');
    lines.push('These calls appear in current but not in baseline:');
    lines.push('');
    lines.push('| Method | Parameters |');
    lines.push('|--------|------------|');
    for (const call of comparison.added) {
      lines.push(`| ${call.method} | \`${truncateJson(call.params)}\` |`);
    }
    lines.push('');
  }

  // Removed calls
  if (comparison.removed.length > 0) {
    lines.push('## Removed Calls');
    lines.push('');
    lines.push('These calls appear in baseline but not in current:');
    lines.push('');
    lines.push('| Method | Parameters |');
    lines.push('|--------|------------|');
    for (const call of comparison.removed) {
      lines.push(`| ${call.method} | \`${truncateJson(call.params)}\` |`);
    }
    lines.push('');
  }

  // Changed calls
  if (comparison.changed.length > 0) {
    lines.push('## Changed Calls');
    lines.push('');
    lines.push('These calls have different parameters or results:');
    lines.push('');

    for (const change of comparison.changed) {
      lines.push(`### ${change.method} (call #${change.index + 1})`);
      lines.push('');

      if (change.paramsDiff) {
        lines.push('**Parameters changed:**');
        lines.push('');
        lines.push('Baseline:');
        lines.push('```json');
        lines.push(JSON.stringify(change.baselineParams, null, 2));
        lines.push('```');
        lines.push('');
        lines.push('Current:');
        lines.push('```json');
        lines.push(JSON.stringify(change.currentParams, null, 2));
        lines.push('```');
        lines.push('');
      }

      if (change.resultDiff) {
        lines.push('**Result changed:**');
        lines.push('');
        lines.push('Baseline:');
        lines.push('```json');
        lines.push(JSON.stringify(change.baselineResult, null, 2));
        lines.push('```');
        lines.push('');
        lines.push('Current:');
        lines.push('```json');
        lines.push(JSON.stringify(change.currentResult, null, 2));
        lines.push('```');
        lines.push('');
      }
    }
  }

  // Latency changes
  if (comparison.latencyChanges.length > 0) {
    lines.push('## Latency Changes');
    lines.push('');
    lines.push('Calls with >20% latency change:');
    lines.push('');
    lines.push('| Method | Baseline (ms) | Current (ms) | Change |');
    lines.push('|--------|---------------|--------------|--------|');
    for (const change of comparison.latencyChanges) {
      const direction = change.changePercent > 0 ? 'slower' : 'faster';
      lines.push(
        `| ${change.method} | ${change.baselineLatency} | ${change.currentLatency} | ${Math.abs(change.changePercent).toFixed(1)}% ${direction} |`
      );
    }
    lines.push('');
  }

  return lines.join('\n');
}

function truncateJson(obj: unknown, maxLen = 50): string {
  if (obj === undefined) return 'undefined';
  if (obj === null) return 'null';
  const str = JSON.stringify(obj);
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 3) + '...';
}
