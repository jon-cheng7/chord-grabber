// Key detection checks, invented progressions

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { rankKeys, songKey } from './key.ts';
import { parseSheet } from './parse.ts';

const sheet = (...parts: string[]) => parseSheet(parts.join('\n'));
const best = (...parts: string[]) => rankKeys(sheet(...parts))[0]?.key;

test('major loop', () => {
    assert.equal(
        best('[Verse]', 'C G Am F', 'C G Am F', '[Chorus]', 'F G C'),
        'C',
    );
});

test('loop that stops on the four', () => {
    assert.equal(best('[Verse]', 'C G Am F', 'C G Am F'), 'C');
});

test('minor with a raised fifth', () => {
    assert.equal(best('[Verse]', 'Am Dm E7 Am', 'Am Dm E7 Am'), 'Am');
});

test('minor that ends at home', () => {
    assert.equal(
        best('[Verse]', 'Am F C G', 'Am F C G', '[Outro]', 'F G Am'),
        'Am',
    );
});

test('rock bVII stays in the major', () => {
    assert.equal(
        best('[Verse]', 'D C G D', 'D C G D', '[Chorus]', 'G A D'),
        'D',
    );
});

test('sus, slash and bar chords count', () => {
    assert.equal(best('| G / Dsus4 / | Em7 / C/G / |', '| G / D / | G |'), 'G');
});

test('page key wins', () => {
    assert.equal(songKey('Em', sheet('G C D G', 'G C D G')), 'Em');
});

test('capo: Bb with capo 3 is written in G', () => {
    const lines = sheet('G C D G', 'Em C D G');
    assert.equal(songKey('Bb', lines, 3), 'G');
    assert.equal(songKey(null, lines, 3), 'G');
});

test('no chords: the page key or nothing', () => {
    assert.equal(songKey('E', sheet('just words here')), 'E');
    assert.equal(songKey(null, sheet('just words here')), null);
});
