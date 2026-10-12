import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { fakeMediaStream, peers } from './fake-peerjs';
import { initParentStation } from './parent-station';
import type { CleanupHandle } from './parent-station';

vi.mock('peerjs', () => import('./fake-peerjs'));

const ROOM_ID = 'BlueOtterNap1234';
// Longer than the parent's randomized retry delay (5-7.5s).
const RETRY_WINDOW_MS = 8_000;

class FakeAudioContext {
    state = 'running';
    createOscillator = () => ({ connect: vi.fn(), start: vi.fn() });
    createGain = () => ({ gain: { value: 1 }, connect: vi.fn() });
    createMediaStreamDestination = () => ({ stream: fakeMediaStream() });
    close = vi.fn();
}

let container: HTMLElement;
let handle: CleanupHandle | null = null;

async function startParent() {
    handle = await initParentStation(container, ROOM_ID);
    peers[0].connect();
    return peers[0].calls[0];
}

function statusText() {
    return container.querySelector('#status-text')?.textContent;
}

beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal('AudioContext', FakeAudioContext);
    vi.stubGlobal('MediaStream', class {
        getTracks = () => [];
        getAudioTracks = () => [];
    });
    HTMLCanvasElement.prototype.captureStream = () => fakeMediaStream();
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockRejectedValue(new Error('autoplay blocked'));
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

describe('parent station reconnection', () => {
    test('re-registers with the signaling server after losing it mid-call', async () => {
        const firstCall = await startParent();
        firstCall.receiveStream();

        peers[0].loseSignaling();
        firstCall.failIce();
        await vi.advanceTimersByTimeAsync(RETRY_WINDOW_MS);

        expect(peers).toHaveLength(2);
        peers[1].connect();
        expect(peers[1].call).toHaveBeenCalledWith(ROOM_ID, expect.anything());
    });

    test('leaves a live call alone when only the signaling server drops', async () => {
        const firstCall = await startParent();
        firstCall.receiveStream();

        peers[0].loseSignaling();
        await vi.advanceTimersByTimeAsync(60_000);

        expect(firstCall.close).not.toHaveBeenCalled();
        expect(peers).toHaveLength(1);
        expect(peers[0].call).toHaveBeenCalledTimes(1);
        expect(statusText()).toContain('Connected');
    });

    test('abandons and redials a call the baby station never answers', async () => {
        const firstCall = await startParent();

        await vi.advanceTimersByTimeAsync(30_000);

        expect(firstCall.close).toHaveBeenCalled();
        expect(peers[0].calls.length).toBeGreaterThan(1);
    });

    test('redials when the media connection stalls', async () => {
        const firstCall = await startParent();
        firstCall.receiveStream();

        firstCall.emit('iceStateChanged', 'disconnected');
        await vi.advanceTimersByTimeAsync(30_000);

        expect(firstCall.close).toHaveBeenCalled();
        expect(peers[0].calls.length).toBeGreaterThan(1);
    });

    test('keeps the call when the media connection recovers on its own', async () => {
        const firstCall = await startParent();
        firstCall.receiveStream();

        firstCall.emit('iceStateChanged', 'disconnected');
        await vi.advanceTimersByTimeAsync(3_000);
        firstCall.emit('iceStateChanged', 'connected');
        await vi.advanceTimersByTimeAsync(60_000);

        expect(firstCall.close).not.toHaveBeenCalled();
        expect(peers[0].calls).toHaveLength(1);
    });

    test('ignores late events from a call it already replaced', async () => {
        const firstCall = await startParent();
        firstCall.failIce();
        await vi.advanceTimersByTimeAsync(RETRY_WINDOW_MS);
        const secondCall = peers[0].calls[1];
        secondCall.receiveStream();

        firstCall.emit('close');
        await vi.advanceTimersByTimeAsync(30_000);

        expect(secondCall.close).not.toHaveBeenCalled();
        expect(peers[0].calls).toHaveLength(2);
    });
});

describe('parent station signaling server', () => {
    test('connects to the server named by VITE_PEER_*', async () => {
        vi.stubEnv('VITE_PEER_HOST', 'localhost');
        vi.stubEnv('VITE_PEER_PORT', '9000');

        await startParent();

        expect(peers[0].options).toEqual({ host: 'localhost', port: 9000 });
    });
});
