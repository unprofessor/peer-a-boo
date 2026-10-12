import { Peer } from 'peerjs';
import type { MediaConnection } from 'peerjs';
import { requestWakeLock, stopMediaStream, createAudioLevelMeter, createDecayingMeter, querySelectorOrThrow, peerServerOptions } from './utils';
import type { AudioLevelMeterHandle, DecayingMeterHandle } from './utils';
import { createMotionDetector } from './motion-detection';
import type { MotionDetectorHandle } from './motion-detection';

/**
 * Handle for cleaning up the parent station's resources.
 */
export interface CleanupHandle {
    cleanup: () => void;
}

/**
 * Initializes the parent station, which connects to a baby station to receive a stream.
 * @param container - The HTML element to render the parent station UI into
 * @param roomId - The ID of the room to join
 * @returns A promise that resolves to a cleanup handle
 */
export async function initParentStation(
    container: HTMLElement,
    roomId: string
): Promise<CleanupHandle> {
    const wakeLockHandle = await requestWakeLock();
    let peer: Peer | null = null;
    let activeCall: MediaConnection | null = null;
    let dummyStream: MediaStream | null = null;
    let dummyAudioCtx: AudioContext | null = null;
    let remoteStream: MediaStream | null = null;
    let audioMeterHandle: AudioLevelMeterHandle | null = null;
    let audioDecayHandle: DecayingMeterHandle | null = null;
    let motionDecayHandle: DecayingMeterHandle | null = null;
    let motionDetectorHandle: MotionDetectorHandle | null = null;
    let retryTimeout: ReturnType<typeof setTimeout> | null = null;
    let callWatchdog: ReturnType<typeof setTimeout> | null = null;
    let squirmingAlertTimeout: ReturnType<typeof setTimeout> | null = null;
    let cryingAlertTimeout: ReturnType<typeof setTimeout> | null = null;
    let isConnected = false;
    let isCleaningUp = false;

    const cleanup = () => {
        isCleaningUp = true;
        if (retryTimeout) {
            clearTimeout(retryTimeout);
            retryTimeout = null;
        }
        clearCallWatchdog();
        if (squirmingAlertTimeout) {
            clearTimeout(squirmingAlertTimeout);
            squirmingAlertTimeout = null;
        }
        if (cryingAlertTimeout) {
            clearTimeout(cryingAlertTimeout);
            cryingAlertTimeout = null;
        }
        if (motionDetectorHandle) {
            motionDetectorHandle.stop();
            motionDetectorHandle = null;
        }
        if (audioMeterHandle) {
            audioMeterHandle.stop();
            audioMeterHandle = null;
        }
        if (audioDecayHandle) {
            audioDecayHandle.stop();
            audioDecayHandle = null;
        }
        if (motionDecayHandle) {
            motionDecayHandle.stop();
            motionDecayHandle = null;
        }
        if (activeCall) {
            activeCall.close();
            activeCall = null;
        }
        if (peer) {
            peer.destroy();
            peer = null;
        }
        stopMediaStream(dummyStream);
        dummyStream = null;
        if (dummyAudioCtx) {
            dummyAudioCtx.close();
            dummyAudioCtx = null;
        }
        stopMediaStream(remoteStream);
        remoteStream = null;
        wakeLockHandle?.release();
        console.log('Parent Station cleaned up');
    };

    container.innerHTML = `
    <div id="video-container" class="full-screen-video-container">
        <video id="remote-video" autoplay playsinline></video>
        <div id="tap-to-play" class="tap-to-play hidden">
            <div class="tap-to-play-content">
                <span class="tap-icon">▶️</span>
                <span class="tap-text">Tap to Start Monitoring</span>
            </div>
        </div>
    </div>

    <div class="ui-layer">
        <div class="ui-header">
             <div id="status-badge" class="status-badge">
                <div class="status-dot"></div>
                <span id="status-text">Connecting...</span>
            </div>
            <button id="settings-btn" class="btn-icon" aria-label="Settings">
                ⚙️
            </button>
        </div>

        <div id="squirming-toast" class="toast">
            Squirming Detected!
        </div>
        <div id="crying-toast" class="toast toast-crying">
            Crying Detected!
        </div>

        <div class="control-bar">
            <div class="control-row">
                <span style="font-size: 1.2rem;">🔊</span>
                <div class="meter-group">
                    <div class="meter-track">
                        <div id="audio-level-meter" class="meter-fill audio"></div>
                    </div>
                </div>
            </div>
             <div class="control-row">
                <span style="font-size: 1.2rem;">🏃</span>
                <div class="meter-group">
                    <div class="meter-track">
                        <div id="squirming-level-meter" class="meter-fill motion"></div>
                    </div>
                </div>
            </div>
        </div>

        <div id="settings-drawer" class="settings-drawer">
            <div class="drawer-header">
                <button id="close-settings" class="close-btn">×</button>
                <h3 class="drawer-title">Monitor Settings</h3>
            </div>

            <div class="settings-group">
                <div class="settings-section">
                    <div style="display: flex; justify-content: space-between; margin-bottom: 0.5rem;">
                        <label for="squirming-sensitivity" style="font-weight: 500;">Squirming Sensitivity</label>
                        <span id="squirming-sensitivity-value" style="color: var(--color-primary);">50</span>
                    </div>
                    <input type="range" id="squirming-sensitivity" min="1" max="100" value="50" />
                    <div style="display: flex; justify-content: space-between; font-size: 0.8rem; color: #666;">
                        <span>Low</span>
                        <span>High</span>
                    </div>
                </div>

                <label class="pause-toggle">
                    <input type="checkbox" id="pause-squirming" style="width: 20px; height: 20px;" />
                    <span style="font-size: 1rem; font-weight: 500;">Pause Squirming Alerts</span>
                </label>
            </div>

            <div class="settings-group">
                <div class="settings-section">
                    <div style="display: flex; justify-content: space-between; margin-bottom: 0.5rem;">
                        <label for="crying-sensitivity" style="font-weight: 500;">Crying Sensitivity</label>
                        <span id="crying-sensitivity-value" style="color: var(--color-primary);">50</span>
                    </div>
                    <input type="range" id="crying-sensitivity" min="1" max="100" value="50" />
                    <div style="display: flex; justify-content: space-between; font-size: 0.8rem; color: #666;">
                        <span>Low</span>
                        <span>High</span>
                    </div>
                </div>

                <label class="pause-toggle">
                    <input type="checkbox" id="pause-crying" style="width: 20px; height: 20px;" />
                    <span style="font-size: 1rem; font-weight: 500;">Pause Crying Alerts</span>
                </label>
            </div>

            <div style="margin-top: 2rem; font-size: 0.8rem; color: #666; text-align: center;">
                Room ID: <span style="font-family: monospace;">${roomId}</span>
            </div>
        </div>
    </div>
  `;

    const statusTextEl = querySelectorOrThrow<HTMLElement>(container, '#status-text');
    const statusDotEl = querySelectorOrThrow<HTMLElement>(container, '#status-badge .status-dot');

    const updateStatus = (text: string, active: boolean) => {
        statusTextEl.textContent = text;
        if (active) statusDotEl.classList.add('active');
        else statusDotEl.classList.remove('active');
    };

    const statusEl = {
        set textContent(value: string) {
            updateStatus(value, value.includes('Connected') || value.includes('Monitoring'));
        }
    };

    const videoContainer = querySelectorOrThrow<HTMLElement>(container, '#video-container');
    const videoEl = querySelectorOrThrow<HTMLVideoElement>(container, '#remote-video');
    const tapToPlayEl = querySelectorOrThrow<HTMLElement>(container, '#tap-to-play');
    const meterEl = querySelectorOrThrow<HTMLElement>(container, '#audio-level-meter');
    const squirmingMeterEl = querySelectorOrThrow<HTMLElement>(container, '#squirming-level-meter');
    const squirmingToastEl = querySelectorOrThrow<HTMLElement>(container, '#squirming-toast');
    const cryingToastEl = querySelectorOrThrow<HTMLElement>(container, '#crying-toast');
    const squirmingSensitivitySlider = querySelectorOrThrow<HTMLInputElement>(container, '#squirming-sensitivity');
    const squirmingSensitivityValue = querySelectorOrThrow<HTMLElement>(container, '#squirming-sensitivity-value');
    const pauseSquirmingCheckbox = querySelectorOrThrow<HTMLInputElement>(container, '#pause-squirming');
    const cryingSensitivitySlider = querySelectorOrThrow<HTMLInputElement>(container, '#crying-sensitivity');
    const cryingSensitivityValue = querySelectorOrThrow<HTMLElement>(container, '#crying-sensitivity-value');
    const pauseCryingCheckbox = querySelectorOrThrow<HTMLInputElement>(container, '#pause-crying');

    const settingsDrawer = querySelectorOrThrow<HTMLElement>(container, '#settings-drawer');
    const settingsBtn = querySelectorOrThrow<HTMLButtonElement>(container, '#settings-btn');
    const closeSettingsBtn = querySelectorOrThrow<HTMLButtonElement>(container, '#close-settings');

    // Start audio meter - hoisted so both stream handler and tap-to-play can call it
    const startAudioMeter = () => {
        if (!remoteStream) return;
        if (meterEl && remoteStream.getAudioTracks().length > 0) {
            if (audioMeterHandle) {
                audioMeterHandle.stop();
            }
            if (audioDecayHandle) {
                audioDecayHandle.stop();
            }
            audioDecayHandle = createDecayingMeter(meterEl, {
                warningThreshold: 0.5,
                dangerThreshold: 0.75,
            });
            
            const cryingSensitivity = parseInt(cryingSensitivitySlider.value, 10);
            const cryingThreshold = (101 - cryingSensitivity) / 100;
            
            audioMeterHandle = createAudioLevelMeter(remoteStream, {
                onLevel: (level) => {
                    audioDecayHandle?.update(level);
                },
                onAlert: showCryingAlert,
                alertThreshold: cryingThreshold,
                alertCooldownMs: 4000,
            });
        } else if (meterEl) {
            console.warn('No audio tracks in received stream');
        }
    };

    // Handle tap-to-play for browsers that block autoplay
    tapToPlayEl.addEventListener('click', () => {
        videoEl.play()
            .then(() => {
                tapToPlayEl.classList.add('hidden');
                startAudioMeter();
            })
            .catch((e) => {
                console.error('Manual play failed:', e);
            });
    });

    settingsBtn.addEventListener('click', () => {
        settingsDrawer.classList.toggle('open');
    });

    closeSettingsBtn.addEventListener('click', () => {
        settingsDrawer.classList.remove('open');
    });

    function showSquirmingAlert() {
        squirmingToastEl.classList.add('visible');
        videoContainer.classList.add('video-alert');

        if (squirmingAlertTimeout) {
            clearTimeout(squirmingAlertTimeout);
        }
        squirmingAlertTimeout = setTimeout(() => {
            squirmingToastEl.classList.remove('visible');
            videoContainer.classList.remove('video-alert');
        }, 4000);
    }

    function showCryingAlert() {
        cryingToastEl.classList.add('visible');
        videoContainer.classList.add('video-alert');

        if (cryingAlertTimeout) {
            clearTimeout(cryingAlertTimeout);
        }
        cryingAlertTimeout = setTimeout(() => {
            cryingToastEl.classList.remove('visible');
            videoContainer.classList.remove('video-alert');
        }, 4000);
    }

    function setupMotionDetection() {
        if (motionDetectorHandle) {
            motionDetectorHandle.stop();
        }
        if (motionDecayHandle) {
            motionDecayHandle.stop();
        }

        motionDecayHandle = createDecayingMeter(squirmingMeterEl, {});

        motionDetectorHandle = createMotionDetector(videoEl, {
            onMotionLevel: (level) => {
                motionDecayHandle?.update(level);
            },
            onMotionAlert: showSquirmingAlert,
        });

        const sliderValue = parseInt(squirmingSensitivitySlider.value, 10);
        const threshold = (101 - sliderValue) / 2000;
        motionDetectorHandle.setThreshold(threshold);
        motionDetectorHandle.start();
    }

    squirmingSensitivitySlider.addEventListener('input', () => {
        const value = parseInt(squirmingSensitivitySlider.value, 10);
        squirmingSensitivityValue.textContent = String(value);
        if (motionDetectorHandle) {
            const threshold = (101 - value) / 2000;
            motionDetectorHandle.setThreshold(threshold);
        }
    });

    pauseSquirmingCheckbox.addEventListener('change', () => {
        if (motionDetectorHandle) {
            motionDetectorHandle.setPaused(pauseSquirmingCheckbox.checked);
        }
    });

    cryingSensitivitySlider.addEventListener('input', () => {
        const value = parseInt(cryingSensitivitySlider.value, 10);
        cryingSensitivityValue.textContent = String(value);
        if (audioMeterHandle) {
            const threshold = (101 - value) / 100;
            audioMeterHandle.setThreshold(threshold);
        }
    });

    pauseCryingCheckbox.addEventListener('change', () => {
        if (audioMeterHandle) {
            audioMeterHandle.setPaused(pauseCryingCheckbox.checked);
        }
    });

    videoEl.addEventListener('play', () => {
        if (!motionDetectorHandle) {
            setupMotionDetection();
        }
    });

    const minDelay = 5000;
    const randomFactor = 0.5;
    const callSetupTimeoutMs = 15000;
    const stallTimeoutMs = 10000;

    function getNextDelay(): number {
        return minDelay + Math.random() * randomFactor * minDelay;
    }

    function createDummyStream() {
        if (dummyAudioCtx) {
            dummyAudioCtx.close();
        }
        stopMediaStream(dummyStream);

        const canvas = document.createElement('canvas');
        canvas.width = 1;
        canvas.height = 1;

        const audioCtx = new AudioContext();
        dummyAudioCtx = audioCtx;
        const oscillator = audioCtx.createOscillator();
        const gainNode = audioCtx.createGain();
        gainNode.gain.value = 0;
        oscillator.connect(gainNode);
        const dest = audioCtx.createMediaStreamDestination();
        gainNode.connect(dest);
        oscillator.start();

        dummyStream = new MediaStream([
            ...canvas.captureStream().getVideoTracks(),
            ...dest.stream.getAudioTracks()
        ]);

        return dummyStream;
    }

    function scheduleRetry() {
        if (isCleaningUp) {
            return;
        }
        if (retryTimeout) {
            clearTimeout(retryTimeout);
        }
        const delay = getNextDelay();
        statusEl.textContent = `Connecting to server... Retry in ${Math.round(delay / 1000)}s`;
        retryTimeout = setTimeout(attemptCall, delay);
    }

    function clearCallWatchdog() {
        if (callWatchdog) {
            clearTimeout(callWatchdog);
            callWatchdog = null;
        }
    }

    function armCallWatchdog(delay: number, reason: string) {
        clearCallWatchdog();
        callWatchdog = setTimeout(() => dropCall(reason), delay);
    }

    /**
     * Closes the active call and schedules a redial. Clears `activeCall`
     * before closing so the call's own `close` handler treats it as stale.
     */
    function dropCall(reason: string) {
        console.warn(`Dropping call: ${reason}`);
        clearCallWatchdog();
        const call = activeCall;
        activeCall = null;
        isConnected = false;
        call?.close();
        scheduleRetry();
    }

    function attemptCall() {
        // Never redial over a live call; dropCall() clears isConnected first.
        if (isConnected) {
            return;
        }

        // A disconnected peer stays closed until reconnected, so build a new one.
        if (!peer || peer.destroyed || peer.disconnected) {
            initPeer();
            return;
        }

        if (!peer.open) {
            scheduleRetry();
            return;
        }

        console.log(`Connection open: ${peer}`);

        statusEl.textContent = `Calling Baby Station...`;

        if (activeCall) {
            const previousCall = activeCall;
            activeCall = null;
            previousCall.close();
        }

        const stream = createDummyStream();
        const call = peer.call(roomId, stream);
        activeCall = call;
        armCallWatchdog(callSetupTimeoutMs, 'Baby Station did not answer');

        call.on('iceStateChanged', (state) => {
            if (call !== activeCall) return;
            if (state === 'disconnected') {
                armCallWatchdog(stallTimeoutMs, 'Media connection stalled');
            } else if (isConnected && (state === 'connected' || state === 'completed')) {
                clearCallWatchdog();
            }
        });

        call.on('stream', (incomingStream) => {
            if (call !== activeCall) return;
            clearCallWatchdog();
            isConnected = true;
            remoteStream = incomingStream;
            console.log('Received stream tracks:', incomingStream.getTracks().map(t => `${t.kind}: ${t.label} (enabled: ${t.enabled})`));
            statusEl.textContent = 'Connected! Monitoring...';
            videoEl!.srcObject = incomingStream;

            videoEl!.play()
                .then(() => {
                    tapToPlayEl.classList.add('hidden');
                    startAudioMeter();
                })
                .catch((e) => {
                    console.error('Auto-play blocked:', e);
                    tapToPlayEl.classList.remove('hidden');
                });
        });

        call.on('close', () => {
            if (call === activeCall) dropCall('Call closed');
        });

        call.on('error', (err) => {
            console.error('Call error:', err);
            if (call === activeCall) dropCall('Call error');
        });
    }

    function initPeer() {
        if (peer) {
            // Detach first so the old peer's teardown events cannot schedule retries.
            peer.removeAllListeners();
            peer.destroy();
        }

        peer = new Peer(peerServerOptions());

        peer.on('open', () => {
            console.log('Connected to signaling server');
            attemptCall();
        });

        peer.on('disconnected', () => {
            console.log('Disconnected from signaling server');
            if (!isConnected) {
                scheduleRetry();
            }
        });

        peer.on('error', (err) => {
            console.error('Peer error:', err);
            // A live call does not depend on the signaling server.
            if (isConnected) {
                return;
            }
            statusEl.textContent = `Peer error: ${err.type}. Retrying...`;
            scheduleRetry();
        });
    }

    initPeer();

    return { cleanup };
}
