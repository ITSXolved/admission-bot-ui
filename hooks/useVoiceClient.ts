import { useState, useEffect, useRef, useCallback } from 'react';
import { floatTo16BitPCM, base64ToFloat32 } from '../utils/audioUtils';

const SEND_SAMPLE_RATE = 16000;
const RECEIVE_SAMPLE_RATE = 22000;
const CHUNK_SIZE = 4096; // Browser AudioProcessor buffer size
// Use the production URL as verified from client.py
const WEBSOCKET_URL = "wss://admission-bot-166647007319.asia-southeast1.run.app";

type VoiceClientStatus = 'disconnected' | 'connecting' | 'connected' | 'error';
type SpeakingState = 'idle' | 'listening' | 'speaking';

export function useVoiceClient() {
    const [status, setStatus] = useState<VoiceClientStatus>('disconnected');
    const [speakingState, setSpeakingState] = useState<SpeakingState>('idle');
    const [error, setError] = useState<string | null>(null);
    const [lastTranscript, setLastTranscript] = useState<{ source: 'user' | 'assistant', text: string } | null>(null);

    const wsRef = useRef<WebSocket | null>(null);
    const audioContextRef = useRef<AudioContext | null>(null);
    const mediaStreamRef = useRef<MediaStream | null>(null);
    const processorRef = useRef<ScriptProcessorNode | null>(null);
    const nextStartTimeRef = useRef<number>(0);

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
                    playAudio(data.data);
                    setSpeakingState('speaking');
                } else if (data.type === 'transcription') {
                    setLastTranscript({
                        source: data.source,
                        text: data.text
                    });
                } else if (data.type === 'turn_complete') {
                    setSpeakingState('idle');
                }
            } catch (err) {
                console.error("Error parsing message:", err);
            }
        };
    }, []);

    const disconnect = useCallback(() => {
        stopRecording();
        wsRef.current?.close();
        wsRef.current = null;
        setStatus('disconnected');
    }, []);

    const startRecording = useCallback(async () => {
        try {
            if (!audioContextRef.current) {
                audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
            }

            const ctx = audioContextRef.current;
            if (ctx.state === 'suspended') {
                await ctx.resume();
            }

            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    channelCount: 1,
                    sampleRate: { ideal: SEND_SAMPLE_RATE }
                }
            });
            mediaStreamRef.current = stream;

            const source = ctx.createMediaStreamSource(stream);
            // Deprecated but still widely supported for simple PCM access
            const processor = ctx.createScriptProcessor(CHUNK_SIZE, 1, 1);
            processorRef.current = processor;

            processor.onaudioprocess = (e) => {
                if (wsRef.current?.readyState !== WebSocket.OPEN) return;

                const inputData = e.inputBuffer.getChannelData(0);
                // Downsample and convert to Int16
                const pcmData = floatTo16BitPCM(inputData, ctx.sampleRate, SEND_SAMPLE_RATE);

                // Convert to Base64
                // We can use a more efficient way but for simplicity:
                let binary = '';
                const bytes = new Uint8Array(pcmData.buffer);
                for (let i = 0; i < bytes.byteLength; i++) {
                    binary += String.fromCharCode(bytes[i]);
                }
                const b64 = window.btoa(binary);

                wsRef.current.send(JSON.stringify({
                    type: "audio",
                    data: b64
                }));
            };

            source.connect(processor);
            processor.connect(ctx.destination);

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
        if (processorRef.current) {
            processorRef.current.disconnect();
            processorRef.current = null;
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

        // Simple scheduling to play buffers in sequence
        const currentTime = ctx.currentTime;
        // If nextStartTime is in the past, reset it (gap in audio)
        if (nextStartTimeRef.current < currentTime) {
            nextStartTimeRef.current = currentTime;
        }

        source.start(nextStartTimeRef.current);
        nextStartTimeRef.current += buffer.duration;

        source.onended = () => {
            // Maybe check if queue is empty?
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

    return {
        status,
        speakingState,
        error,
        lastTranscript,
        connect,
        disconnect,
        startRecording,
        stopRecording
    };
}
