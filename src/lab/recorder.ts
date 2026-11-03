// A take as it's sung: the mic's pitch and audio, a tap at every chord change.
// The lab taps by hand; the song view taps as playback steps, chord and all

import { capture } from '../capture.ts';
import type { Frame } from '../listen/summary.ts';
import { AUDIO_RATE, encode, putTake, resample, type Take } from './takes.ts';

export interface Recording {
    take: Take;
    /** a chord change, now; with the chord when it's known */
    tap(chord?: string): void;
    /** stops, keeps the audio, saves */
    finish(): Promise<Take>;
}

export async function recordTake(
    about: { song?: string; key?: string },
    onFrame?: (f: Frame) => void,
): Promise<Recording | 'denied' | 'unsupported'> {
    const chunks: Float32Array[] = [];
    let chunkAt = 0;
    const take: Take = {
        version: 2,
        at: new Date().toISOString(),
        device: navigator.userAgent,
        song: about.song,
        key: about.key,
        frames: [],
        taps: [],
    };
    const names: string[] = [];
    const live = await capture(
        (f) => {
            take.frames.push(f);
            onFrame?.(f);
        },
        (pcm, at) => {
            if (!chunks.length) chunkAt = at;
            chunks.push(pcm);
        },
    );
    if (typeof live === 'string') return live;
    let done: Promise<Take> | null = null;
    return {
        take,
        tap(chord) {
            if (done) return;
            take.taps.push(live.now());
            if (chord) names.push(chord);
        },
        finish() {
            done ??= (async () => {
                take.stop = live.now();
                live.stop();
                if (names.length) take.chords = names.join(' ');
                if (chunks.length) {
                    const pcm = await resample(chunks, live.rate, AUDIO_RATE);
                    take.audio = { rate: AUDIO_RATE, at: chunkAt, pcm: encode(pcm) };
                }
                await putTake(take);
                return take;
            })();
            return done;
        },
    };
}
