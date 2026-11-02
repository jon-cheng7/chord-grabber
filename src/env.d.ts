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
