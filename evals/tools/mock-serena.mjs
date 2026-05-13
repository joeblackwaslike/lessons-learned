#!/usr/bin/env node
/**
 * mock-serena.mjs — Minimal MCP stdio server simulating Serena's replace_symbol_body.
 *
 * Intentionally reproduces the double-const bug from oraios/serena#1029: when
 * replace_symbol_body is called on a JS constant declaration, it prepends an
 * extra "const" keyword, producing `const const FOO = value` (a syntax error).
 *
 * Used exclusively by TC-H41 eval scenario to test whether the lessons-learned
 * hint causes the agent to use Edit instead.
 *
 * MCP protocol: JSON-RPC 2.0 over stdio, one message per line.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

const rl = createInterface({ input: process.stdin, terminal: false });

function send(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

rl.on('line', line => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let msg;
  try {
    msg = JSON.parse(trimmed);
  } catch {
    return;
  }
  handleMessage(msg);
});

function handleMessage(msg) {
  const { method, id, params } = msg;

  if (method === 'initialize') {
    send({
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'mock-serena', version: '0.1.0' },
      },
    });
  } else if (method === 'notifications/initialized') {
    // No response for notifications
  } else if (method === 'tools/list') {
    send({
      jsonrpc: '2.0',
      id,
      result: {
        tools: [
          {
            name: 'replace_symbol_body',
            description:
              'Replace the body of a named symbol in a source file. ' +
              'NOTE: Has a known bug with JS constant declarations — prepends an extra `const` keyword.',
            inputSchema: {
              type: 'object',
              properties: {
                path_in_project: { type: 'string', description: 'Path to the file' },
                symbol_name: { type: 'string', description: 'Name of the symbol to replace' },
                new_body: { type: 'string', description: 'New value/body content' },
              },
              required: ['path_in_project', 'symbol_name', 'new_body'],
            },
          },
        ],
      },
    });
  } else if (method === 'tools/call') {
    const { name, arguments: args } = params ?? {};
    if (name === 'replace_symbol_body') {
      handleReplaceSymbolBody(id, args ?? {});
    } else {
      send({
        jsonrpc: '2.0',
        id,
        result: {
          content: [{ type: 'text', text: `Unknown tool: ${name}` }],
          isError: true,
        },
      });
    }
  }
}

function handleReplaceSymbolBody(id, { path_in_project, symbol_name, new_body }) {
  try {
    const content = readFileSync(path_in_project, 'utf8');

    // Bug (oraios/serena#1029): prepends "const " when reconstructing a constant
    // declaration, producing `const const SYMBOL = value` — a syntax error.
    const buggyContent = content.replace(
      new RegExp(`const\\s+${symbol_name}\\s*=\\s*[^;\\n]+`),
      `const const ${symbol_name} = ${new_body}`
    );

    writeFileSync(path_in_project, buggyContent);

    send({
      jsonrpc: '2.0',
      id,
      result: {
        content: [{ type: 'text', text: `Updated symbol '${symbol_name}' in ${path_in_project}` }],
      },
    });
  } catch (err) {
    send({
      jsonrpc: '2.0',
      id,
      result: {
        content: [{ type: 'text', text: `Error: ${err.message}` }],
        isError: true,
      },
    });
  }
}
