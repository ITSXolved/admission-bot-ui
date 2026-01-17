/**
 * AudioWorkletProcessor for high-performance audio capture
 * Optimized for Mobile: Downsampling and Int16 conversion happen here.
 */

export const AUDIO_PROCESSOR_CODE = `
class AudioProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.targetSampleRate = 16000;
        this.vadThreshold = 0.005; // Robust Sensitivity (Filters fan noise)
        this.chunkSize = 512; // 32ms Fast Polling

        // Buffers
        this.buffer = new Float32Array(this.chunkSize);
        this.bufferIndex = 0;
        this.volumeSkipCounter = 0; // Throttle visualizer
        
        // Resampling state
        this.residue = 0;
    }

    process(inputs, outputs, parameters) {
        const input = inputs[0];
        if (!input || !input.length) return true;
        
        const channelData = input[0]; // Mono input
        const inputSampleRate = sampleRate; // Global from AudioWorkletScope

        // 1. VAD (Barge-in) - Calculate on raw input for speed
        let sum = 0;
        for (let i = 0; i < channelData.length; i++) {
            sum += channelData[i] * channelData[i];
        }
        const rms = Math.sqrt(sum / channelData.length);
        
        // Priority: Send VAD signal immediately
        if (rms > this.vadThreshold) {
            this.port.postMessage({ type: 'vad_signal' });
        }
        
        // Send volume for visualization (Throttled)
        // Only send every 3rd chunk (~200ms) to prevent Main Thread flooding
        this.volumeSkipCounter++;
        if (this.volumeSkipCounter >= 3) {
            this.port.postMessage({ type: 'volume', data: rms });
            this.volumeSkipCounter = 0;
        }

        // 2. Downsampling (Nearest Neighbor)
        // Ratio: input / target
        const ratio = inputSampleRate / this.targetSampleRate;
        
        // Optimize: Fast path for 16kHz -> 16kHz (No resampling needed)
        if (ratio === 1) {
             for (let i = 0; i < channelData.length; i++) {
                this.buffer[this.bufferIndex++] = channelData[i];
                if (this.bufferIndex >= this.chunkSize) {
                    this.flush();
                }
            }
            return true;
        }

        // Universal Fast Downsampling (Nearest Neighbor)
        // O(N) for ANY sample rate (44.1k, 48k, 88.2k, 96k)
        // "Residue" tracks our position in the input buffer
        while (this.residue < channelData.length) {
            
            // Just pick the sample at the current position
            // No interpolation math = Fast
            const i = Math.floor(this.residue);
            
            if (i < channelData.length) {
                this.buffer[this.bufferIndex++] = channelData[i];
                
                if (this.bufferIndex >= this.chunkSize) {
                    this.flush();
                }
            }
            
            // Advance by the ratio
            this.residue += ratio; 
        }
        
        // Keep the fractional/overflow part for next chunk
        this.residue -= channelData.length;
        
        return true;
    }
    
    flush() {
        // Convert Float32 buffer to Int16
        const int16Data = new Int16Array(this.chunkSize);
        
        for (let i = 0; i < this.chunkSize; i++) {
            const s = Math.max(-1, Math.min(1, this.buffer[i])); // Clamp [-1, 1]
            int16Data[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }
        
        // Send to main thread
        // We accept that we are copying data here. 
        // For max perf, we could transfer the buffer but then we'd need multiple buffers.
        this.port.postMessage({ 
            type: 'audio_data', 
            data: int16Data 
        });
        
        this.bufferIndex = 0;
    }
}

registerProcessor('audio-processor', AudioProcessor);
`;
