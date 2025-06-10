import { defineConfig } from 'vite'

export default defineConfig({
    build: {
        outDir: 'dist',
        lib: {
            entry: 'src/index.ts',
            name: 'worker',
            fileName: 'index',
            formats: ['es']
        },
        rollupOptions: {
            external: [],
        },
        minify: true
    },
    resolve: {
        alias: {
            '@': '/src'
        }
    }
}) 