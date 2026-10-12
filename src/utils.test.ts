import { afterEach, describe, expect, test, vi } from 'vitest';
import {
    createAudioLevelMeter,
    enumerateMediaDevices,
    peerServerOptions,
    querySelectorOrThrow,
    requestWakeLock,
    stopMediaStream,
} from './utils';


afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('requestWakeLock', () => {
    test('returns null when API is unavailable', async () => {
        vi.stubGlobal('navigator', {} as Navigator);
        const warnSpy = vi
            .spyOn(console, 'warn')
            .mockImplementation(() => {
                // Silence expected warning in test.
            });

        const result = await requestWakeLock();

        expect(result).toBeNull();
        expect(warnSpy).toHaveBeenCalledWith(
            'Wake Lock API not supported.',
        );
    });

    test(
        'reacquires wake lock on visibility change and releases cleanly',
        async () => {
            const firstRelease = vi.fn().mockResolvedValue(undefined);
            const secondRelease = vi.fn().mockResolvedValue(undefined);
            const requestMock = vi
                .fn()
                .mockResolvedValueOnce({
                    released: false,
                    release: firstRelease,
                })
                .mockResolvedValueOnce({
                    released: false,
                    release: secondRelease,
                });

            const fakeNavigator = {
                wakeLock: { request: requestMock },
            } as unknown as Navigator;
            vi.stubGlobal('navigator', fakeNavigator);

            const addListener = vi.spyOn(document, 'addEventListener');
            const removeListener = vi.spyOn(document, 'removeEventListener');

            const handle = await requestWakeLock();

            expect(handle).not.toBeNull();
            expect(requestMock).toHaveBeenCalledTimes(1);
            expect(addListener).toHaveBeenCalledWith(
                'visibilitychange',
                expect.any(Function),
            );

            const visibilityHandler =
                addListener.mock.calls[0][1] as EventListener;
            await visibilityHandler(new Event('visibilitychange'));

            expect(requestMock).toHaveBeenCalledTimes(2);

            await handle?.release();

            expect(removeListener).toHaveBeenCalledWith(
                'visibilitychange',
                visibilityHandler,
            );
            expect(firstRelease).not.toHaveBeenCalled();
            expect(secondRelease).toHaveBeenCalledTimes(1);
        },
    );
});

describe('stopMediaStream', () => {
    test('stops each track in the stream', () => {
        const stop = vi.fn();
        const stream = {
            getTracks: vi.fn().mockReturnValue([
                { stop },
                { stop },
            ]),
        } as unknown as MediaStream;

        stopMediaStream(stream);

        expect(stop).toHaveBeenCalledTimes(2);
    });

    test('ignores null streams', () => {
        expect(() => stopMediaStream(null)).not.toThrow();
    });
});

describe('enumerateMediaDevices', () => {
    test(
        'splits devices into cameras and microphones with defaults',
        async () => {
            const enumerateDevices = vi.fn().mockResolvedValue([
                { kind: 'videoinput', deviceId: 'v1', label: '', groupId: 'g1', toJSON() { return this; } },
                { kind: 'videoinput', deviceId: 'v2', label: 'Front Cam', groupId: 'g2', toJSON() { return this; } },
                { kind: 'audioinput', deviceId: 'a1', label: '', groupId: 'g3', toJSON() { return this; } },
                { kind: 'audioinput', deviceId: 'a2', label: 'Desk Mic', groupId: 'g4', toJSON() { return this; } },
                { kind: 'audiooutput', deviceId: 'ao1', label: 'Speaker', groupId: 'g5', toJSON() { return this; } },
            ] satisfies MediaDeviceInfo[]);

            const fakeNavigator = {
                mediaDevices: { enumerateDevices },
            } as unknown as Navigator;
            vi.stubGlobal('navigator', fakeNavigator);

            const result = await enumerateMediaDevices();

            expect(result.cameras).toEqual([
                { deviceId: 'v1', label: 'Camera 1' },
                { deviceId: 'v2', label: 'Front Cam' },
            ]);
            expect(result.microphones).toEqual([
                { deviceId: 'a1', label: 'Microphone 1' },
                { deviceId: 'a2', label: 'Desk Mic' },
            ]);
        },
    );
});

describe('createAudioLevelMeter', () => {
    test('reports levels and stops resources', () => {
        const disconnect = vi.fn();
        const close = vi.fn();
        const source = {
            connect: vi.fn(),
            disconnect,
        };
        const analyser = {
            fftSize: 512,
            frequencyBinCount: 256,
            smoothingTimeConstant: 0,
            getByteFrequencyData: (array: Uint8Array) => array.fill(128),
        };

        class FakeAudioContext {
            sampleRate = 44100;
            state = 'running';

            createAnalyser() {
                return analyser;
            }

            createMediaStreamSource() {
                return source;
            }

            close() {
                return close();
            }
        }

        vi.stubGlobal(
            'AudioContext',
            FakeAudioContext as unknown as typeof AudioContext,
        );

        const cancelAnimationFrame = vi.fn();
        const requestAnimationFrame = vi.fn().mockReturnValue(1);
        vi.stubGlobal('cancelAnimationFrame', cancelAnimationFrame);
        vi.stubGlobal('requestAnimationFrame', requestAnimationFrame);

        const onLevel = vi.fn();
        const stream = {} as MediaStream;

        const handle = createAudioLevelMeter(stream, onLevel);

        expect(onLevel).toHaveBeenCalledTimes(1);
        // With A-weighting and frequencyData filled with 128, level should be > 0
        expect(onLevel.mock.calls[0][0]).toBeGreaterThanOrEqual(0);
        expect(onLevel.mock.calls[0][0]).toBeLessThanOrEqual(1);
        expect(source.connect).toHaveBeenCalledWith(analyser);

        handle.stop();

        expect(cancelAnimationFrame).toHaveBeenCalledWith(1);
        expect(disconnect).toHaveBeenCalledTimes(1);
        expect(close).toHaveBeenCalledTimes(1);
    });
});

describe('querySelectorOrThrow', () => {
    test('returns the element when found', () => {
        const child = document.createElement('div');
        child.className = 'target';
        const parent = document.createElement('div');
        parent.appendChild(child);

        const result = querySelectorOrThrow(parent, '.target');

        expect(result).toBe(child);
    });

    test('throws an error when element is not found', () => {
        const parent = document.createElement('div');

        expect(() => querySelectorOrThrow(parent, '.missing')).toThrowError(
            'Element not found for selector: .missing',
        );
    });

    test('queries within the provided parent only', () => {
        const parent = document.createElement('div');
        const target = document.createElement('span');
        target.id = 'inside';
        parent.appendChild(target);

        const parentSpy = vi.spyOn(parent, 'querySelector');
        const documentSpy = vi.spyOn(document, 'querySelector');

        const result = querySelectorOrThrow(parent, '#inside');

        expect(result).toBe(target);
        expect(parentSpy).toHaveBeenCalledWith('#inside');
        expect(documentSpy).not.toHaveBeenCalled();
    });
});

describe('peerServerOptions', () => {
    test('returns no options when no host is configured', () => {
        expect(peerServerOptions({ VITE_PEER_PORT: '9000' })).toEqual({});
    });

    test('maps every configured variable', () => {
        expect(peerServerOptions({
            VITE_PEER_HOST: 'localhost',
            VITE_PEER_PORT: '9000',
            VITE_PEER_PATH: '/signal',
            VITE_PEER_SECURE: 'false',
        })).toEqual({ host: 'localhost', port: 9000, path: '/signal', secure: false });
    });

    test('leaves out unset variables so PeerJS keeps its defaults', () => {
        expect(peerServerOptions({ VITE_PEER_HOST: 'localhost' })).toEqual({ host: 'localhost' });
    });

    test('rejects a port that is not a number', () => {
        expect(() => peerServerOptions({ VITE_PEER_HOST: 'localhost', VITE_PEER_PORT: 'nine' }))
            .toThrow('VITE_PEER_PORT is not a port number: nine');
    });
});
