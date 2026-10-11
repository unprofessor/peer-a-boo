import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { expect, test } from 'vitest';
import { PEERJS_VERSION } from './fake-peerjs';

test('installed peerjs is the version the fake models', () => {
    const manifestPath = createRequire(import.meta.url).resolve('peerjs/package.json');
    const { version } = JSON.parse(readFileSync(manifestPath, 'utf8'));

    expect(
        version,
        `src/fake-peerjs.ts models PeerJS ${PEERJS_VERSION}; re-check its transitions against ${version}, then update PEERJS_VERSION`,
    ).toBe(PEERJS_VERSION);
});
