import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const SECRET_PATTERN =
  /Bearer\s+[A-Za-z0-9._-]+|sk_[A-Za-z0-9]+|patient[-_ ]?id/i;

async function readFixtureFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const contents = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);

      if (entry.isDirectory()) {
        return readFixtureFiles(path);
      }

      return [await readFile(path, 'utf8')];
    }),
  );

  return contents.flat();
}

describe('test fixtures', () => {
  it('do not contain real-looking secrets or personal data markers', async () => {
    const fixtureContents = await readFixtureFiles('test/fakes');

    expect(
      fixtureContents.some((content) => SECRET_PATTERN.test(content)),
    ).toBe(false);
  });
});
