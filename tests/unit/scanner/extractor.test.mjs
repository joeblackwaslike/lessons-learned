import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractFromStructured,
  extractFromHeuristic,
  scoreCandidateConfidence,
  scoreCandidatePriority,
} from '../../../scripts/scanner/extractor.mjs';

// ─── Fixtures ──────────────────────────────────────────────────────────────

function makeStructuredTag(overrides = {}) {
  return {
    tool: 'Bash',
    trigger: 'pytest tests/',
    problem: 'pytest hangs',
    solution: 'use python -m pytest',
    tags: ['lang:python', 'severity:hang'],
    sessionId: 'sess-001',
    messageId: 'msg-001',
    timestamp: '2026-04-01T00:00:00Z',
    ...overrides,
  };
}

function makeHeuristicWindow(overrides = {}) {
  return {
    sessionId: 'sess-001',
    timestamp: '2026-04-01T00:00:00Z',
    errorTurnIndex: 1,
    correctionTurnIndex: 2,
    turns: [
      { type: 'tool_call', toolName: 'Bash', toolInput: { command: 'pytest tests/' } },
      {
        type: 'tool_result',
        toolName: 'Bash',
        text: 'Error: TTY detection failed',
        messageId: 'msg-002',
      },
      { type: 'assistant', text: 'Use python -m pytest instead', messageId: 'msg-003' },
    ],
    signals: {
      userCorrection: false,
      errorSignals: ['TTY detection failed'],
      correctionSignals: ['Use'],
    },
    ...overrides,
  };
}

// ─── extractFromStructured ─────────────────────────────────────────────────

describe('extractFromStructured', () => {
  it('sets source to "structured"', () => {
    const result = extractFromStructured(makeStructuredTag());
    assert.equal(result.source, 'structured');
  });

  it('maps solution field correctly', () => {
    const result = extractFromStructured(makeStructuredTag({ solution: 'Do X instead' }));
    assert.equal(result.solution, 'Do X instead');
  });

  it('copies all context fields', () => {
    const result = extractFromStructured(makeStructuredTag());
    assert.equal(result.tool, 'Bash');
    assert.equal(result.trigger, 'pytest tests/');
    assert.equal(result.sessionId, 'sess-001');
    assert.equal(result.messageId, 'msg-001');
    assert.equal(result.timestamp, '2026-04-01T00:00:00Z');
  });

  it('computes a sha256 contentHash', () => {
    const result = extractFromStructured(makeStructuredTag());
    assert.ok(result.contentHash.startsWith('sha256:'));
    assert.equal(result.contentHash.length, 7 + 64); // 'sha256:' + 64 hex chars
  });

  it('same content produces same contentHash', () => {
    const a = extractFromStructured(makeStructuredTag());
    const b = extractFromStructured(makeStructuredTag());
    assert.equal(a.contentHash, b.contentHash);
  });

  it('different problem produces different contentHash', () => {
    const a = extractFromStructured(makeStructuredTag({ problem: 'error A' }));
    const b = extractFromStructured(makeStructuredTag({ problem: 'error B' }));
    assert.notEqual(a.contentHash, b.contentHash);
  });

  it('computes a confidence score between 0 and 1', () => {
    const result = extractFromStructured(makeStructuredTag());
    assert.ok(result.confidence >= 0 && result.confidence <= 1);
  });

  it('computes a priority score between 1 and 10', () => {
    const result = extractFromStructured(makeStructuredTag());
    assert.ok(result.priority >= 1 && result.priority <= 10);
  });

  it('sets needsReview=false when confidence >= 0.7', () => {
    // Full tag with tool, trigger, tags including colon → should reach ≥ 0.7
    const result = extractFromStructured(makeStructuredTag());
    assert.equal(result.needsReview, result.confidence < 0.7);
  });

  it('handles missing optional fields without throwing', () => {
    const tag = { problem: 'Error occurred', solution: 'Fix it' };
    assert.doesNotThrow(() => extractFromStructured(tag));
    const result = extractFromStructured(tag);
    assert.equal(result.tool, null);
    assert.equal(result.trigger, null);
    assert.deepEqual(result.tags, []);
  });
});

// ─── extractFromHeuristic ──────────────────────────────────────────────────

describe('extractFromHeuristic', () => {
  it('sets source to "heuristic"', () => {
    const result = extractFromHeuristic(makeHeuristicWindow());
    assert.equal(result.source, 'heuristic');
  });

  it('extracts problem from error turn text', () => {
    const result = extractFromHeuristic(makeHeuristicWindow());
    assert.ok(result.problem.includes('TTY detection failed'));
  });

  it('extracts solution from correction turn text', () => {
    const result = extractFromHeuristic(makeHeuristicWindow());
    assert.ok(result.solution.includes('python -m pytest'));
  });

  it('sets needsReview=true always for heuristic', () => {
    const result = extractFromHeuristic(makeHeuristicWindow());
    assert.equal(result.needsReview, true);
  });

  it('infers tool:pytest tag from pytest trigger', () => {
    const result = extractFromHeuristic(makeHeuristicWindow());
    assert.ok(result.tags.includes('tool:pytest'));
  });
});

// ─── scoreCandidateConfidence ──────────────────────────────────────────────

describe('scoreCandidateConfidence', () => {
  it('structured base is higher than heuristic base', () => {
    const structured = { source: 'structured', tool: null, trigger: null, tags: [], signals: {} };
    const heuristic = { source: 'heuristic', tool: null, trigger: null, tags: [], signals: {} };
    assert.ok(scoreCandidateConfidence(structured) > scoreCandidateConfidence(heuristic));
  });

  it('structured with all fields gets bonus', () => {
    const base = { source: 'structured', tool: null, trigger: null, tags: [], signals: {} };
    const full = {
      source: 'structured',
      tool: 'Bash',
      trigger: 'pytest',
      tags: ['a:b'],
      signals: {},
    };
    assert.ok(scoreCandidateConfidence(full) > scoreCandidateConfidence(base));
  });

  it('heuristic with userCorrection gets bonus', () => {
    const without = {
      source: 'heuristic',
      tool: null,
      trigger: null,
      tags: [],
      signals: { userCorrection: false },
    };
    const with_ = {
      source: 'heuristic',
      tool: null,
      trigger: null,
      tags: [],
      signals: { userCorrection: true },
    };
    assert.ok(scoreCandidateConfidence(with_) > scoreCandidateConfidence(without));
  });

  it('result is clamped to [0, 1]', () => {
    // Pile on all bonuses — should not exceed 1.0
    const candidate = {
      source: 'structured',
      tool: 'Bash',
      trigger: 'pytest',
      tags: ['a:b', 'c:d'],
      signals: { userCorrection: true, errorSignals: ['a', 'b'], correctionSignals: ['x', 'y'] },
    };
    const score = scoreCandidateConfidence(candidate);
    assert.ok(score <= 1.0);
    assert.ok(score >= 0.0);
  });
});

// ─── scoreCandidatePriority ────────────────────────────────────────────────

describe('scoreCandidatePriority', () => {
  it('base priority is 3 for minimal candidate', () => {
    const candidate = { tags: [], signals: {} };
    assert.equal(scoreCandidatePriority(candidate), 3);
  });

  it('severity:hang tag increases priority', () => {
    const candidate = { tags: ['severity:hang'], signals: {} };
    assert.ok(scoreCandidatePriority(candidate) > 3);
  });

  it('severity:data-loss tag increases priority', () => {
    const candidate = { tags: ['severity:data-loss'], signals: {} };
    assert.ok(scoreCandidatePriority(candidate) > 3);
  });

  it('userCorrection signal increases priority', () => {
    const without = { tags: [], signals: { userCorrection: false } };
    const with_ = { tags: [], signals: { userCorrection: true } };
    assert.ok(scoreCandidatePriority(with_) > scoreCandidatePriority(without));
  });

  it('result is clamped to [1, 10]', () => {
    const candidate = {
      tags: ['severity:hang', 'severity:data-loss'],
      signals: { userCorrection: true },
    };
    const score = scoreCandidatePriority(candidate);
    assert.ok(score >= 1 && score <= 10);
  });
});
