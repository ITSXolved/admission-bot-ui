/**
 * AudioWorkletProcessor for high-performance audio capture
 * Optimized for Mobile: Downsampling and Int16 conversion happen here.
 */

export const AUDIO_PROCESSOR_CODE = `
class AudioProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.targetSampleRate = 16000;
        this.vadThreshold = 0.02;
        this.chunkSize = 256; // Extreme low latency (approx 16ms)
        
        // Buffers
        this.buffer = new Float32Array(this.chunkSize);
        this.bufferIndex = 0;
        
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
        
        if (rms > this.vadThreshold) {
            this.port.postMessage({ type: 'vad_signal' });
        }
        
        // Send volume for visualization (throttle to every ~64ms or just send every chunk)
        // Since chunk is 64ms now, sending every chunk is fine.
        this.port.postMessage({ type: 'volume', data: rms });

        // 2. Downsampling (Linear Interpolation)
        // Ratio: input / target (e.g. 48000 / 16000 = 3)
        const ratio = inputSampleRate / this.targetSampleRate;
        
        // We iterate over the *output* frames we want to generate
        // 'residue' tracks where we are in the input buffer (sub-sample precision)
        
        let outputIndex = 0;
        
        // While we have enough input data to generate an output sample
        while (this.residue < channelData.length) {
            
            // Linear Interpolation:
            // index of sample before: floor(residue)
            // index of sample after: ceil(residue)
            // weight: residue - floor(residue)
            
            const i = Math.floor(this.residue);
            const decimal = this.residue - i;
            
            // Boundary checks
            const s0 = channelData[i];
            const s1 = (i + 1 < channelData.length) ? channelData[i+1] : s0; // Clamp to end
            
            // Interpolate
            const result = s0 + (s1 - s0) * decimal;
            
            // Output to buffer
            this.buffer[this.bufferIndex++] = result;
            
            // If buffer full, flush
            if (this.bufferIndex >= this.chunkSize) {
                this.flush();
            }
            
            // Advance
            this.residue += ratio; 
        }
        
        // Keep the fractional part of residue for next process call, 
        // effectively "wrapping" the input index to the next chunk.
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
