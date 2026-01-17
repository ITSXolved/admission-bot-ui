
import { useState, useRef, useCallback } from "react";

export interface AudioRecorderHook {
    isRecording: boolean;
    startRecording: () => Promise<void>;
    stopRecording: () => void;
    hasPermission: boolean;
}

export function useAudioRecorder(onDataAvailable: (data: string) => void): AudioRecorderHook {
    const [isRecording, setIsRecording] = useState(false);
    const [hasPermission, setHasPermission] = useState(false);
    const audioContextRef = useRef<AudioContext | null>(null);
    const mediaStreamRef = useRef<MediaStream | null>(null);
    const processorRef = useRef<ScriptProcessorNode | null>(null);
    const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);

    const startRecording = useCallback(async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            mediaStreamRef.current = stream;
            setHasPermission(true);

            // Create AudioContext (must be 16kHz to match server requirement ideally, 
            // but browsers might enforce hardware rate. We will downsample if needed.)
            // Note: Setting sampleRate in constructor is improved in modern browsers.
            const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({
                sampleRate: 16000,
            });
            audioContextRef.current = audioContext;

            const source = audioContext.createMediaStreamSource(stream);
            sourceRef.current = source;

            // Use ScriptProcessorNode (deprecated but easiest for raw PCM access without extra worklet files)
            // Buffer size 4096 provides decent latency/performance balance
            const processor = audioContext.createScriptProcessor(4096, 1, 1);
            processorRef.current = processor;

            processor.onaudioprocess = (e) => {
                const inputData = e.inputBuffer.getChannelData(0);

                // Convert Float32 to Int16
                const pcmData = new Int16Array(inputData.length);
                for (let i = 0; i < inputData.length; i++) {
                    // Clamp values to [-1, 1] and scale to 16-bit integer range
                    const s = Math.max(-1, Math.min(1, inputData[i]));
                    pcmData[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
                }

                // Convert to Base64
                const buffer = pcmData.buffer;
                let binary = '';
                const bytes = new Uint8Array(buffer);
                const len = bytes.byteLength;
                for (let i = 0; i < len; i++) {
                    binary += String.fromCharCode(bytes[i]);
                }
                const base64Data = window.btoa(binary);

                onDataAvailable(base64Data);
            };

            source.connect(processor);
            processor.connect(audioContext.destination); // Needed for Chrome to activate processor

            setIsRecording(true);
        } catch (error) {
            console.error("Error starting recording:", error);
            setHasPermission(false);
        }
    }, [onDataAvailable]);

    const stopRecording = useCallback(() => {
        if (processorRef.current) {
            processorRef.current.disconnect();
            processorRef.current = null;
        }
        if (sourceRef.current) {
            sourceRef.current.disconnect();
            sourceRef.current = null;
        }
        if (mediaStreamRef.current) {
            mediaStreamRef.current.getTracks().forEach((track) => track.stop());
            mediaStreamRef.current = null;
        }
        if (audioContextRef.current) {
            audioContextRef.current.close();
            audioContextRef.current = null;
        }
        setIsRecording(false);
    }, []);

    return {
        isRecording,
        startRecording,
        stopRecording,
        hasPermission,
    };
}
