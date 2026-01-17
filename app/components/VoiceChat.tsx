
"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { Mic, MicOff, Volume2, User, Bot, WifiOff, Loader2 } from "lucide-react";
import { useAudioRecorder } from "../hooks/useAudioRecorder";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { motion, AnimatePresence } from "framer-motion";

export function cn(...inputs: (string | undefined | null | false)[]) {
    return twMerge(clsx(inputs));
}

type MessageType = "user" | "assistant" | "system";

interface Message {
    id: string;
    type: MessageType;
    text: string;
}

export default function VoiceChat() {
    const [status, setStatus] = useState<"disconnected" | "connecting" | "connected" | "speaking" | "listening">("disconnected");
    const [messages, setMessages] = useState<Message[]>([]);
    const [error, setError] = useState<string | null>(null);

    const websocketRef = useRef<WebSocket | null>(null);
    const audioContextRef = useRef<AudioContext | null>(null);
    // Audio Scheduling State
    const nextStartTimeRef = useRef<number>(0);

    // Initialize Audio Context for playback
    const getAudioContext = () => {
        if (!audioContextRef.current) {
            audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({
                sampleRate: 22000,
            });
        }
        return audioContextRef.current;
    };

    const scheduleAudioChunk = (base64Data: string) => {
        try {
            const ctx = getAudioContext();

            // Resume if suspended
            if (ctx.state === "suspended") {
                ctx.resume();
            }

            // Decode Base64
            const binaryString = window.atob(base64Data);
            const len = binaryString.length;
            const bytes = new Uint8Array(len);
            for (let i = 0; i < len; i++) {
                bytes[i] = binaryString.charCodeAt(i);
            }

            // Convert 16-bit PCM to Float32
            const int16Data = new Int16Array(bytes.buffer);
            const float32Data = new Float32Array(int16Data.length);
            for (let i = 0; i < int16Data.length; i++) {
                float32Data[i] = int16Data[i] / 32768.0;
            }

            const audioBuffer = ctx.createBuffer(1, float32Data.length, 22000);
            audioBuffer.getChannelData(0).set(float32Data);

            const source = ctx.createBufferSource();
            source.buffer = audioBuffer;
            source.connect(ctx.destination);

            // Schedule playback
            const currentTime = ctx.currentTime;

            // If nextStartTime is in the past (gap in audio / start of sentence), reset it to now
            // Adding a small buffer (0.05s) to prevent immediate cutoff if slightly behind
            if (nextStartTimeRef.current < currentTime) {
                nextStartTimeRef.current = currentTime + 0.05;
            }

            source.start(nextStartTimeRef.current);

            // Update next start time
            nextStartTimeRef.current += audioBuffer.duration;

            // Visual state management
            setStatus("speaking");

        } catch (e) {
            console.error("Error scheduling audio chunk", e);
        }
    };

    const handleWebSocketMessage = useCallback((event: MessageEvent) => {
        try {
            const data = JSON.parse(event.data);

            if (data.type === "welcome") {
                setMessages(prev => [...prev, { id: Date.now().toString(), type: "system", text: data.message }]);
                setStatus("connected");
            } else if (data.type === "session_started") {
                setStatus("connected");
            } else if (data.type === "transcription") {
                const text = data.text;
                const source = data.source === "user" ? "user" : "assistant";
                if (text) {
                    setMessages(prev => {
                        // simple dedup by text content (optional)
                        const last = prev[prev.length - 1];
                        if (last && last.text === text && last.type === source) return prev;
                        return [...prev, { id: Date.now().toString(), type: source, text }];
                    });
                }
            } else if (data.type === "audio") {
                if (data.data) {
                    scheduleAudioChunk(data.data);
                }
            } else if (data.type === "turn_complete") {
                // AI finished sending packets.
                // Reset status to connected after a short delay to let audio finish
                setTimeout(() => {
                    if (audioContextRef.current && audioContextRef.current.currentTime >= nextStartTimeRef.current) {
                        setStatus("connected");
                    }
                }, 1000);
            }
        } catch (e) {
            console.error("WebSocket message error", e);
        }
    }, []);

    const connect = () => {
        if (websocketRef.current) return;

        setStatus("connecting");
        setError(null);

        const ws = new WebSocket("wss://admission-bot-166647007319.asia-southeast1.run.app");

        ws.onopen = () => {
            console.log("Connected");
            ws.send(JSON.stringify({ type: "start_session", user_language: "english" }));
        };

        ws.onmessage = handleWebSocketMessage;

        ws.onerror = (e) => {
            console.error("WebSocket error", e);
            setError("Connection failed");
            setStatus("disconnected");
        };

        ws.onclose = () => {
            console.log("Disconnected");
            setStatus("disconnected");
            websocketRef.current = null;
        };

        websocketRef.current = ws;
    };

    const { isRecording, startRecording, stopRecording, hasPermission } = useAudioRecorder((base64Data) => {
        if (websocketRef.current && websocketRef.current.readyState === WebSocket.OPEN) {
            websocketRef.current.send(JSON.stringify({
                type: "audio",
                data: base64Data
            }));
        }
    });

    const toggleRecording = async () => {
        if (status === "disconnected") {
            connect();
            return;
        }

        if (isRecording) {
            stopRecording();
            // Reset scheduling time
            nextStartTimeRef.current = 0;
            setStatus("connected");
        } else {
            // Resume AudioContext if suspended (browser policy)
            const ctx = getAudioContext();
            if (ctx.state === "suspended") {
                await ctx.resume();
            }

            startRecording();
            setStatus("listening");
        }
    };

    useEffect(() => {
        connect();
        return () => {
            websocketRef.current?.close();
        };
    }, []); // eslint-disable-line react-hooks/exhaustive-deps


    return (
        <div className="flex flex-col items-center justify-center min-h-[500px] w-full max-w-md mx-auto p-6 bg-white dark:bg-zinc-900 rounded-3xl shadow-xl border border-zinc-100 dark:border-zinc-800 relative overflow-hidden">

            {/* Background Ambience */}
            <div className="absolute inset-0 bg-gradient-to-b from-blue-50/50 to-transparent dark:from-blue-900/10 dark:to-transparent pointer-events-none" />

            {/* Header */}
            <div className="z-10 text-center mb-8">
                <h2 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-600 to-indigo-600 dark:from-blue-400 dark:to-indigo-400">
                    Admission Help Desk
                </h2>
                <p className="text-zinc-500 dark:text-zinc-400 text-sm mt-2">
                    {status === "disconnected" && "Offline"}
                    {status === "connecting" && "Connecting..."}
                    {status === "connected" && "Ready to chat"}
                    {status === "listening" && "Listening..."}
                    {status === "speaking" && "Speaking..."}
                </p>
            </div>

            {/* Visualizer / Avatar Area */}
            <div className="relative z-10 w-48 h-48 mb-8 flex items-center justify-center">
                {/* Ripples when listening/speaking */}
                <AnimatePresence>
                    {(status === "listening" || status === "speaking") && (
                        <>
                            {[1, 2, 3].map((i) => (
                                <motion.div
                                    key={i}
                                    className={cn(
                                        "absolute inset-0 rounded-full opacity-20",
                                        status === "listening" ? "bg-red-500" : "bg-blue-500"
                                    )}
                                    initial={{ scale: 0.8, opacity: 0.5 }}
                                    animate={{ scale: 1.5, opacity: 0 }}
                                    transition={{
                                        duration: 2,
                                        repeat: Infinity,
                                        delay: i * 0.4,
                                        ease: "easeOut"
                                    }}
                                />
                            ))}
                        </>
                    )}
                </AnimatePresence>

                <div className={cn(
                    "w-32 h-32 rounded-full flex items-center justify-center shadow-2xl transition-all duration-500 relative z-20",
                    status === "listening" ? "bg-red-500 scale-110" :
                        status === "speaking" ? "bg-blue-500 scale-105" :
                            "bg-zinc-100 dark:bg-zinc-800"
                )}>
                    {status === "connecting" ? (
                        <Loader2 className="w-12 h-12 text-zinc-400 animate-spin" />
                    ) : (
                        <Bot className={cn(
                            "w-12 h-12 transition-colors duration-300",
                            (status === "listening" || status === "speaking") ? "text-white" : "text-zinc-400 dark:text-zinc-500"
                        )} />
                    )}
                </div>
            </div>

            {/* Controls */}
            <button
                onClick={toggleRecording}
                disabled={status === "connecting"}
                className={cn(
                    "z-10 group relative flex items-center gap-3 px-8 py-4 rounded-full font-semibold transition-all duration-300 shadow-lg hover:shadow-xl active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed",
                    status === "listening"
                        ? "bg-red-500 text-white hover:bg-red-600"
                        : "bg-zinc-900 text-white dark:bg-white dark:text-black hover:bg-zinc-800 dark:hover:bg-zinc-200"
                )}
            >
                {status === "listening" ? (
                    <>
                        <MicOff className="w-5 h-5" />
                        <span>Stop</span>
                    </>
                ) : (
                    <>
                        <Mic className="w-5 h-5" />
                        <span>Start Speaking</span>
                    </>
                )}
            </button>

            {/* Recent Message Transcript (Optional) */}
            <div className="w-full mt-8 space-y-3 z-10 max-h-40 overflow-y-auto px-2">
                {messages.slice(-2).map((msg) => (
                    <motion.div
                        key={msg.id}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className={cn(
                            "p-3 rounded-2xl text-sm max-w-[85%]",
                            msg.type === "user" ? "ml-auto bg-blue-100 text-blue-900 dark:bg-blue-900/30 dark:text-blue-100 rounded-tr-none" :
                                msg.type === "assistant" ? "bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200 rounded-tl-none" :
                                    "mx-auto bg-transparent text-zinc-400 text-xs text-center"
                        )}
                    >
                        {msg.text}
                    </motion.div>
                ))}
            </div>

            {error && (
                <div className="absolute top-4 bg-red-100 text-red-600 px-4 py-2 rounded-full text-xs font-medium flex items-center gap-2">
                    <WifiOff className="w-3 h-3" />
                    {error}
                </div>
            )}
        </div>
    );
}
