import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { logger } from '../utils/logger.js';
import { compareTraces } from '../diff/comparator.js';
import { generateDiffReport } from '../diff/reporter.js';
import { TraceRecorder } from '../tracer/recorder.js';
import type { Trace } from '../tracer/types.js';

interface DiffOptions {
  baseline: string;
  current: string;
  output: string;
}

/**
 * Load a trace file, auto-detecting format (JSONL or legacy JSON)
 */
function loadTrace(path: string): Trace {
  const content = readFileSync(path, 'utf-8').trim();

  // Check if it's JSONL (starts with {"t": or multiple lines)
  if (content.startsWith('{"t":') || (content.includes('\n') && content.split('\n')[0].startsWith('{'))) {
    // JSONL format - convert to legacy
    return TraceRecorder.jsonlToLegacy(path);
  }

  // Legacy JSON format
  return JSON.parse(content);
}

export async function diffCommand(options: DiffOptions): Promise<void> {
  const { baseline, current, output } = options;

  logger.info('Loading traces', { baseline, current });

  // Load traces (auto-detect format)
  let baselineTrace: Trace;
  let currentTrace: Trace;

  try {
    baselineTrace = loadTrace(baseline);
  } catch (err) {
    logger.error('Failed to load baseline trace', { path: baseline, error: String(err) });
    console.error(err);
    process.exit(1);
  }

  try {
    currentTrace = loadTrace(current);
  } catch (err) {
    logger.error('Failed to load current trace', { path: current, error: err });
    process.exit(1);
  }

  // Compare traces
  logger.info('Comparing traces');
  const comparison = compareTraces(baselineTrace, currentTrace);

  // Generate report
  const report = generateDiffReport(comparison, baseline, current);

  // Save report
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, report);
  logger.info(`Diff report saved to ${output}`);

  // Print summary
  console.error(`\nDiff Summary:`);
  console.error(`  Baseline calls: ${comparison.baselineCalls}`);
  console.error(`  Current calls: ${comparison.currentCalls}`);
  console.error(`  Added: ${comparison.added.length}`);
  console.error(`  Removed: ${comparison.removed.length}`);
  console.error(`  Changed: ${comparison.changed.length}`);
}
