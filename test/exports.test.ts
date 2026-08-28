import { createRequire } from 'node:module';

import { describe, expect, it } from 'vitest';

describe('package entry points', () => {
  it('resolves the ESM entry point', async () => {
    const packageName = '@intron-voice-node';
    const sdk = (await import(packageName)) as { IntronClient: unknown };

    expect(sdk.IntronClient).toBeTypeOf('function');
  });

  it('resolves the CommonJS entry point', () => {
    const require = createRequire(import.meta.url);
    const sdk = require('@intron-voice-node') as { IntronClient: unknown };

    expect(sdk.IntronClient).toBeTypeOf('function');
  });
});
