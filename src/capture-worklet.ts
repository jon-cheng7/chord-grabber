// On the audio thread: the mic thinned to 16 kHz, a pitch every 32 ms posted to the page

import { yin } from './listen/yin.ts';

// the worklet's own globals
declare const sampleRate: number;
declare const currentTime: number;
declare function registerProcessor(name: string, processor: unknown): void;
declare class AudioWorkletProcessor {
    readonly port: MessagePort;
}

// plenty for a voice: its notes sit well under 1 kHz
const RATE = 16000;
// 64 ms frames, a new one every 32 ms
const SIZE = 1024;
const HOP = 512;

class Listen extends AudioWorkletProcessor {
    private step = Math.max(1, Math.round(sampleRate / RATE));
    private rate = sampleRate / this.step;
    private frame = new Float32Array(SIZE);
    private scratch = new Float32Array(SIZE >> 1);
    private filled = 0;
    private sum = 0;
    private count = 0;

    process(inputs: Float32Array[][]): boolean {
        const input = inputs[0]?.[0];
        if (!input) return true;
        for (let i = 0; i < input.length; i++) {
            // averaging each run is a cheap low-pass before thinning
            this.sum += input[i]!;
            if (++this.count < this.step) continue;
            this.frame[this.filled++] = this.sum / this.count;
            this.sum = 0;
            this.count = 0;
            if (this.filled < SIZE) continue;
            const p = yin(this.frame, this.rate, this.scratch);
            // loudness of the newest hop: a dip and rise is a new syllable
            let energy = 0;
            for (let k = SIZE - HOP; k < SIZE; k++)
                energy += this.frame[k]! * this.frame[k]!;
            // stamped at the frame's middle, on the context's clock
            const t = currentTime + i / sampleRate - SIZE / 2 / this.rate;
            this.port.postMessage({
                t,
                hz: p?.hz ?? 0,
                clarity: p?.clarity ?? 0,
                level: Math.sqrt(energy / HOP),
            });
            this.frame.copyWithin(0, HOP);
            this.filled = SIZE - HOP;
        }
        return true;
    }
}

registerProcessor('cg-listen', Listen);
