import { describe, it, expect } from 'vitest';
import { add, multiply } from './utils.js';

describe('math utils', () => {
  it('adds two numbers', () => {
    expect(add(2, 3)).toBe(5);
  });

  it('multiplies two numbers', () => {
    expect(multiply(3, 4)).toBe(12);
  });
});
