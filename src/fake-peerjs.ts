import { vi } from 'vitest';

/**
 * Test double for the `peerjs` module. Use it with
 * `vi.mock('peerjs', () => import('./fake-peerjs'))`.
 *
 * The state transitions mirror the PeerJS release in `PEERJS_VERSION`:
 * - losing the signaling socket disconnects the peer without destroying it;
 * - an error before the first `open` destroys the peer;
 * - closing a media connection that never opened emits no `close` event;
 * - a media connection emits `iceStateChanged` on every ICE state change.
 */

/**
 * The PeerJS version this fake models. The build fails when the installed
 * version differs. Re-check each transition above against the new release's
 * source before changing this value.
 */
export const PEERJS_VERSION = '1.5.5';

type Listener = (...args: any[]) => void;

class FakeEmitter {
    private listeners = new Map<string, Listener[]>();

    on(event: string, listener: Listener): this {
        this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
        return this;
    }

    removeAllListeners(): this {
        this.listeners.clear();
        return this;
    }

    emit(event: string, ...args: unknown[]): void {
        for (const listener of this.listeners.get(event) ?? []) {
            listener(...args);
        }
    }
}

/** Every `Peer` the code under test constructed, oldest first. */
export const peers: FakePeer[] = [];

export function fakeMediaStream(): MediaStream {
    return {
        getTracks: () => [],
        getVideoTracks: () => [],
        getAudioTracks: () => [],
    } as unknown as MediaStream;
}

export class FakeMediaConnection extends FakeEmitter {
    open = false;
    peerConnection = { getSenders: () => [] };
    answer = vi.fn();
    close = vi.fn(() => {
        if (!this.open) return;
        this.open = false;
        this.emit('close');
    });

    readonly peer: string;

    constructor(peer: string) {
        super();
        this.peer = peer;
    }

    /** The remote side answers and its media arrives. */
    receiveStream(): void {
        this.open = true;
        this.emit('stream', fakeMediaStream());
    }

    /** ICE reaches `failed`, which PeerJS reports as an error followed by close. */
    failIce(): void {
        this.emit('error', { type: 'negotiation-failed' });
        this.close();
    }
}

export class FakePeer extends FakeEmitter {
    open = false;
    disconnected = false;
    destroyed = false;
    calls: FakeMediaConnection[] = [];
    private hasOpened = false;

    call = vi.fn((peerId: string, _stream: MediaStream) => {
        const call = new FakeMediaConnection(peerId);
        this.calls.push(call);
        return call;
    });

    reconnect = vi.fn(() => {
        this.disconnected = false;
    });

    destroy = vi.fn(() => {
        if (this.destroyed) return;
        this.disconnect();
        this.calls.forEach(call => call.close());
        this.destroyed = true;
        this.emit('close');
    });

    readonly id: string | undefined;

    constructor(id?: string) {
        super();
        this.id = id;
        peers.push(this);
    }

    /** The signaling server accepts the registration. */
    connect(): void {
        this.open = true;
        this.disconnected = false;
        this.hasOpened = true;
        this.emit('open', this.id ?? 'random-parent-id');
    }

    /** The signaling WebSocket drops, as on a flaky network. */
    loseSignaling(): void {
        this.emit('error', { type: 'network' });
        this.disconnect();
    }

    /** The server rejects the peer, e.g. `unavailable-id` when the ID is still held. */
    fail(type: string): void {
        this.emit('error', { type });
        if (this.hasOpened) this.disconnect();
        else this.destroy();
    }

    private disconnect(): void {
        if (this.disconnected) return;
        this.disconnected = true;
        this.open = false;
        this.emit('disconnected');
    }
}

export { FakePeer as Peer };
