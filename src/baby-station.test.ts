import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { FakeMediaConnection, fakeMediaStream, peers } from './fake-peerjs';
import { initBabyStation } from './baby-station';
import type { CleanupHandle } from './baby-station';

vi.mock('peerjs', () => import('./fake-peerjs'));
vi.mock('qrcode', () => ({ default: { toCanvas: vi.fn() } }));

const ROOM_ID = 'BlueOtterNap1234';
// Longer than the baby station's retry delay.
const RETRY_WINDOW_MS = 8_000;

let container: HTMLElement;
let handle: CleanupHandle | null = null;
let localStream: MediaStream;

async function startBaby() {
    handle = await initBabyStation(container, ROOM_ID);
    peers[0].connect();
    return peers[0];
}

function statusText() {
    return container.querySelector('#status-text')?.textContent;
}

beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    localStream = fakeMediaStream();
    vi.stubGlobal('navigator', {
        mediaDevices: {
            getUserMedia: vi.fn().mockResolvedValue(localStream),
            enumerateDevices: vi.fn().mockResolvedValue([]),
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
        },
    });
    container = document.createElement('div');
    document.body.append(container);
});

afterEach(() => {
    handle?.cleanup();
    handle = null;
    container.remove();
    peers.length = 0;
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
});

describe('baby station reconnection', () => {
    test('reconnects to the signaling server until it succeeds', async () => {
        const peer = await startBaby();

        peer.loseSignaling();
        await vi.advanceTimersByTimeAsync(RETRY_WINDOW_MS);
        expect(peer.reconnect).toHaveBeenCalledTimes(1);

        peer.loseSignaling();
        await vi.advanceTimersByTimeAsync(RETRY_WINDOW_MS);
        expect(peer.reconnect).toHaveBeenCalledTimes(2);

        peer.connect();
        expect(statusText()).toBe('Waiting for parent...');
    });

    test('claims the room again when the server still holds its ID', async () => {
        handle = await initBabyStation(container, ROOM_ID);

        peers[0].fail('unavailable-id');
        await vi.advanceTimersByTimeAsync(RETRY_WINDOW_MS);

        expect(peers).toHaveLength(2);
        expect(peers[1].id).toBe(ROOM_ID);

        peers[1].connect();
        const call = new FakeMediaConnection('parent');
        peers[1].emit('call', call);
        expect(call.answer).toHaveBeenCalledWith(localStream);
    });

    test('keeps reporting a live stream across a signaling reconnect', async () => {
        const peer = await startBaby();
        peer.emit('call', new FakeMediaConnection('parent'));

        peer.loseSignaling();
        await vi.advanceTimersByTimeAsync(RETRY_WINDOW_MS);
        peer.connect();

        expect(statusText()).toBe('Streaming Live');
    });

    test('stops retrying after cleanup', async () => {
        await startBaby();

        handle?.cleanup();
        handle = null;
        await vi.advanceTimersByTimeAsync(60_000);

        expect(peers).toHaveLength(1);
        expect(peers[0].reconnect).not.toHaveBeenCalled();
    });
});

describe('baby station signaling server', () => {
    test('registers with the server named by VITE_PEER_*', async () => {
        vi.stubEnv('VITE_PEER_HOST', 'localhost');
        vi.stubEnv('VITE_PEER_PORT', '9000');

        await startBaby();

        expect(peers[0].options).toEqual({ host: 'localhost', port: 9000 });
    });
});
