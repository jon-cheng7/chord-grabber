// Chord previews: a soft piano-ish voicing, bass plus chord in the middle

import { chordNotes } from './reharm.ts';

let ctx: AudioContext | null = null;

const hz = (midi: number): number => 440 * 2 ** ((midi - 69) / 12);

function note(at: number, midi: number, length: number, level: number): void {
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.value = hz(midi);
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(level, at + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + length);
    osc.connect(gain).connect(ctx.destination);
    osc.start(at);
    osc.stop(at + length);
}

/** one after another, each held for a beat or so */
export function playChords(names: readonly string[], each = 0.75): void {
    ctx ??= new AudioContext();
    void ctx.resume();
    const start = ctx.currentTime + 0.05;
    names.forEach((name, i) => {
        const { bass, tones } = chordNotes(name);
        if (!tones.length) return;
        const at = start + i * each;
        note(at, 36 + bass, each * 1.6, 0.18);
        // chord tones stacked upward from G3
        for (const t of tones) note(at, 55 + ((t - 7 + 12) % 12), each * 1.4, 0.1);
    });
}
