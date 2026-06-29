import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

describe('i18n completeness', () => {
  it('keeps supported locale keys aligned with English', () => {
    const output = execFileSync('ruby', ['scripts/check-i18n-completeness.rb'], {
      cwd: process.cwd(),
      encoding: 'utf8'
    });

    expect(output).toContain('i18n completeness ok');
  });
});
