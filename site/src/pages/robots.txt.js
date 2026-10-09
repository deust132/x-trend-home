export function GET(){return new Response(`User-agent: *\nAllow: /\nSitemap: ${process.env.SITE_URL||'https://x-trend-b.vercel.app'}/sitemap.xml\n`)}
