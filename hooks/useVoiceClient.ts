import { useState, useEffect, useRef, useCallback } from 'react';
import { base64ToFloat32 } from '../utils/audioUtils';
import { AUDIO_PROCESSOR_CODE } from './audioProcessor';

const SEND_SAMPLE_RATE = 16000;
const RECEIVE_SAMPLE_RATE = 22000;
const CHUNK_SIZE = 4096; // Browser AudioProcessor buffer size
// Use the production URL as verified from client.py
const WEBSOCKET_URL = "wss://admission-bot-166647007319.asia-southeast1.run.app";

// VAD Threshold - Adjust based on microphone sensitivity
// Move VAD logic primarily to Worklet, but keep threshold here if needed for config? 
// Actually Worklet has it hardcoded for now, or we can pass it via parameters.
const VAD_THRESHOLD = 0.02;

type VoiceClientStatus = 'disconnected' | 'connecting' | 'connected' | 'error';
type SpeakingState = 'idle' | 'listening' | 'speaking';

export function useVoiceClient() {
    const [status, setStatus] = useState<VoiceClientStatus>('disconnected');
    const [speakingState, setSpeakingState] = useState<SpeakingState>('idle');
    const [error, setError] = useState<string | null>(null);
    const [lastTranscript, setLastTranscript] = useState<{ source: 'user' | 'assistant', text: string } | null>(null);
    const [volume, setVolume] = useState<number>(0);

    // Track if AI is currently queueing/playing audio to prevent premature "listening" state
    const isAIRespondingRef = useRef<boolean>(false);

    const wsRef = useRef<WebSocket | null>(null);
    const audioContextRef = useRef<AudioContext | null>(null);
    const mediaStreamRef = useRef<MediaStream | null>(null);
    const workletNodeRef = useRef<AudioWorkletNode | null>(null);
    const nextStartTimeRef = useRef<number>(0);
    const activeSourceNodesRef = useRef<AudioBufferSourceNode[]>([]);

    const connect = useCallback(() => {
        if (wsRef.current?.readyState === WebSocket.OPEN) return;

        setStatus('connecting');
        setError(null);

        const ws = new WebSocket(WEBSOCKET_URL);
        wsRef.current = ws;

        ws.onopen = () => {
            setStatus('connected');
            // Start session immediately upon connection
            ws.send(JSON.stringify({
                type: "start_session",
                user_language: "english"
            }));
        };

        ws.onclose = () => {
            setStatus('disconnected');
            setSpeakingState('idle');
            isAIRespondingRef.current = false;
        };

        ws.onerror = (e) => {
            console.error("WebSocket error:", e);
            setStatus('error');
            setError("Connection failed");
        };

        ws.onmessage = async (event) => {
            try {
                const data = JSON.parse(event.data);

                if (data.type === 'session_started') {
                    console.log("Session started");
                } else if (data.type === 'audio') {
                    isAIRespondingRef.current = true;
                    setSpeakingState('speaking');
                    playAudio(data.data);
                } else if (data.type === 'transcription') {
                    setLastTranscript({
                        source: data.source,
                        text: data.text
                    });
                } else if (data.type === 'turn_complete') {
                    // Only switch to idle if we aren't waiting for audio to finish
                    // But typically audio messages come before turn_complete.
                    // We'll rely on playAudio's onended or a check to reset state.
                    // Actually, let's just mark that the 'turn' is done, but 
                    // effective 'listening' state transition happens when audio finishes.
                    if (!isAIRespondingRef.current) {
                        setSpeakingState('idle');
                    }
                }
            } catch (err) {
                console.error("Error parsing message:", err);
            }
        };
    }, []);

    const disconnect = useCallback(() => {
        stopRecording();
        if (wsRef.current) {
            wsRef.current.close();
        }
        wsRef.current = null;

        // Stop audio context immediately
        if (audioContextRef.current) {
            try {
                audioContextRef.current.suspend();
                audioContextRef.current.close();
            } catch (e) {
                console.error("Error closing audio context:", e);
            }
            audioContextRef.current = null;
        }

        setStatus('disconnected');
        isAIRespondingRef.current = false;
    }, []);

    const stopAudioPlayback = useCallback(() => {
        // Stop all currently playing audio nodes
        activeSourceNodesRef.current.forEach(source => {
            try {
                source.stop();
            } catch (e) {
                // Ignore errors if already stopped
            }
        });
        activeSourceNodesRef.current = [];

        // Reset timing
        if (audioContextRef.current) {
            nextStartTimeRef.current = audioContextRef.current.currentTime;
        }

        // Reset state
        isAIRespondingRef.current = false;
        setSpeakingState((prev) => prev === 'speaking' ? 'listening' : prev);
        // Force back to listening immediately if we interrupted
        if (speakingState === 'speaking') {
            setSpeakingState('listening'); // Or 'idle', but 'listening' implies we are hearing the user
        }
    }, [speakingState]);

    const startRecording = useCallback(async () => {
        try {
            if (!audioContextRef.current) {
                audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
            }

            const ctx = audioContextRef.current;
            if (ctx.state === 'suspended') {
                await ctx.resume();
            }

            // Mobile Optimization: Disable software processing to reduce latency
            // Also remove 'ideal' sample rate to avoid browser-side resampling overhead
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: false,
                    noiseSuppression: false,
                    autoGainControl: false,
                    channelCount: 1
                }
            });
            mediaStreamRef.current = stream;

            const source = ctx.createMediaStreamSource(stream);

            // Setup AudioWorklet
            const blob = new Blob([AUDIO_PROCESSOR_CODE], { type: "application/javascript" });
            const processorUrl = URL.createObjectURL(blob);

            try {
                await ctx.audioWorklet.addModule(processorUrl);
            } catch (e) {
                console.error("Failed to load audio worklet:", e);
            }

            const workletNode = new AudioWorkletNode(ctx, 'audio-processor');
            workletNodeRef.current = workletNode;

            workletNode.port.onmessage = (event) => {
                const { type, data, sourceSampleRate } = event.data;

                if (type === 'vad_signal') {
                    if (isAIRespondingRef.current) {
                        console.log("Barge-in detected via Worklet!");
                        stopAudioPlayback();
                    }
                } else if (type === 'volume') {
                    // Update volume state for visualization
                    // processing high rate messages might trigger too many renders, but React 18 batching helps.
                    // For smoother UI, maybe throttle this? 
                    // Or just set state, since the worklet sends it every 64ms (15fps), which is perfect for UI.
                    setVolume(data);
                } else if (type === 'audio_data') {
                    if (wsRef.current?.readyState !== WebSocket.OPEN) return;

                    // Data is already Int16Array from worklet
                    const int16Data = data;

                    // Convert to Base64 (Efficient string building)
                    // Handling large arrays with String.fromCharCode(...arg) can stack overflow
                    // chunkSize is 4096, which is usually safe, but loop is safer for mobile memory
                    let binary = '';
                    const bytes = new Uint8Array(int16Data.buffer);
                    const len = bytes.byteLength;
                    for (let i = 0; i < len; i++) {
                        binary += String.fromCharCode(bytes[i]);
                    }
                    const b64 = window.btoa(binary);

                    wsRef.current.send(JSON.stringify({
                        type: "audio",
                        data: b64
                    }));
                }
            };

            source.connect(workletNode);
            workletNode.connect(ctx.destination);

            setSpeakingState('listening');
        } catch (err) {
            console.error("Microphone error:", err);
            setError("Microphone access denied");
        }
    }, []);

    const stopRecording = useCallback(() => {
        if (mediaStreamRef.current) {
            mediaStreamRef.current.getTracks().forEach(track => track.stop());
            mediaStreamRef.current = null;
        }
        if (workletNodeRef.current) {
            workletNodeRef.current.port.onmessage = null; // Cleanup handler
            workletNodeRef.current.disconnect();
            workletNodeRef.current = null;
        }
        setSpeakingState('idle');
    }, []);

    const playAudio = useCallback((base64Data: string) => {
        if (!audioContextRef.current) return;
        const ctx = audioContextRef.current;

        // Decode audio
        const float32Data = base64ToFloat32(base64Data);

        const buffer = ctx.createBuffer(1, float32Data.length, RECEIVE_SAMPLE_RATE);
        buffer.getChannelData(0).set(float32Data);

        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(ctx.destination);

        // Track the source node
        activeSourceNodesRef.current.push(source);

        // Simple scheduling to play buffers in sequence
        const currentTime = ctx.currentTime;
        // If nextStartTime is in the past, reset it (gap in audio)
        if (nextStartTimeRef.current < currentTime) {
            nextStartTimeRef.current = currentTime;
        }

        source.start(nextStartTimeRef.current);
        nextStartTimeRef.current += buffer.duration;

        source.onended = () => {
            // Remove from active nodes
            activeSourceNodesRef.current = activeSourceNodesRef.current.filter(s => s !== source);

            // Check if this was likely the last chunk
            const timeRemaining = nextStartTimeRef.current - ctx.currentTime;
            if (timeRemaining <= 0.1) { // Buffer nearing empty
                isAIRespondingRef.current = false;
                // Delay slightly to ensure smooth transition
                setTimeout(() => {
                    setSpeakingState((prev) => prev === 'speaking' ? 'idle' : prev);
                }, 100);
            }
        };
    }, []);

    useEffect(() => {
        return () => {
            disconnect();
            if (audioContextRef.current) {
                audioContextRef.current.close();
            }
        };
    }, [disconnect]);

    const initAudioSession = useCallback(async () => {
        try {
            if (!audioContextRef.current) {
                audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
            }
            if (audioContextRef.current.state === 'suspended') {
                await audioContextRef.current.resume();
            }
            return true;
        } catch (e) {
            console.error("Audio Init Failed:", e);
            return false;
        }
    }, []);

    return {
        status,
        speakingState,
        error,
        lastTranscript,
        volume,
        connect,
        disconnect,
        startRecording,
        stopRecording,
        initAudioSession
    };
}
