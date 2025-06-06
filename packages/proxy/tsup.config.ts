import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs', 'esm'],
  dts: true,
  external: [
    'puppeteer',
    'puppeteer-extra',
    'puppeteer-extra-plugin-stealth',
  ],
})