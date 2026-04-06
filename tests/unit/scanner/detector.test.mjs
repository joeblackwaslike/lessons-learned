import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { HeuristicDetector } from '../../../scripts/scanner/detector.mjs';

// ─── JSONL line builders ───────────────────────────────────────────────────

function assistantLine({
  id = 'msg-001',
  blocks,
  sessionId = 'sess-1',
  timestamp = '2026-04-01T00:00:00Z',
}) {
  return JSON.stringify({
    type: 'assistant',
    sessionId,
    timestamp,
    message: {
      id,
      role: 'assistant',
      content: blocks,
    },
  });
}

function userLine({
  id = 'msg-u01',
  blocks,
  sessionId = 'sess-1',
  timestamp = '2026-04-01T00:00:01Z',
}) {
  return JSON.stringify({
    type: 'user',
    sessionId,
    timestamp,
    message: {
      id,
      role: 'user',
      content: blocks,
    },
  });
}

function toolUseBlock(toolUseId, name, input = {}) {
  return { type: 'tool_use', id: toolUseId, name, input };
}

function toolResultBlock(toolUseId, content) {
  return { type: 'tool_result', tool_use_id: toolUseId, content };
}

function textBlock(text) {
  return { type: 'text', text };
}

// A complete error→correction sequence:
// 1. assistant calls Bash (pytest)
// 2. user message carries tool_result with error text
// 3. assistant recognizes the issue and calls a new tool
function fullErrorCorrectionSequence(prefix = '') {
  const toolId = `${prefix}tool-001`;
  const lines = [
    // Assistant calls pytest
    assistantLine({
      id: `${prefix}msg-a1`,
      blocks: [toolUseBlock(toolId, 'Bash', { command: 'pytest tests/' })],
    }),
    // User turn: tool result with an error
    userLine({
      id: `${prefix}msg-u1`,
      blocks: [toolResultBlock(toolId, 'Error: process exited with exit code 1\nTraceback: ...\n')],
    }),
    // Assistant recognizes the error and corrects course
    assistantLine({
      id: `${prefix}msg-a2`,
      blocks: [
        textBlock('I see the issue — pytest needs the --no-header flag. Let me fix that.'),
        toolUseBlock(`${prefix}tool-002`, 'Bash', { command: 'pytest tests/ --no-header' }),
      ],
    }),
  ];
  return lines;
}

// ─── Basic detection ───────────────────────────────────────────────────────

describe('HeuristicDetector: basic detection', () => {
  it('emits no candidates for an empty input', () => {
    const d = new HeuristicDetector();
    assert.deepEqual(d.flush(), []);
  });

  it('emits no candidates for lines with no type field', () => {
    const d = new HeuristicDetector();
    d.feedLine('{"message": "hello"}');
    assert.deepEqual(d.flush(), []);
  });

  it('emits no candidates when only tool call, no error result', () => {
    const d = new HeuristicDetector();
    const toolId = 'tool-x';
    d.feedLine(assistantLine({ blocks: [toolUseBlock(toolId, 'Bash', { command: 'ls -la' })] }));
    d.feedLine(userLine({ blocks: [toolResultBlock(toolId, 'file1.txt\nfile2.txt')] }));
    assert.equal(d.flush().length, 0);
  });

  it('detects a complete error→self-correction→retry sequence', () => {
    const d = new HeuristicDetector();
    for (const line of fullErrorCorrectionSequence()) {
      d.feedLine(line);
    }
    const candidates = d.flush();
    assert.equal(candidates.length, 1);
  });

  it('candidate has errorTurnIndex and correctionTurnIndex', () => {
    const d = new HeuristicDetector();
    for (const line of fullErrorCorrectionSequence()) {
      d.feedLine(line);
    }
    const [candidate] = d.flush();
    assert.ok(typeof candidate.errorTurnIndex === 'number');
    assert.ok(typeof candidate.correctionTurnIndex === 'number');
    assert.ok(candidate.correctionTurnIndex > candidate.errorTurnIndex);
  });

  it('candidate signals include matched error pattern strings', () => {
    const d = new HeuristicDetector();
    for (const line of fullErrorCorrectionSequence()) {
      d.feedLine(line);
    }
    const [candidate] = d.flush();
    assert.ok(candidate.signals.errorSignals.length > 0, 'expected error signals');
    assert.ok(candidate.signals.correctionSignals.length > 0, 'expected correction signals');
  });
});

// ─── User correction ───────────────────────────────────────────────────────

describe('HeuristicDetector: user correction path', () => {
  it('detects a user correction followed by assistant fix', () => {
    const d = new HeuristicDetector();
    const toolId = 'tool-u1';

    // Assistant calls a tool
    d.feedLine(
      assistantLine({
        blocks: [toolUseBlock(toolId, 'Bash', { command: 'npm install' })],
      })
    );
    // Tool result with error
    d.feedLine(
      userLine({
        blocks: [toolResultBlock(toolId, 'Error: EACCES permission denied')],
      })
    );
    // User corrects the assistant
    d.feedLine(
      userLine({
        id: 'msg-u2',
        blocks: [textBlock("No, that's wrong — you should use npm ci instead")],
      })
    );
    // Assistant applies the fix
    d.feedLine(
      assistantLine({
        id: 'msg-a2',
        blocks: [textBlock("You're right, let me use npm ci instead.")],
      })
    );

    const candidates = d.flush();
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].signals.userCorrection, true);
  });
});

// ─── File content tool exclusion ──────────────────────────────────────────

describe('HeuristicDetector: file-content tool exclusion', () => {
  it('does not emit a candidate for error-like text from Read tool result', () => {
    const d = new HeuristicDetector();
    const toolId = 'tool-r1';

    // Assistant calls Read
    d.feedLine(
      assistantLine({
        blocks: [toolUseBlock(toolId, 'Read', { file_path: '/src/app.py' })],
      })
    );
    // Read result contains error-like text (e.g., file has error handling code)
    d.feedLine(
      userLine({
        blocks: [toolResultBlock(toolId, 'raise Exception("something failed with exit code 1")')],
      })
    );
    // Assistant makes a follow-up correction (irrelevant to Read result)
    d.feedLine(
      assistantLine({
        blocks: [
          textBlock('I see the issue. Let me fix it.'),
          toolUseBlock('tool-r2', 'Edit', { file_path: '/src/app.py' }),
        ],
      })
    );

    assert.equal(d.flush().length, 0, 'Read tool results should not trigger detection');
  });

  it('does emit a candidate for a Bash tool result with errors', () => {
    const d = new HeuristicDetector();
    for (const line of fullErrorCorrectionSequence('bash-')) {
      d.feedLine(line);
    }
    assert.equal(d.flush().length, 1);
  });
});

// ─── Dedup ─────────────────────────────────────────────────────────────────

describe('HeuristicDetector: dedup', () => {
  it('emits exactly one candidate per error→correction sequence', () => {
    // The detector should not double-emit when _detectPattern() is called multiple
    // times on the same window as new turns arrive after the correction.
    const d = new HeuristicDetector();
    const toolId = 'tool-dd1';

    // Build the error→correction sequence
    d.feedLine(
      assistantLine({ id: 'dd-a1', blocks: [toolUseBlock(toolId, 'Bash', { command: 'pytest' })] })
    );
    d.feedLine(userLine({ id: 'dd-u1', blocks: [toolResultBlock(toolId, 'Error: exit code 1')] }));
    d.feedLine(
      assistantLine({
        id: 'dd-a2',
        blocks: [
          textBlock('I see the issue. Let me fix it.'),
          toolUseBlock('tool-dd2', 'Bash', { command: 'pytest --no-header' }),
        ],
      })
    );
    // A few more unrelated turns arrive — should not trigger re-detection of same error
    d.feedLine(
      userLine({ id: 'dd-u2', blocks: [toolResultBlock('tool-dd2', 'All tests passed')] })
    );
    d.feedLine(assistantLine({ id: 'dd-a3', blocks: [textBlock('Tests are now passing.')] }));

    const candidates = d.flush();
    assert.equal(candidates.length, 1, `expected exactly 1 candidate, got ${candidates.length}`);
  });
});

// ─── Window management ─────────────────────────────────────────────────────

describe('HeuristicDetector: window management', () => {
  it('does not throw when fed many lines (window sliding)', () => {
    const d = new HeuristicDetector();
    assert.doesNotThrow(() => {
      // Feed 20 tool call/result pairs with no errors
      for (let i = 0; i < 20; i++) {
        const id = `tool-w${i}`;
        d.feedLine(
          assistantLine({ id: `msg-a${i}`, blocks: [toolUseBlock(id, 'Bash', { command: 'ls' })] })
        );
        d.feedLine(userLine({ id: `msg-u${i}`, blocks: [toolResultBlock(id, 'file.txt')] }));
      }
    });
  });

  it('flush resets the candidates list', () => {
    const d = new HeuristicDetector();
    for (const line of fullErrorCorrectionSequence()) {
      d.feedLine(line);
    }
    d.flush(); // first flush
    assert.deepEqual(d.flush(), []); // second flush should be empty
  });
});

// ─── Invalid input robustness ──────────────────────────────────────────────

describe('HeuristicDetector: robustness', () => {
  it('does not throw for malformed JSON lines', () => {
    const d = new HeuristicDetector();
    assert.doesNotThrow(() => {
      d.feedLine('{not json "type": "assistant"}');
      d.feedLine('null');
      d.feedLine('');
    });
  });

  it('does not throw for assistant lines with no content array', () => {
    const d = new HeuristicDetector();
    assert.doesNotThrow(() => {
      d.feedLine(JSON.stringify({ type: 'assistant', message: { content: null } }));
    });
  });
});
