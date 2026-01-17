export const convertFloat32ToInt16 = (buffer: Float32Array): Int16Array => {
  let l = buffer.length;
  const buf = new Int16Array(l);
  while (l--) {
    // Clamp to [-1, 1]
    const s = Math.max(-1, Math.min(1, buffer[l]));
    // Scale to Int16 range
    buf[l] = s < 0 ? s * 0x8000 : s * 0x7FFF;
  }
  return buf;
};

export const downsampleBuffer = (
  buffer: Float32Array,
  sampleRate: number,
  outSampleRate: number
): Float32Array => {
  if (outSampleRate === sampleRate) {
    return buffer;
  }
  if (outSampleRate > sampleRate) {
    throw new Error("downsampling rate show be smaller than original sample rate");
  }
  const sampleRateRatio = sampleRate / outSampleRate;
  const newLength = Math.round(buffer.length / sampleRateRatio);
  const result = new Float32Array(newLength);
  let offsetResult = 0;
  let offsetBuffer = 0;
  while (offsetResult < result.length) {
    const nextOffsetBuffer = Math.round((offsetResult + 1) * sampleRateRatio);
    let accum = 0,
      count = 0;
    for (
      let i = offsetBuffer;
      i < nextOffsetBuffer && i < buffer.length;
      i++
    ) {
      accum += buffer[i];
      count++;
    }
    result[offsetResult] = accum / count;
    offsetResult++;
    offsetBuffer = nextOffsetBuffer;
  }
  return result;
};

export const floatTo16BitPCM = (
  input: Float32Array,
  sampleRate: number,
  targetSampleRate: number
): Int16Array => {
  const downsampled = downsampleBuffer(input, sampleRate, targetSampleRate);
  return convertFloat32ToInt16(downsampled);
};

export const base64ToFloat32 = (base64: string): Float32Array => {
  const binaryString = window.atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  
  // Convert Int16 (bytes) to Float32
  const int16Array = new Int16Array(bytes.buffer);
  const float32Array = new Float32Array(int16Array.length);
  
  for (let i = 0; i < int16Array.length; i++) {
    const int16 = int16Array[i];
    // Scale back to [-1, 1]
    float32Array[i] = int16 < 0 ? int16 / 0x8000 : int16 / 0x7FFF;
  }
  
  return float32Array;
};
