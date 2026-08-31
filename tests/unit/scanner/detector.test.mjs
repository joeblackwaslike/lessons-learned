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

function thinkingBlock(thinking) {
  return { type: 'thinking', thinking };
}

// A complete reasoning→correction sequence:
// 1. assistant emits reasoning text then calls a tool
// 2. user message carries tool_result
// 3. assistant recognizes the issue (correction signal) and calls a new tool
function fullReasoningCorrectionSequence(prefix = '') {
  const toolId = `${prefix}tool-001`;
  const lines = [
    // Assistant reasons then calls pytest
    assistantLine({
      id: `${prefix}msg-a1`,
      blocks: [
        textBlock('I think running pytest tests/ should cover everything here.'),
        toolUseBlock(toolId, 'Bash', { command: 'pytest tests/' }),
      ],
    }),
    // User turn: tool result (non-error, just output)
    userLine({
      id: `${prefix}msg-u1`,
      blocks: [toolResultBlock(toolId, 'Error: process exited with exit code 1\nTraceback: ...\n')],
    }),
    // Assistant recognizes the issue and corrects course
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

  it('emits no candidates when only a tool call and clean result', () => {
    const d = new HeuristicDetector();
    const toolId = 'tool-x';
    d.feedLine(assistantLine({ blocks: [toolUseBlock(toolId, 'Bash', { command: 'ls -la' })] }));
    d.feedLine(userLine({ blocks: [toolResultBlock(toolId, 'file1.txt\nfile2.txt')] }));
    assert.equal(d.flush().length, 0);
  });

  it('detects a complete reasoning→self-correction→retry sequence', () => {
    const d = new HeuristicDetector();
    for (const line of fullReasoningCorrectionSequence()) {
      d.feedLine(line);
    }
    const candidates = d.flush();
    assert.equal(candidates.length, 1);
  });

  it('candidate has problemTurnIndex and correctionTurnIndex', () => {
    const d = new HeuristicDetector();
    for (const line of fullReasoningCorrectionSequence()) {
      d.feedLine(line);
    }
    const [candidate] = d.flush();
    assert.ok(typeof candidate.problemTurnIndex === 'number', 'expected problemTurnIndex');
    assert.ok(typeof candidate.correctionTurnIndex === 'number', 'expected correctionTurnIndex');
    assert.ok(candidate.correctionTurnIndex > candidate.problemTurnIndex);
  });

  it('problem source is agent reasoning, not tool output', () => {
    const d = new HeuristicDetector();
    for (const line of fullReasoningCorrectionSequence()) {
      d.feedLine(line);
    }
    const [candidate] = d.flush();
    const problemTurn = candidate.turns[candidate.problemTurnIndex];
    assert.ok(
      problemTurn.type === 'assistant' || problemTurn.type === 'thinking',
      `problem turn type should be assistant or thinking, got: ${problemTurn.type}`
    );
    assert.ok(
      !problemTurn.text.includes('exit code 1'),
      'problem turn should not contain raw tool output'
    );
  });

  it('candidate signals include matched correction pattern strings', () => {
    const d = new HeuristicDetector();
    for (const line of fullReasoningCorrectionSequence()) {
      d.feedLine(line);
    }
    const [candidate] = d.flush();
    assert.ok(candidate.signals.correctionSignals.length > 0, 'expected correction signals');
  });

  it('emits no candidate when correction signal has no preceding reasoning turn', () => {
    const d = new HeuristicDetector();
    // Correction appears as the first assistant turn — nothing to look back to
    d.feedLine(
      assistantLine({
        id: 'msg-a1',
        blocks: [
          textBlock('I see the issue. Let me fix it.'),
          toolUseBlock('tool-001', 'Bash', { command: 'pytest' }),
        ],
      })
    );
    assert.equal(d.flush().length, 0, 'no preceding reasoning turn means no candidate');
  });

  it('emits no candidate when tool_result has error-like text but no correction signal', () => {
    const d = new HeuristicDetector();
    const toolId = 'tool-err';
    // Reasoning turn
    d.feedLine(
      assistantLine({
        blocks: [
          textBlock('I will run the suite.'),
          toolUseBlock(toolId, 'Bash', { command: 'npm test' }),
        ],
      })
    );
    // Error result
    d.feedLine(userLine({ blocks: [toolResultBlock(toolId, 'Error: exit code 1\nfailed')] }));
    // Next assistant turn without a correction signal
    d.feedLine(
      assistantLine({
        id: 'msg-a2',
        blocks: [
          textBlock('The tests have run.'),
          toolUseBlock('tool-002', 'Bash', { command: 'ls' }),
        ],
      })
    );
    assert.equal(d.flush().length, 0, 'tool_result error alone should not trigger detection');
  });
});

// ─── Thinking block detection ──────────────────────────────────────────────

describe('HeuristicDetector: thinking block as problem source', () => {
  it('uses a thinking block as the problem source', () => {
    const d = new HeuristicDetector();
    const toolId = 'tool-t1';

    // Assistant turn: thinking block → tool call
    d.feedLine(
      assistantLine({
        id: 'msg-a1',
        blocks: [
          thinkingBlock('I should use git stash here to save the changes.'),
          toolUseBlock(toolId, 'Bash', { command: 'git stash' }),
        ],
      })
    );
    // Tool result
    d.feedLine(
      userLine({
        blocks: [toolResultBlock(toolId, 'Saved working directory and index state')],
      })
    );
    // Assistant recognizes the stash missed untracked files
    d.feedLine(
      assistantLine({
        id: 'msg-a2',
        blocks: [
          textBlock(
            'Actually, I should have used git stash -u to include untracked files. Let me fix that.'
          ),
          toolUseBlock('tool-t2', 'Bash', { command: 'git stash pop && git stash -u' }),
        ],
      })
    );

    const candidates = d.flush();
    assert.equal(candidates.length, 1);
    const problemTurn = candidates[0].turns[candidates[0].problemTurnIndex];
    assert.equal(problemTurn.type, 'thinking', 'problem source should be a thinking block');
    assert.equal(candidates[0].signals.thinkingBlock, true, 'thinkingBlock signal should be true');
  });
});

// ─── User correction ───────────────────────────────────────────────────────

describe('HeuristicDetector: user correction path', () => {
  it('detects a user correction followed by assistant fix', () => {
    const d = new HeuristicDetector();
    const toolId = 'tool-u1';

    // Assistant reasons and calls a tool
    d.feedLine(
      assistantLine({
        blocks: [
          textBlock('I think npm install is the right approach here.'),
          toolUseBlock(toolId, 'Bash', { command: 'npm install' }),
        ],
      })
    );
    // Tool result
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

  it('problem source is reasoning turn, not user complaint', () => {
    const d = new HeuristicDetector();
    const toolId = 'tool-u2';

    d.feedLine(
      assistantLine({
        id: 'msg-a1',
        blocks: [
          textBlock('Running npm install should work fine.'),
          toolUseBlock(toolId, 'Bash', { command: 'npm install' }),
        ],
      })
    );
    d.feedLine(userLine({ blocks: [toolResultBlock(toolId, 'ok')] }));
    d.feedLine(userLine({ id: 'msg-u2', blocks: [textBlock("No, that's wrong — use npm ci")] }));
    d.feedLine(
      assistantLine({ id: 'msg-a2', blocks: [textBlock('You are right. Using npm ci.')] })
    );

    const [candidate] = d.flush();
    const problemTurn = candidate.turns[candidate.problemTurnIndex];
    assert.ok(
      problemTurn.type === 'assistant' || problemTurn.type === 'thinking',
      'problem source should be an assistant/thinking turn'
    );
  });
});

// ─── File content tool exclusion from toolContext ─────────────────────────

describe('HeuristicDetector: file-content tool excluded from toolContext', () => {
  it('emits a candidate but sets toolContextIndex to null when only Read result is between problem and correction', () => {
    const d = new HeuristicDetector();
    const readToolId = 'tool-r1';

    // Reasoning turn + Read call
    d.feedLine(
      assistantLine({
        id: 'msg-a1',
        blocks: [
          textBlock('I need to read the file to understand the structure.'),
          toolUseBlock(readToolId, 'Read', { file_path: '/src/app.py' }),
        ],
      })
    );
    // Read result (file content, may contain error-like text)
    d.feedLine(
      userLine({
        blocks: [
          toolResultBlock(readToolId, 'raise Exception("something failed with exit code 1")'),
        ],
      })
    );
    // Assistant correction
    d.feedLine(
      assistantLine({
        id: 'msg-a2',
        blocks: [
          textBlock('I see the issue now. Let me fix the exception handling.'),
          toolUseBlock('tool-r2', 'Edit', { file_path: '/src/app.py' }),
        ],
      })
    );

    const candidates = d.flush();
    assert.equal(candidates.length, 1, 'should emit a candidate');
    assert.equal(candidates[0].toolContextIndex, null, 'Read results excluded from toolContext');
  });

  it('emits a candidate with toolContextIndex set for a Bash result between problem and correction', () => {
    const d = new HeuristicDetector();
    for (const line of fullReasoningCorrectionSequence('bash-')) {
      d.feedLine(line);
    }
    const [candidate] = d.flush();
    assert.equal(
      candidate.toolContextIndex != null,
      true,
      'Bash result should populate toolContextIndex'
    );
  });
});

// ─── Dedup ─────────────────────────────────────────────────────────────────

describe('HeuristicDetector: dedup', () => {
  it('emits exactly one candidate per reasoning→correction sequence', () => {
    const d = new HeuristicDetector();
    const toolId = 'tool-dd1';

    d.feedLine(
      assistantLine({
        id: 'dd-a1',
        blocks: [textBlock('Trying pytest.'), toolUseBlock(toolId, 'Bash', { command: 'pytest' })],
      })
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
    // More turns arrive — should not re-emit the same correction
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
    for (const line of fullReasoningCorrectionSequence()) {
      d.feedLine(line);
    }
    d.flush();
    assert.deepEqual(d.flush(), []);
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
