// One voice, frame by frame: the signal thinned to 16 kHz, a pitch and a loudness every 32 ms.
// The same steps run live on the audio thread and later on a saved take, so both hear alike

import type { Frame } from './summary.ts';
import { yin } from './yin.ts';

// plenty for a voice: its notes sit well under 1 kHz
const RATE = 16000;
// 64 ms frames, a new one every 32 ms
const SIZE = 1024;
const HOP = 512;

export interface Framer {
    /** at: the clock time of block[0] */
    push(block: Float32Array, at: number): void;
}

export function framer(rate: number, emit: (f: Frame) => void): Framer {
    const step = Math.max(1, Math.round(rate / RATE));
    const thin = rate / step;
    const frame = new Float32Array(SIZE);
    const scratch = new Float32Array(SIZE >> 1);
    let filled = 0;
    let sum = 0;
    let count = 0;
    return {
        push(block, at) {
            for (let i = 0; i < block.length; i++) {
                // averaging each run is a cheap low-pass before thinning
                sum += block[i]!;
                if (++count < step) continue;
                frame[filled++] = sum / count;
                sum = 0;
                count = 0;
                if (filled < SIZE) continue;
                const p = yin(frame, thin, scratch);
                // loudness of the newest hop: a dip and rise is a new syllable
                let energy = 0;
                for (let k = SIZE - HOP; k < SIZE; k++)
                    energy += frame[k]! * frame[k]!;
                emit({
                    // stamped at the frame's middle
                    t: at + i / rate - SIZE / 2 / thin,
                    hz: p?.hz ?? 0,
                    clarity: p?.clarity ?? 0,
                    level: Math.sqrt(energy / HOP),
                    // takes are kept: no more digits than matter
                    cands: (p?.cands ?? []).map(
                        (x) => Math.round(x * 1000) / 1000,
                    ),
                });
                frame.copyWithin(0, HOP);
                filled = SIZE - HOP;
            }
        },
    };
}

/** a whole recording at once; at is when its first sample was heard */
export function track(samples: Float32Array, rate: number, at = 0): Frame[] {
    const out: Frame[] = [];
    framer(rate, (f) => out.push(f)).push(samples, at);
    return out;
}
