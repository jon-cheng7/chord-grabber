// Vite ambient types
declare module '*.css';

interface ImportMeta {
    readonly env: { readonly DEV: boolean };
}
