import { MetadataRoute } from 'next'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/admin', '/api', '/profile'],
      },
      {
        userAgent: [
          'GPTBot',
          'ChatGPT-User',
          'PerplexityBot',
          'ClaudeBot',
          'Google-Extended',
          'Applebot-Extended',
          'cohere-ai',
          'OAI-SearchBot'
        ],
        allow: [
          '/',
          '/stocks',
          '/stocks/*',
          '/scanner/ai',
          '/scanner/technical',
          '/scanner/market',
          '/scanner/backtests',
          '/scanner/comparison',
          '/faq',
          '/news',
          '/blogs',
          '/llms.txt',
          '/llms-full.txt'
        ],
        disallow: ['/admin', '/api', '/profile'],
      }
    ],
    sitemap: 'https://egxbots.com/sitemap.xml',
  }
}
