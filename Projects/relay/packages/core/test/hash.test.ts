import { describe, it, expect } from 'vitest';
import { hashContent } from '../src/hash.js';

describe('hashContent', () => {
  it('returns a prefixed sha256 hex digest', () => {
    expect(hashContent('hello')).toBe(
      'sha256:2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824'
    );
  });

  it('is byte-exact — one changed character changes the hash', () => {
    expect(hashContent('hello')).not.toBe(hashContent('hellO'));
  });

  it('does not normalise trailing whitespace', () => {
    expect(hashContent('a')).not.toBe(hashContent('a '));
  });
});
