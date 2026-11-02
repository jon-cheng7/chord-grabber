// Sheet parsing checks, invented lyrics

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isChord } from './music/chord.ts';
import { parseSheet, type Line } from './parse.ts';

const flat = (line: Line | undefined) =>
    line?.kind === 'lyric'
        ? line.units.flat().map((p) => [p.chord, p.text])
        : null;

test('chord symbols', () => {
    for (const c of [
        'C',
        'Am',
        'F#m7',
        'Bbmaj7',
        'G/B',
        'Dsus4',
        'E7b9',
        'C#dim',
        'Aadd9',
        'Cm7b5',
        'F6/9',
        'G7(#11)',
    ]) {
        assert.ok(isChord(c), c);
    }
    for (const w of ['And', 'I', 'Bad', 'Hello', 'Am I', 'Cat'])
        assert.ok(!isChord(w), w);
});

test('UG markup: chords over lyrics', () => {
    const lines = parseSheet(
        '[Verse 1]\r\n[tab][ch]C[/ch]      [ch]G[/ch]\r\nWalking down the road[/tab]\r\n',
    );
    assert.deepEqual(lines[0], { kind: 'section', label: 'Verse 1' });
    assert.deepEqual(flat(lines[1]), [
        ['C', 'Walking '],
        ['G', 'down '],
        [null, 'the '],
        [null, 'road'],
    ]);
});

test('plain text: chords over lyrics, chord mid-word', () => {
    const lines = parseSheet('Am         F\nSomewhere sunlight');
    assert.deepEqual(flat(lines[0]), [
        ['Am', 'Somewhere '],
        [null, 's'],
        ['F', 'unlight'],
    ]);
    const line = lines[0];
    // "s" + "unlight" stay one unit, so they never wrap apart
    assert.ok(line?.kind === 'lyric' && line.units[1]?.length === 2);
});

test('chord-only lines and filler', () => {
    const lines = parseSheet('[Intro]\nC  G  | Am  F  x2\n\nNo chords here');
    assert.equal(lines[1]?.kind, 'chords');
    const items = lines[1]?.kind === 'chords' ? lines[1].items : [];
    assert.deepEqual(
        items.map((p) => p.chord ?? p.text),
        ['C', 'G', '|', 'Am', 'F', 'x2'],
    );
    assert.equal(lines[2]?.kind, 'blank');
    assert.equal(lines[3]?.kind, 'lyric');
});

test('chord past the end of the lyric', () => {
    const lines = parseSheet('C           G\nShort');
    assert.deepEqual(flat(lines[0])?.at(-1), ['G', ' ']);
});

test('inline UG chords', () => {
    const lines = parseSheet('[ch]D[/ch]Over the [ch]A[/ch]hill');
    assert.deepEqual(flat(lines[0]), [
        ['D', 'Over '],
        [null, 'the '],
        ['A', 'hill'],
    ]);
});

test('guitar tab stays as a block', () => {
    const lines = parseSheet('e|---0---|\nB|---1---|\nG|---0---|');
    assert.equal(lines.length, 1);
    assert.equal(lines[0]?.kind, 'tab');
});
