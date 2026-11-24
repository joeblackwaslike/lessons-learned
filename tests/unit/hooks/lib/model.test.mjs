import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectModel, modelFromTranscript } from '../../../../hooks/lib/model.mjs';

let dir;
let savedHome;
let savedOverride;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'll-model-'));
  savedHome = process.env.HOME;
  savedOverride = process.env.LESSONS_LEARNED_MODEL;
  process.env.HOME = dir;
  delete process.env.LESSONS_LEARNED_MODEL;
});

afterEach(() => {
  process.env.HOME = savedHome;
  if (savedOverride === undefined) delete process.env.LESSONS_LEARNED_MODEL;
  else process.env.LESSONS_LEARNED_MODEL = savedOverride;
  rmSync(dir, { recursive: true, force: true });
});

const assistant = model =>
  JSON.stringify({ type: 'assistant', message: { role: 'assistant', model } });
const user = () => JSON.stringify({ type: 'user', message: { role: 'user', content: 'hi' } });

function writeTranscript(lines) {
  const path = join(dir, 'session.jsonl');
  writeFileSync(path, lines.join('\n') + '\n');
  return path;
}

function writeSettings(settings) {
  mkdirSync(join(dir, '.claude'), { recursive: true });
  writeFileSync(join(dir, '.claude', 'settings.json'), JSON.stringify(settings));
}

describe('modelFromTranscript', () => {
  it('reads message.model from the last assistant entry', () => {
    const path = writeTranscript([
      user(),
      assistant('claude-sonnet-4-6'),
      user(),
      assistant('claude-sonnet-5-5'),
    ]);
    assert.equal(modelFromTranscript(path), 'claude-sonnet-5-5');
  });

  it('skips synthetic entries and top-level model keys', () => {
    const path = writeTranscript([
      assistant('claude-haiku-4-5'),
      assistant('<synthetic>'),
      JSON.stringify({ type: 'system', model: 'claude-opus-5' }),
    ]);
    assert.equal(modelFromTranscript(path), 'claude-haiku-4-5');
  });

  it('finds the model in the tail of a transcript larger than the read window', () => {
    const filler = Array.from({ length: 4000 }, () => user());
    const path = writeTranscript([
      assistant('claude-opus-4-1'),
      ...filler,
      assistant('claude-sonnet-5-5'),
      user(),
    ]);
    assert.equal(modelFromTranscript(path), 'claude-sonnet-5-5');
  });

  it('returns null for a missing file, no path, or a transcript with no assistant model', () => {
    assert.equal(modelFromTranscript(join(dir, 'nope.jsonl')), null);
    assert.equal(modelFromTranscript(undefined), null);
    assert.equal(modelFromTranscript(writeTranscript([user(), 'not json "model"'])), null);
  });
});

describe('detectModel', () => {
  it('LESSONS_LEARNED_MODEL overrides every other source', () => {
    process.env.LESSONS_LEARNED_MODEL = 'claude-opus-5';
    writeSettings({ model: 'claude-sonnet-4-6' });
    assert.equal(detectModel({ model: 'claude-haiku-4-5' }), 'claude-opus-5');
  });

  it('prefers the hook input model, then the transcript, then settings.json', () => {
    const path = writeTranscript([assistant('claude-sonnet-5-5')]);
    writeSettings({ model: 'claude-opus-4-1' });
    assert.equal(
      detectModel({ model: 'claude-haiku-4-5', transcript_path: path }),
      'claude-haiku-4-5'
    );
    assert.equal(detectModel({ transcript_path: path }), 'claude-sonnet-5-5');
    assert.equal(detectModel({}), 'claude-opus-4-1');
  });

  it('treats an alias such as "sonnet" as unknown, not as a model ID', () => {
    writeSettings({ model: 'sonnet' });
    assert.equal(detectModel({ model: 'opus[1m]' }), null);
  });

  it('reports unknown for a subagent, whose model may differ from the session transcript', () => {
    const path = writeTranscript([assistant('claude-sonnet-5-5')]);
    assert.equal(detectModel({ transcript_path: path, agent_id: 'agent-1' }), null);
  });

  it('reports unknown on non-Claude platforms, ignoring the Claude settings and transcript', () => {
    writeSettings({ model: 'claude-opus-4-1' });
    const path = writeTranscript([assistant('claude-sonnet-5-5')]);
    process.env.LESSONS_AGENT_PLATFORM = 'codex';
    try {
      assert.equal(detectModel({ transcript_path: path }), null);
    } finally {
      delete process.env.LESSONS_AGENT_PLATFORM;
    }
  });

  it('returns null when no source yields a model', () => {
    assert.equal(detectModel(undefined), null);
    assert.equal(detectModel({ transcript_path: join(dir, 'nope.jsonl') }), null);
  });
});
