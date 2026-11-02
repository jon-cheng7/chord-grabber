// UG page data checks

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decodeEntities, readUltimateGuitar } from './ug.ts';

const store = {
    store: {
        page: {
            data: {
                tab: {
                    song_name: 'Test Song',
                    artist_name: 'Nobody',
                    tonality_name: 'G',
                    tab_url: 'https://example.com/t',
                },
                tab_view: {
                    wiki_tab: {
                        content: '[tab][ch]G[/ch]\r\nHello there[/tab]',
                    },
                    meta: { capo: 2 },
                },
            },
        },
    },
};
const attr = JSON.stringify(store)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;');

test('entities', () => {
    assert.equal(
        decodeEntities('&quot;a&quot; &amp; &#39;b&#x27; &lt;'),
        '"a" & \'b\' <',
    );
});

test('attribute value, as the Shortcut sends it', () => {
    const song = readUltimateGuitar(attr);
    assert.deepEqual(song, {
        title: 'Test Song',
        artist: 'Nobody',
        key: 'G',
        capo: 2,
        sheet: '[tab][ch]G[/ch]\r\nHello there[/tab]',
        url: 'https://example.com/t',
    });
});

test('whole page', () => {
    const page = `<html><div class="js-store" data-content="${attr}"></div></html>`;
    assert.equal(readUltimateGuitar(page)?.title, 'Test Song');
});

test('not UG', () => {
    assert.equal(readUltimateGuitar('C G\nhello'), null);
});
