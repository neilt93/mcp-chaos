import type { ChaosConfig, ChaosRule, ChaosApplied, ProbabilisticValue } from './types.js';

/**
 * Seeded random number generator (mulberry32)
 * Provides deterministic randomness for reproducible chaos
 */
class SeededRandom {
  private state: number;

  constructor(seed: number) {
    this.state = seed;
  }

  /**
   * Returns a random number between 0 and 1
   */
  next(): number {
    let t = (this.state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /**
   * Returns a random integer between min and max (inclusive)
   */
  nextInt(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }
}

export class ChaosInjector {
  private config: ChaosConfig;
  private rng: SeededRandom;
  private seed: number;

  constructor(config: ChaosConfig) {
    this.config = config;
    this.seed = config.seed ?? Date.now();
    this.rng = new SeededRandom(this.seed);
  }

  getSeed(): number {
    return this.seed;
  }

  private getRuleForTool(toolName?: string): ChaosRule {
    // Tool-specific rule takes precedence
    if (toolName && this.config.tools?.[toolName]) {
      return { ...this.config.global, ...this.config.tools[toolName] };
    }
    return this.config.global ?? {};
  }

  /**
   * Resolve a probabilistic value to an actual number
   */
  private resolveValue(value: number | ProbabilisticValue | undefined): number | undefined {
    if (value === undefined) return undefined;

    if (typeof value === 'number') {
      return value;
    }

    // ProbabilisticValue
    const prob = this.rng.next();
    if (prob > value.p) {
      return undefined; // Event doesn't occur
    }

    // Event occurs - determine value
    if (value.value !== undefined) {
      return value.value;
    }

    if (value.min !== undefined && value.max !== undefined) {
      return this.rng.nextInt(value.min, value.max);
    }

    return undefined;
  }

  /**
   * Get delay to inject for a tool call
   */
  getDelay(toolName?: string): number {
    const rule = this.getRuleForTool(toolName);
    return this.resolveValue(rule.delayMs) ?? 0;
  }

  /**
   * Get timeout for a tool call
   */
  getTimeout(toolName?: string): number | undefined {
    const rule = this.getRuleForTool(toolName);
    return this.resolveValue(rule.timeoutMs);
  }

  /**
   * Check if this call should fail
   */
  shouldFail(toolName?: string): boolean {
    const rule = this.getRuleForTool(toolName);
    if (rule.failRate === undefined || rule.failRate <= 0) {
      return false;
    }
    return this.rng.next() < rule.failRate;
  }

  /**
   * Get error response if call should fail
   */
  getErrorResponse(toolName?: string): { code: number; message: string } | undefined {
    if (!this.shouldFail(toolName)) {
      return undefined;
    }

    const rule = this.getRuleForTool(toolName);
    return {
      code: rule.errorCode ?? -32603,
      message: rule.errorMessage ?? 'Chaos-injected error',
    };
  }

  /**
   * Check if response should be corrupted
   */
  shouldCorruptResponse(toolName?: string): boolean {
    const rule = this.getRuleForTool(toolName);
    return rule.corruptResponse ?? false;
  }

  /**
   * Corrupt a response
   */
  corruptResponse(response: unknown): unknown {
    // Return malformed but parseable response
    if (typeof response === 'object' && response !== null) {
      return { ...response, _corrupted: true, _originalKeys: Object.keys(response) };
    }
    return { _corrupted: true, _original: response };
  }

  /**
   * Apply chaos to a tool call and return what was applied
   */
  applyChaos(toolName?: string): ChaosApplied {
    const applied: ChaosApplied = { seed: this.seed };

    const delay = this.getDelay(toolName);
    if (delay > 0) {
      applied.delayMs = delay;
    }

    if (this.shouldFail(toolName)) {
      applied.errorInjected = true;
    }

    if (this.shouldCorruptResponse(toolName)) {
      applied.responseCorrupted = true;
    }

    return applied;
  }
}
