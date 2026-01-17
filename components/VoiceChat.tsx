'use client';

import React, { useEffect, useState, useRef } from 'react';
import { useVoiceClient } from '../hooks/useVoiceClient';
import { Mic, MicOff, Phone, PhoneOff, Clock } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const SESSION_DURATION = 30 * 60; // 30 minutes in seconds

export default function VoiceChat() {
    const {
        status,
        speakingState,
        error,
        lastTranscript,
        connect,
        disconnect,
        startRecording,
        stopRecording,
        initAudioSession,
        volume
    } = useVoiceClient();

    const [timeLeft, setTimeLeft] = useState(SESSION_DURATION);
    const [isActive, setIsActive] = useState(false);

    useEffect(() => {
        let interval: NodeJS.Timeout;
        if (isActive && timeLeft > 0) {
            interval = setInterval(() => {
                setTimeLeft((prev) => prev - 1);
            }, 1000);
        } else if (timeLeft === 0) {
            handleStop();
        }
        return () => clearInterval(interval);
    }, [isActive, timeLeft]);

    const handleStart = async () => {
        // Critical for Mobile: Init AudioContext on User Gesture
        const audioReady = await initAudioSession();
        if (!audioReady) {
            console.error("Audio Context failed to start");
            return;
        }

        setIsActive(true);
        connect();
        // Wait for connection? Or just let hook handle it. 
        // Ideally we wait for 'connected' status but for now we trust the flow.
    };

    // Auto-start recording when connected
    useEffect(() => {
        if (status === 'connected' && isActive) {
            startRecording();
        }
    }, [status, isActive, startRecording]);

    const handleStop = () => {
        setIsActive(false);
        stopRecording();
        disconnect();
        setTimeLeft(SESSION_DURATION);
    };

    const formatTime = (seconds: number) => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    };

    return (
        <div className="flex flex-col items-center justify-center min-h-screen bg-slate-900 text-white p-4 font-sans relative overflow-hidden">

            {/* Background decoration */}
            {/* Background decoration - Simplified for Performance */}
            <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none z-0">
                <div className="absolute top-[-10%] right-[-10%] w-[500px] h-[500px] bg-blue-900/10 rounded-full" />
                <div className="absolute bottom-[-10%] left-[-10%] w-[500px] h-[500px] bg-purple-900/10 rounded-full" />
            </div>

            <div className="z-10 w-full max-w-md flex flex-col items-center gap-8">

                {/* Header / Timer */}
                <div className="flex items-center gap-2 =text-2xl font-light tracking-wider opacity-80">
                    <Clock className="w-6 h-6" />
                    <span>{formatTime(timeLeft)}</span>
                </div>

                {/* Status Display */}
                <div className="h-16 flex items-center justify-center">
                    {error ? (
                        <span className="text-red-400">{error}</span>
                    ) : (
                        <span className="text-slate-400 animate-pulse uppercase tracking-widest text-sm">
                            {status === 'connected' ? (speakingState === 'speaking' ? 'Admission Bot Speaking' : 'Listening...') : (isActive ? 'Connecting...' : 'Ready')}
                        </span>
                    )}
                </div>

                {/* Main Interaction Area */}
                <div className="relative group">

                    {/* Ripple Animations when active */}
                    {/* Optimized Ripple Animation */}
                    {isActive && status === 'connected' && (
                        <motion.div
                            className="absolute inset-0 bg-blue-500 rounded-full opacity-20"
                            animate={{
                                scale: speakingState === 'speaking' ? [1, 1.2] : [1, 1 + Math.min(volume * 10, 1.5)],
                                opacity: [0.4, 0]
                            }}
                            transition={{ duration: speakingState === 'speaking' ? 2 : 0.5, repeat: Infinity, ease: "easeOut" }}
                        />
                    )}

                    <button
                        onClick={isActive ? handleStop : handleStart}
                        className={`
              relative z-10 w-40 h-40 rounded-full flex items-center justify-center shadow-2xl transition-all duration-300
              ${isActive
                                ? 'bg-red-500 hover:bg-red-600 shadow-red-500/50'
                                : 'bg-blue-600 hover:bg-blue-500 shadow-blue-500/50'
                            }
            `}
                    >
                        {isActive ? (
                            <PhoneOff className="w-16 h-16 text-white" />
                        ) : (
                            <Phone className="w-16 h-16 text-white" />
                        )}
                    </button>
                </div>

                {/* Transcript Area */}
                <div className="w-full h-32 flex flex-col items-center justify-center text-center px-4 space-y-2">
                    <AnimatePresence mode="wait">
                        {lastTranscript && isActive && (
                            <motion.div
                                key={lastTranscript.text}
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -10 }}
                                className={`text-lg font-medium leading-relaxed ${lastTranscript.source === 'user' ? 'text-blue-300' : 'text-purple-300'}`}
                            >
                                "{lastTranscript.text}"
                            </motion.div>
                        )}
                    </AnimatePresence>
                    {!isActive && (
                        <p className="text-slate-500 text-sm">Click the button to start the admission session.</p>
                    )}
                </div>
            </div>
        </div>
    );
}
