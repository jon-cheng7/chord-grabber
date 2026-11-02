// On the audio thread: a pitch every 32 ms posted to the page, and in the lab the raw signal too

import { framer } from './listen/track.ts';

// the worklet's own globals
declare const sampleRate: number;
declare const currentTime: number;
declare function registerProcessor(name: string, processor: unknown): void;
declare class AudioWorkletProcessor {
    readonly port: MessagePort;
}

// the raw signal goes over in chunks this long, not every 128 samples
const CHUNK = 8192;

class Listen extends AudioWorkletProcessor {
    private frames = framer(sampleRate, (f) => this.port.postMessage(f));
    private record = false;
    private chunk = new Float32Array(CHUNK);
    private filled = 0;
    private chunkAt = 0;

    constructor() {
        super();
        this.port.onmessage = (e: MessageEvent) => {
            this.record = e.data === 'record';
        };
    }

    process(inputs: Float32Array[][]): boolean {
        const input = inputs[0]?.[0];
        if (!input) return true;
        this.frames.push(input, currentTime);
        if (this.record) this.keep(input);
        return true;
    }

    /** the lab keeps takes as audio: passed on whole, stamped with when they started */
    private keep(input: Float32Array): void {
        for (let i = 0; i < input.length; i++) {
            if (!this.filled) this.chunkAt = currentTime + i / sampleRate;
            this.chunk[this.filled++] = input[i]!;
            if (this.filled < CHUNK) continue;
            this.port.postMessage({ pcm: this.chunk, at: this.chunkAt }, [
                this.chunk.buffer,
            ]);
            this.chunk = new Float32Array(CHUNK);
            this.filled = 0;
        }
    }
}

registerProcessor('cg-listen', Listen);
