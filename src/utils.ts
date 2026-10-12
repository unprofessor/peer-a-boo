import type { PeerOptions } from 'peerjs';

/**
 * The `VITE_PEER_*` build variables that select a signaling server.
 */
export type PeerServerEnv = Pick<
    ImportMetaEnv,
    'VITE_PEER_HOST' | 'VITE_PEER_PORT' | 'VITE_PEER_PATH' | 'VITE_PEER_SECURE'
>;

/**
 * Builds PeerJS options for the signaling server named by `VITE_PEER_*`.
 * Returns no options when `VITE_PEER_HOST` is unset, so PeerJS uses its cloud
 * server. Leaves out unset variables: PeerJS spreads options over its
 * defaults, so an `undefined` value would erase the default.
 * @param env - Build variables; defaults to `import.meta.env`
 * @returns Options for `new Peer(...)`
 * @throws Error if `VITE_PEER_PORT` is not a port number
 */
export function peerServerOptions(env: PeerServerEnv = import.meta.env): PeerOptions {
    if (!env.VITE_PEER_HOST) {
        return {};
    }

    const options: PeerOptions = { host: env.VITE_PEER_HOST };
    if (env.VITE_PEER_PORT) {
        const port = Number(env.VITE_PEER_PORT);
        if (!Number.isInteger(port) || port < 1 || port > 65535) {
            throw new Error(`VITE_PEER_PORT is not a port number: ${env.VITE_PEER_PORT}`);
        }
        options.port = port;
    }
    if (env.VITE_PEER_PATH) {
        options.path = env.VITE_PEER_PATH;
    }
    if (env.VITE_PEER_SECURE) {
        options.secure = env.VITE_PEER_SECURE === 'true';
    }
    return options;
}

/**
 * Handle returned by requestWakeLock for releasing the wake lock.
 */
export interface WakeLockHandle {
    release: () => Promise<void>;
}

/**
 * Queries for an element and throws an error if not found.
 * @param parent - The parent node to search within
 * @param selector - The CSS selector to search for
 * @returns The found element
 * @throws Error if the element is not found
 */
export function querySelectorOrThrow<E extends Element = Element>(
    parent: ParentNode,
    selector: string,
): E {
    const element = parent.querySelector<E>(selector);
    if (!element) {
        throw new Error(`Element not found for selector: ${selector}`);
    }
    return element;
}

/**
 * Requests a screen wake lock to prevent the device from sleeping.
 * Automatically re-acquires the lock when the page becomes visible again.
 * @returns A handle to release the wake lock, or null if the API is not supported or the request fails
 */
export async function requestWakeLock(): Promise<WakeLockHandle | null> {
    if (!('wakeLock' in navigator)) {
        console.warn('Wake Lock API not supported.');
        return null;
    }

    let wakeLock: WakeLockSentinel | null = null;

    const handleVisibilityChange = async () => {
        if (document.visibilityState === 'visible' && 'wakeLock' in navigator) {
            try {
                wakeLock = await navigator.wakeLock.request('screen');
                console.log('Wake Lock re-acquired');
            } catch (err) {
                console.error('Failed to re-acquire wake lock:', err);
            }
        }
    };

    try {
        wakeLock = await navigator.wakeLock.request('screen');
        console.log('Wake Lock is active!');

        document.addEventListener('visibilitychange', handleVisibilityChange);

        return {
            release: async () => {
                document.removeEventListener('visibilitychange', handleVisibilityChange);
                if (wakeLock && !wakeLock.released) {
                    await wakeLock.release();
                    console.log('Wake Lock released');
                }
                wakeLock = null;
            }
        };
    } catch (err) {
        console.error('Failed to acquire wake lock:', err);
        return null;
    }
}

/**
 * Stops all tracks in a media stream.
 * @param stream - The media stream to stop
 */
export function stopMediaStream(stream: MediaStream | null): void {
    if (stream) {
        stream.getTracks().forEach(track => track.stop());
    }
}

/**
 * Information about a media device.
 */
export interface MediaDeviceInfo {
    deviceId: string;
    label: string;
}

/**
 * Collection of available cameras and microphones.
 */
export interface MediaDevices {
    cameras: MediaDeviceInfo[];
    microphones: MediaDeviceInfo[];
}

/**
 * Enumerates available media devices (cameras and microphones).
 * @returns A promise that resolves to an object containing lists of cameras and microphones
 */
export async function enumerateMediaDevices(): Promise<MediaDevices> {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const cameras: MediaDeviceInfo[] = [];
    const microphones: MediaDeviceInfo[] = [];

    devices.forEach((device) => {
        if (device.kind === 'videoinput') {
            cameras.push({
                deviceId: device.deviceId,
                label: device.label || `Camera ${cameras.length + 1}`
            });
        } else if (device.kind === 'audioinput') {
            microphones.push({
                deviceId: device.deviceId,
                label: device.label || `Microphone ${microphones.length + 1}`
            });
        }
    });

    return { cameras, microphones };
}

/**
 * Handle for stopping an audio level meter.
 */
export interface AudioLevelMeterHandle {
    stop: () => void;
    setThreshold: (threshold: number) => void;
    setPaused: (paused: boolean) => void;
}

/**
 * Configuration options for the audio level meter.
 */
export interface AudioLevelMeterOptions {
    /** Callback for each audio level update (0-1) */
    onLevel?: (level: number) => void;
    /** Callback when audio exceeds the alert threshold */
    onAlert?: () => void;
    /** Audio level threshold for triggering alerts (0-1, default 0.5) */
    alertThreshold?: number;
    /** Cooldown period between alerts in milliseconds (default 2000) */
    alertCooldownMs?: number;
    /** Whether to apply A-weighting to emphasize baby cry frequencies (default true) */
    useAWeighting?: boolean;
}

/**
 * Attempt to compute A-weighting gain for a given frequency.
 * A-weighting emphasizes frequencies where human hearing is most sensitive (1-6kHz)
 * and attenuates low frequencies (rumble) and very high frequencies.
 * @param f - Frequency in Hz
 * @returns Linear gain multiplier
 */
function computeAWeightGain(f: number): number {
    if (f < 10) return 0;
    
    const f2 = f * f;
    const f4 = f2 * f2;
    
    const num = 12194 * 12194 * f4;
    const denom = (f2 + 20.6 * 20.6) 
        * Math.sqrt((f2 + 107.7 * 107.7) * (f2 + 737.9 * 737.9)) 
        * (f2 + 12194 * 12194);
    
    const aWeightDb = 20 * Math.log10(num / denom) + 2.0;
    return Math.pow(10, aWeightDb / 20);
}

/**
 * Precompute A-weighting gains for FFT frequency bins.
 * @param binCount - Number of frequency bins
 * @param sampleRate - Audio sample rate in Hz
 * @param fftSize - FFT size used by analyser
 * @returns Array of linear gain values for each bin
 */
function precomputeAWeights(binCount: number, sampleRate: number, fftSize: number): Float32Array {
    const weights = new Float32Array(binCount);
    const binWidth = sampleRate / fftSize;
    
    for (let i = 0; i < binCount; i++) {
        const freq = (i + 0.5) * binWidth;
        weights[i] = computeAWeightGain(freq);
    }
    
    return weights;
}

/**
 * Handle for updating and stopping a decaying meter.
 */
export interface DecayingMeterHandle {
    update: (level: number) => void;
    stop: () => void;
}

/**
 * Configuration options for a decaying meter.
 */
export interface DecayingMeterOptions {
    /** The resistance to decay in milliseconds per full meter; in other words,
     * how long it would take for the meter to fully decay from full to empty */
    decayResistance?: number;
    /** Time in milliseconds to sustain the peak level before decaying */
    sustainPeriod?: number;
    /** Level below which the meter is considered 'empty' (0-1) */
    minimumThreshold?: number;
    /** Level above which the 'warning' class is added (0-1) */
    warningThreshold?: number;
    /** Level above which the 'danger' class is added (0-1) */
    dangerThreshold?: number;
}

/**
 * Creates a decaying meter that tracks peak values and smoothly decays over time.
 * @param meterEl - The HTML element to update with meter width and color classes
 * @param options - Configuration for decay rate and color thresholds
 * @returns Handle with update() to set new levels and stop() to cleanup
 */
export function createDecayingMeter(
    meterEl: HTMLElement,
    options: DecayingMeterOptions = {}
): DecayingMeterHandle {
    const {
        decayResistance = 500,
        sustainPeriod = 250,
        minimumThreshold = 0.05,
        warningThreshold = 0.5,
        dangerThreshold = 0.75,
    } = options;

    const decayRate = 1 / decayResistance;

    let lastPeakTime = performance.now();
    let currentLevel = 0;
    let intervalId: ReturnType<typeof setInterval> | null = null;

    const applyLevel = () => {
        let meterLevel = Math.max(0, (currentLevel - minimumThreshold) / (1 - minimumThreshold));
        meterEl.style.width = `${meterLevel * 100}%`;

        meterEl.classList.remove('warning', 'danger');
        if (currentLevel > dangerThreshold) {
            meterEl.classList.add('danger');
        } else if (currentLevel > warningThreshold) {
            meterEl.classList.add('warning');
        }
    };

    const dt = 16.667; // Approximate frame time for 60fps

    intervalId = setInterval(() => {
        const now = performance.now();
        if (lastPeakTime + sustainPeriod > now) {
            return;
        }

        if (currentLevel > 0) {
            currentLevel = Math.max(0, currentLevel - dt * decayRate);
            applyLevel();
        }
    }, dt);

    return {
        update: (level: number) => {
            if (level > currentLevel) {
                currentLevel = level;
                lastPeakTime = performance.now();
                applyLevel();
            }
        },
        stop: () => {
            if (intervalId !== null) {
                clearInterval(intervalId);
                intervalId = null;
            }
        }
    };
}

/**
 * Creates an audio level meter from a media stream.
 * @param stream - The media stream to analyze
 * @param options - Configuration options including callbacks and thresholds
 * @returns Handle for stopping the meter and adjusting threshold/pause state
 */
export function createAudioLevelMeter(
    stream: MediaStream,
    options: AudioLevelMeterOptions | ((level: number) => void) = {}
): AudioLevelMeterHandle {
    const opts: AudioLevelMeterOptions = typeof options === 'function' 
        ? { onLevel: options } 
        : options;
    
    const {
        onLevel,
        onAlert,
        alertCooldownMs = 2000,
        useAWeighting = true,
    } = opts;
    
    let alertThreshold = opts.alertThreshold ?? 0.5;
    let isPaused = false;
    let lastAlertTime = 0;

    const audioContext = new AudioContext();
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.3;
    const source = audioContext.createMediaStreamSource(stream);
    source.connect(analyser);

    const binCount = analyser.frequencyBinCount;
    const frequencyData = new Uint8Array(binCount);
    const aWeights = useAWeighting 
        ? precomputeAWeights(binCount, audioContext.sampleRate, analyser.fftSize)
        : null;
    
    let animationId: number | null = null;

    const update = () => {
        analyser.getByteFrequencyData(frequencyData);

        let weightedSum = 0;
        let weightTotal = 0;
        
        for (let i = 0; i < binCount; i++) {
            const magnitude = frequencyData[i] / 255;
            const weight = aWeights ? aWeights[i] : 1;
            weightedSum += magnitude * magnitude * weight;
            weightTotal += weight;
        }
        
        const rms = Math.sqrt(weightedSum / (weightTotal || 1));
        const level = Math.min(1, rms * 2.5);

        onLevel?.(level);
        
        if (onAlert && !isPaused && level >= alertThreshold) {
            const now = Date.now();
            if (now - lastAlertTime >= alertCooldownMs) {
                lastAlertTime = now;
                onAlert();
            }
        }

        animationId = requestAnimationFrame(update);
    };

    if (audioContext.state === 'suspended') {
        audioContext.resume().then(update);
    } else {
        update();
    }

    return {
        stop: () => {
            if (animationId !== null) {
                cancelAnimationFrame(animationId);
            }
            source.disconnect();
            audioContext.close();
        },
        setThreshold: (threshold: number) => {
            alertThreshold = threshold;
        },
        setPaused: (paused: boolean) => {
            isPaused = paused;
        }
    };
}
