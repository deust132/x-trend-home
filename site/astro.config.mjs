import { defineConfig } from 'astro/config';
export default defineConfig({ output: 'static', site: process.env.SITE_URL || 'https://x-trend-b.vercel.app' });
