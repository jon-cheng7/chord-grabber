// Desktop bookmarklet: reads the open chord page and hands it to this site

export interface Received {
    /** the page as it stands */
    data: string;
    /** the page as served, '' if the fetch failed */
    page: string;
    title: string;
    url: string;
}

const READY = 'cg-ready';
const SHEET = 'cg-sheet';
const PING_MS = 200;
const GIVE_UP_MS = 8000;

/** runs on the chord page: the live page and a fresh copy, also copied in case the handoff fails */
function source(app: string): string {
    return `(() => {
const app = ${JSON.stringify(app)};
const data = document.documentElement.outerHTML;
try { navigator.clipboard.writeText(data).catch(() => {}); } catch (e) {}
const tab = window.open(app + '/#receive', '_blank');
if (!tab) return;
const page = fetch(location.href, { credentials: 'include' }).then((r) => r.text()).catch(() => '');
const on = (e) => {
    if (e.origin !== app || e.data !== ${JSON.stringify(READY)}) return;
    removeEventListener('message', on);
    page.then((page) => tab.postMessage({ type: ${JSON.stringify(SHEET)}, data, page, title: document.title, url: location.href }, app));
};
addEventListener('message', on);
setTimeout(() => removeEventListener('message', on), 15000);
})();`;
}

/** the href to drag to the bookmarks bar */
export function bookmarkletHref(app = location.origin): string {
    // encoded whole: a bare # or % would break the javascript: URL
    return `javascript:${encodeURIComponent(source(app).replace(/\n\s*/g, ' '))}`;
}

/** on #receive: ping the opener until it sends the song, null if it never does */
export function receive(): Promise<Received | null> {
    return new Promise((resolve) => {
        const opener = window.opener as Window | null;
        if (!opener) {
            resolve(null);
            return;
        }
        const done = (value: Received | null): void => {
            clearInterval(ping);
            clearTimeout(timer);
            removeEventListener('message', on);
            resolve(value);
        };
        const on = (e: MessageEvent): void => {
            const d = e.data as Partial<Received> & { type?: string };
            if (
                e.source !== opener ||
                d?.type !== SHEET ||
                typeof d.data !== 'string'
            )
                return;
            done({
                data: d.data,
                page: typeof d.page === 'string' ? d.page : '',
                title: String(d.title ?? ''),
                url: String(d.url ?? ''),
            });
        };
        addEventListener('message', on);
        // the opener only learns our origin from the ping, so '*' is fine for it
        const ping = setInterval(() => opener.postMessage(READY, '*'), PING_MS);
        opener.postMessage(READY, '*');
        const timer = setTimeout(() => done(null), GIVE_UP_MS);
    });
}

export type Browser =
    | 'chrome'
    | 'edge'
    | 'firefox'
    | 'safari'
    | 'opera'
    | 'other';

export function browser(): Browser {
    const ua = navigator.userAgent;
    if (/Edg\//.test(ua)) return 'edge';
    if (/OPR\//.test(ua)) return 'opera';
    if (/Firefox\//.test(ua)) return 'firefox';
    if (/Chrome\//.test(ua)) return 'chrome';
    if (/Safari\//.test(ua)) return 'safari';
    return 'other';
}

export const MAC =
    /Mac/.test(navigator.platform) || /Mac OS X/.test(navigator.userAgent);
