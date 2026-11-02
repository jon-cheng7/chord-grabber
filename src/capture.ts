// Mic in, pitch out: the work happens on the audio thread, the page only gets the answers.
// The app keeps nothing but pitch and how clear it was; only the lab asks for the audio too

import workletUrl from './capture-worklet.ts?worker&url';
import type { Frame } from './listen/summary.ts';

export interface Capture {
    /** now, on the frames' clock: stamp taps with this */
    now(): number;
    /** samples per second of what record gets */
    rate: number;
    stop(): void;
}

export async function capture(
    onFrame: (f: Frame) => void,
    /** the raw signal in chunks, each stamped with when it started (lab only) */
    record?: (pcm: Float32Array, at: number) => void,
): Promise<Capture | 'denied' | 'unsupported'> {
    if (
        !navigator.mediaDevices?.getUserMedia ||
        typeof AudioWorkletNode === 'undefined'
    )
        return 'unsupported';
    let stream: MediaStream;
    try {
        // the raw voice: the browser's cleaning bends pitch
        stream = await navigator.mediaDevices.getUserMedia({
            audio: {
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false,
            },
        });
    } catch {
        return 'denied';
    }
    const ctx = new AudioContext();
    await ctx.audioWorklet.addModule(workletUrl);
    const source = ctx.createMediaStreamSource(stream);
    const node = new AudioWorkletNode(ctx, 'cg-listen');
    // a silent path out keeps every browser running the worklet
    const mute = ctx.createGain();
    mute.gain.value = 0;
    node.port.onmessage = (
        e: MessageEvent<Frame | { pcm: Float32Array; at: number }>,
    ) => {
        if ('pcm' in e.data) record?.(e.data.pcm, e.data.at);
        else onFrame(e.data);
    };
    if (record) node.port.postMessage('record');
    source.connect(node).connect(mute).connect(ctx.destination);
    return {
        now: () => ctx.currentTime,
        rate: ctx.sampleRate,
        stop: () => {
            node.port.onmessage = null;
            source.disconnect();
            for (const track of stream.getTracks()) track.stop();
            void ctx.close();
        },
    };
}
