// Chord sound: a small FM electric piano, voice-led from chord to chord

import { chordNotes } from './reharm.ts';

let ctx: AudioContext | null = null;
let out: AudioNode | null = null;

/** decaying noise as a room: cheap reverb without a file */
function room(c: AudioContext): ConvolverNode {
    const length = Math.floor(c.sampleRate * 1.8);
    const buffer = c.createBuffer(2, length, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
        const data = buffer.getChannelData(ch);
        for (let i = 0; i < length; i++)
            data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** 3;
    }
    const verb = c.createConvolver();
    verb.buffer = buffer;
    return verb;
}

function audio(): AudioContext {
    if (ctx && out) return ctx;
    const c = new AudioContext();
    const master = c.createDynamicsCompressor();
    master.threshold.value = -18;
    master.ratio.value = 3;
    master.connect(c.destination);
    const verb = room(c);
    const wet = c.createGain();
    wet.gain.value = 0.18;
    verb.connect(wet).connect(master);
    const dry = c.createGain();
    dry.connect(master);
    dry.connect(verb);
    ctx = c;
    out = dry;
    return c;
}

const hz = (midi: number): number => 440 * 2 ** ((midi - 69) / 12);

interface Voice {
    stop(at: number): void;
}

/** carrier + slow modulator for body, fast modulator for the tine ping */
function ePiano(midi: number, at: number, level: number): Voice {
    const c = audio();
    const f = hz(midi);
    const carrier = c.createOscillator();
    carrier.frequency.value = f;

    const body = c.createOscillator();
    body.frequency.value = f;
    const bodyDepth = c.createGain();
    // bright attack mellowing out, less so up high
    const depth = f * (midi > 72 ? 1.2 : 2.2);
    bodyDepth.gain.setValueAtTime(depth, at);
    bodyDepth.gain.exponentialRampToValueAtTime(depth * 0.12, at + 1.2);
    body.connect(bodyDepth).connect(carrier.frequency);

    const tine = c.createOscillator();
    tine.frequency.value = f * 14;
    const tineDepth = c.createGain();
    tineDepth.gain.setValueAtTime(f * 0.9, at);
    tineDepth.gain.exponentialRampToValueAtTime(0.01, at + 0.08);
    tine.connect(tineDepth).connect(carrier.frequency);

    const amp = c.createGain();
    amp.gain.setValueAtTime(0, at);
    amp.gain.linearRampToValueAtTime(level, at + 0.006);
    amp.gain.exponentialRampToValueAtTime(level * 0.35, at + 1.5);
    amp.gain.exponentialRampToValueAtTime(level * 0.08, at + 6);
    carrier.connect(amp).connect(out!);

    // a ringing note dies out by itself; stop only fades it sooner
    for (const o of [carrier, body, tine]) {
        o.start(at);
        o.stop(at + 8);
    }
    const stop = (when: number): void => {
        // hold where the envelope is, then fade; Firefox can only cancel
        if (amp.gain.cancelAndHoldAtTime) amp.gain.cancelAndHoldAtTime(when);
        else amp.gain.cancelScheduledValues(when);
        amp.gain.setTargetAtTime(0, when, 0.08);
    };
    return { stop };
}

// voicing: bass in the second octave, chord around middle C
const BASS_LOW = 36;
const UPPER_LOW = 52;
const UPPER_HIGH = 72;

/** every inversion of the chord that sits in the upper range */
function inversions(tones: number[]): number[][] {
    const pcs = [...new Set(tones)].sort((a, b) => a - b);
    const out: number[][] = [];
    for (let i = 0; i < pcs.length; i++) {
        const order = [...pcs.slice(i), ...pcs.slice(0, i)];
        for (let base = UPPER_LOW; base < UPPER_LOW + 12; base++) {
            if (base % 12 !== order[0]) continue;
            const notes: number[] = [];
            let last = base - 1;
            for (const pc of order) {
                let n = last + 1;
                while (n % 12 !== pc) n++;
                notes.push(n);
                last = n;
            }
            if (notes[notes.length - 1]! <= UPPER_HIGH) out.push(notes);
        }
    }
    return out;
}

/** how far each finger has to move */
function distance(from: number[], to: number[]): number {
    return to.reduce(
        (sum, n) => sum + Math.min(...from.map((m) => Math.abs(m - n))),
        0,
    );
}

/** nearest voicing to the last one; the first sits around middle C */
export function voice(name: string, prev: number[] | null): number[] {
    const { bass, tones } = chordNotes(name);
    if (!tones.length) return [];
    const options = inversions(tones);
    const target = prev?.length ? prev : [60, 64, 67];
    const upper =
        options.sort((a, b) => distance(target, a) - distance(target, b))[0] ??
        [];
    return [BASS_LOW + bass, ...upper];
}

function sound(notes: number[], at: number): Voice[] {
    const [bass, ...upper] = notes;
    const voices = upper.map((n) => ePiano(n, at, 0.16));
    if (bass !== undefined) voices.push(ePiano(bass, at, 0.22));
    return voices;
}

/** preview: one after another, voice-led */
export function playChords(names: readonly string[], each = 0.8): void {
    const c = audio();
    void c.resume();
    stopHeld();
    const start = c.currentTime + 0.05;
    let prev: number[] | null = null;
    names.forEach((name, i) => {
        const notes = voice(name, prev);
        if (!notes.length) return;
        const at = start + i * each;
        const last = i === names.length - 1;
        for (const v of sound(notes, at)) v.stop(at + (last ? 2.5 : each + 0.1));
        prev = notes.slice(1);
    });
}

// step mode: one chord rings until the next
let held: Voice[] = [];
let heldNotes: number[] | null = null;

export function holdChord(name: string): void {
    const c = audio();
    void c.resume();
    const at = c.currentTime + 0.01;
    for (const v of held) v.stop(at);
    const notes = voice(name, heldNotes);
    held = notes.length ? sound(notes, at) : [];
    if (notes.length) heldNotes = notes.slice(1);
}

export function stopHeld(): void {
    if (!ctx) return;
    for (const v of held) v.stop(ctx.currentTime);
    held = [];
}

/** a fresh start voices the next chord around middle C again */
export function resetVoicing(): void {
    heldNotes = null;
}
