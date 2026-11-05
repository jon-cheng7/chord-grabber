// Vite ambient types
declare module '*.css';

interface ImportMeta {
    readonly env: { readonly DEV: boolean };
}

// a worker or worklet, built separately, as a URL
declare module '*?worker&url' {
    const url: string;
    export default url;
}

// any file as its served URL
declare module '*?url' {
    const url: string;
    export default url;
}

// guitar fingerings, loaded when first asked for
declare module '@tombatossals/chords-db/lib/guitar.json' {
    const db: unknown;
    export default db;
}
