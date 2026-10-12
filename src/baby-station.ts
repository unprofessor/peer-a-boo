import { Peer } from 'peerjs';
import type { MediaConnection } from 'peerjs';
import QRCode from 'qrcode';
import { requestWakeLock, stopMediaStream, enumerateMediaDevices, querySelectorOrThrow, peerServerOptions } from './utils';

/**
 * Handle for cleaning up the baby station's resources.
 */
export interface CleanupHandle {
    cleanup: () => void;
}

/**
 * Initializes the baby station, which streams camera and microphone to a parent station.
 * @param container - The HTML element to render the baby station UI into
 * @param roomId - The ID of the room to host
 * @returns A promise that resolves to a cleanup handle
 */
export async function initBabyStation(
    container: HTMLElement,
    roomId: string
): Promise<CleanupHandle> {
    const wakeLockHandle = await requestWakeLock();
    let stream: MediaStream | null = null;
    let peer: Peer | null = null;
    let activeCall: MediaConnection | null = null;
    let deviceChangeHandler: (() => void) | null = null;
    let retryTimeout: ReturnType<typeof setTimeout> | null = null;
    let isCleaningUp = false;
    const retryDelay = 5000;

    const cleanup = () => {
        isCleaningUp = true;
        if (retryTimeout) {
            clearTimeout(retryTimeout);
            retryTimeout = null;
        }
        if (deviceChangeHandler) {
            navigator.mediaDevices.removeEventListener('devicechange', deviceChangeHandler);
            deviceChangeHandler = null;
        }
        if (activeCall) {
            activeCall.close();
            activeCall = null;
        }
        if (peer) {
            peer.destroy();
            peer = null;
        }
        stopMediaStream(stream);
        stream = null;
        wakeLockHandle?.release();
        console.log('Baby Station cleaned up');
    };

    container.innerHTML = `
    <div class="full-screen-video-container">
        <video id="local-video" autoplay muted playsinline></video>
    </div>
    
    <div class="ui-layer">
        <div class="ui-header">
            <div id="status-badge" class="status-badge">
                <div class="status-dot"></div>
                <span id="status-text">Initializing...</span>
            </div>
            <button id="settings-btn" class="btn-icon" aria-label="Settings">
                ⚙️
            </button>
        </div>
        
        <div id="settings-drawer" class="settings-drawer">
            <div class="drawer-header">
                <button id="close-settings" class="close-btn">×</button>
                <h3 class="drawer-title">Baby Station Settings</h3>
            </div>
            
            <div class="device-selection">
                <div class="device-select-group">
                    <label for="camera-select">Camera</label>
                    <select id="camera-select"></select>
                </div>
                <div class="device-select-group">
                    <label for="microphone-select">Microphone</label>
                    <select id="microphone-select"></select>
                </div>
            </div>

            <div id="id-display" class="hidden">
                <div class="qr-panel">
                    <canvas id="qr-code"></canvas>
                    <div style="margin-top: 1rem;">
                        <div style="font-size: 0.875rem; color: #666; margin-bottom: 0.5rem;">Room ID</div>
                        <div id="peer-id" style="font-family: monospace; font-size: 1.5rem; font-weight: 700; letter-spacing: 0.05em;"></div>
                    </div>
                </div>
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

    const idDisplayEl = querySelectorOrThrow<HTMLElement>(container, '#id-display');
    const roomIdEl = querySelectorOrThrow<HTMLElement>(container, '#peer-id');
    const videoEl = querySelectorOrThrow<HTMLVideoElement>(container, '#local-video');
    const canvasEl = querySelectorOrThrow<HTMLCanvasElement>(container, '#qr-code');
    const cameraSelect = querySelectorOrThrow<HTMLSelectElement>(container, '#camera-select');
    const micSelect = querySelectorOrThrow<HTMLSelectElement>(container, '#microphone-select');
    
    const settingsDrawer = querySelectorOrThrow<HTMLElement>(container, '#settings-drawer');
    const settingsBtn = querySelectorOrThrow<HTMLButtonElement>(container, '#settings-btn');
    const closeSettingsBtn = querySelectorOrThrow<HTMLButtonElement>(container, '#close-settings');

    settingsBtn.addEventListener('click', () => {
        settingsDrawer.classList.toggle('open');
    });

    closeSettingsBtn.addEventListener('click', () => {
        settingsDrawer.classList.remove('open');
    });

    async function populateDevices() {
        const currentCamera = cameraSelect!.value;
        const currentMic = micSelect!.value;

        const devices = await enumerateMediaDevices();

        console.log('Enumerated devices:', devices);

        cameraSelect!.innerHTML = devices.cameras
            .map(d => `<option value="${d.deviceId}">${d.label}</option>`)
            .join('');

        micSelect!.innerHTML = devices.microphones
            .map(d => `<option value="${d.deviceId}">${d.label}</option>`)
            .join('');

        if (currentCamera && devices.cameras.some(d => d.deviceId === currentCamera)) {
            cameraSelect!.value = currentCamera;
        }
        if (currentMic && devices.microphones.some(d => d.deviceId === currentMic)) {
            micSelect!.value = currentMic;
        }
    }

    async function startStream(preferBackCamera = false): Promise<MediaStream> {
        stopMediaStream(stream);

        let videoConstraints: MediaTrackConstraints | boolean = true;
        if (cameraSelect!.value) {
            videoConstraints = { deviceId: { exact: cameraSelect!.value } };
        } else if (preferBackCamera) {
            videoConstraints = { facingMode: { ideal: 'environment' } };
        }

        const constraints: MediaStreamConstraints = {
            video: videoConstraints,
            audio: micSelect!.value
                ? { deviceId: { exact: micSelect!.value } }
                : true
        };

        stream = await navigator.mediaDevices.getUserMedia(constraints);
        videoEl!.srcObject = stream;

        if (activeCall) {
            const videoTrack = stream.getVideoTracks()[0];
            const audioTrack = stream.getAudioTracks()[0];
            const senders = activeCall.peerConnection?.getSenders();
            senders?.forEach(sender => {
                if (sender.track?.kind === 'video' && videoTrack) {
                    sender.replaceTrack(videoTrack);
                } else if (sender.track?.kind === 'audio' && audioTrack) {
                    sender.replaceTrack(audioTrack);
                }
            });
        }

        return stream;
    }

    cameraSelect.addEventListener('change', () => {
        startStream().catch(err => {
            console.error('Failed to switch camera', err);
            updateStatus('Error switching camera: ' + (err as Error).message, false);
        });
    });

    micSelect.addEventListener('change', () => {
        startStream().catch(err => {
            console.error('Failed to switch microphone', err);
            updateStatus('Error switching microphone: ' + (err as Error).message, false);
        });
    });

    deviceChangeHandler = () => {
        populateDevices().catch(err => console.error('Failed to refresh devices', err));
    };
    navigator.mediaDevices.addEventListener('devicechange', deviceChangeHandler);

    try {
        await populateDevices();

        const currentStream = await startStream(true);

        await populateDevices();

        const videoTrack = currentStream.getVideoTracks()[0];
        const audioTrack = currentStream.getAudioTracks()[0];
        if (videoTrack) {
            const settings = videoTrack.getSettings();
            if (settings.deviceId) {
                cameraSelect.value = settings.deviceId;
            }
        }
        if (audioTrack) {
            const settings = audioTrack.getSettings();
            if (settings.deviceId) {
                micSelect.value = settings.deviceId;
            }
        }

        updateStatus('Connecting...', false);
        initPeer();
    } catch (err) {
        console.error('Failed to get local stream', err);
        updateStatus('Camera error: ' + (err as Error).message, false);
    }

    /**
     * Restores the signaling connection once the retry delay passes.
     * Parents place new calls through the server, so the baby station
     * stays registered under the room ID for its whole lifetime.
     */
    function scheduleRecovery() {
        if (isCleaningUp || retryTimeout) {
            return;
        }
        retryTimeout = setTimeout(() => {
            retryTimeout = null;
            if (!peer || peer.destroyed) {
                // An `unavailable-id` error destroys the peer; the server frees
                // the ID once it notices the old connection is gone.
                initPeer();
            } else if (peer.disconnected) {
                peer.reconnect();
            }
        }, retryDelay);
    }

    function initPeer() {
        peer = new Peer(roomId, peerServerOptions());

        peer.on('open', (id) => {
            if (activeCall) {
                updateStatus('Streaming Live', true);
            } else {
                updateStatus('Waiting for parent...', true);
                settingsDrawer.classList.add('open');
            }
            idDisplayEl.classList.remove('hidden');
            roomIdEl.textContent = id;

            const url = new URL(window.location.href);
            url.searchParams.set('roomId', id);
            url.searchParams.set('station', 'parent');

            QRCode.toCanvas(canvasEl, url.toString(), { width: 200, margin: 1 }, (error) => {
                if (error) console.error(error);
            });
        });

        peer.on('call', (call) => {
            console.log('Incoming call from parent...');
            console.log('Stream tracks:', stream?.getTracks().map(t => `${t.kind}: ${t.label} (enabled: ${t.enabled})`));
            updateStatus('Streaming Live', true);
            settingsDrawer.classList.remove('open');

            if (activeCall && activeCall !== call) {
                activeCall.close();
            }
            activeCall = call;

            let callClosed = false;
            const handleCallTerminated = (message?: string) => {
                if (callClosed) return;
                callClosed = true;
                if (activeCall === call) {
                    activeCall = null;
                }
                updateStatus(message ?? 'Parent disconnected', false);
                settingsDrawer.classList.add('open');
            };

            call.on('close', () => handleCallTerminated());
            call.on('error', (err) => {
                console.error('Call error', err);
                handleCallTerminated('Call error. Waiting...');
            });

            call.answer(stream!);
        });

        peer.on('disconnected', () => {
            console.log('Disconnected from signaling server');
            scheduleRecovery();
        });

        peer.on('error', (err) => {
            console.error(err);
            updateStatus('Error: ' + err.type + '. Reconnecting...', false);
            scheduleRecovery();
        });
    }

    return { cleanup };
}
