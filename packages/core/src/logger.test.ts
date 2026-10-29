import { describe, expect, it } from 'vitest';
import { createLogger, MemoryLogSink, redact, redactString } from './logger.js';

describe('redaction', () => {
  it('redacts secret-looking keys at any depth', () => {
    const result = redact({
      user: 'alice',
      apiKey: 'abc123',
      nested: { password: 'hunter2', keep: 'yes' },
      list: [{ token: 't' }],
    }) as Record<string, unknown>;
    expect(result.user).toBe('alice');
    expect(result.apiKey).toBe('[REDACTED]');
    expect(result.nested).toEqual({ password: '[REDACTED]', keep: 'yes' });
    expect(result.list).toEqual([{ token: '[REDACTED]' }]);
  });

  it('scrubs credential-shaped strings', () => {
    expect(redactString('token ghp_abcdefghijklmnopqrstuvwxyz0123')).toBe('token [REDACTED]');
    expect(redactString('Authorization: Bearer abcdefghijklmnop')).toContain('[REDACTED]');
    expect(redactString('sk-1234567890abcdefXYZ')).toBe('[REDACTED]');
    expect(redactString('nothing to hide')).toBe('nothing to hide');
  });
});

describe('Logger', () => {
  it('filters by level and records structured context', () => {
    const sink = new MemoryLogSink();
    const logger = createLogger({ level: 'warn', sink, now: () => new Date('2026-01-01T00:00:00Z') });
    logger.info('hidden');
    logger.warn('shown', { secret: 'value', ok: 1 });
    expect(sink.records).toHaveLength(1);
    expect(sink.records[0]?.message).toBe('shown');
    expect(sink.records[0]?.time).toBe('2026-01-01T00:00:00.000Z');
    expect(sink.records[0]?.context).toEqual({ secret: '[REDACTED]', ok: 1 });
  });

  it('carries scope and bound context into child loggers', () => {
    const sink = new MemoryLogSink();
    const logger = createLogger({ level: 'debug', sink }).child('planner').withContext({ project: 'demo' });
    logger.debug('planning');
    expect(sink.records[0]?.scope).toBe('planner');
    expect(sink.records[0]?.context).toEqual({ project: 'demo' });
  });
});
