import { MetadataRoute } from 'next'
import { createClient } from '@supabase/supabase-js'
import { getPublicReports, reportUrl } from '@/lib/social/public-reports'

export const revalidate = 86400;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = 'https://egxbots.com'
  
  const staticPages: MetadataRoute.Sitemap = [
    {
      url: baseUrl,
      changeFrequency: 'daily',
      priority: 1.0,
    },
    {
      url: `${baseUrl}/scanner/ai`,
      changeFrequency: 'daily',
      priority: 0.95,
    },
    {
      url: `${baseUrl}/stocks`,
      changeFrequency: 'daily',
      priority: 0.90,
    },
    {
      url: `${baseUrl}/scanner/technical`,
      changeFrequency: 'daily',
      priority: 0.85,
    },
    {
      url: `${baseUrl}/scanner/backtests`,
      changeFrequency: 'daily',
      priority: 0.85,
    },
    {
      url: `${baseUrl}/scanner/market`,
      changeFrequency: 'daily',
      priority: 0.85,
    },
    {
      url: `${baseUrl}/scanner/comparison`,
      changeFrequency: 'daily',
      priority: 0.8,
    },
    {
      url: `${baseUrl}/blogs`,
      changeFrequency: 'daily',
      priority: 0.8,
    },
    {
      url: `${baseUrl}/news`,
      changeFrequency: 'hourly',
      priority: 0.8,
    },
    {
      url: `${baseUrl}/chart`,
      changeFrequency: 'weekly',
      priority: 0.75,
    },
    {
      url: `${baseUrl}/faq`,
      changeFrequency: 'weekly',
      priority: 0.75,
    },
    {
      url: `${baseUrl}/disclaimer`,
      changeFrequency: 'monthly',
      priority: 0.3,
    },
  ]

  const reportPages: MetadataRoute.Sitemap = (await getPublicReports()).map(r => ({
    url: baseUrl + reportUrl(r), lastModified: new Date(r.updated_at), changeFrequency: 'never', priority: 0.8
  }));
  staticPages.push({ url: baseUrl + '/reports', changeFrequency: 'daily', priority: 0.8 });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY || '';

  if (!supabaseUrl || !supabaseAnonKey) {
    console.warn("Supabase credentials missing for sitemap generation, returning static pages only.");
    return [...staticPages, ...reportPages];
  }

  let dynamicPages: MetadataRoute.Sitemap = []

  try {
    const supabase = createClient(supabaseUrl, supabaseAnonKey)

    // 1. Dynamic Stock Pages
    const { data: stocks, error: stockErr } = await supabase
      .from("stock_fundamentals")
      .select("symbol")
      .eq("exchange", "EGX")

    if (!stockErr && stocks && stocks.length > 0) {
      const uniqueSymbols = Array.from(new Set(stocks.map((s: any) => s.symbol.toUpperCase())))
      
      const stockPages: MetadataRoute.Sitemap = uniqueSymbols.map((symbol) => ({
        url: `${baseUrl}/stocks/${symbol.toLowerCase()}`,
        changeFrequency: 'daily',
        priority: 0.7,
      }))
      dynamicPages = [...dynamicPages, ...stockPages]
    }

    // 2. Dynamic Published Blog Posts from Shared Chat
    const { data: posts, error: postErr } = await supabase
      .from("shared_chat_posts")
      .select("slug, updated_at, created_at")
      .eq("is_published", true)

    if (!postErr && posts && posts.length > 0) {
      const postPages: MetadataRoute.Sitemap = posts.map((post: any) => ({
        url: `${baseUrl}/blogs/chat/${post.slug}`,
        lastModified: post.updated_at ? new Date(post.updated_at) : (post.created_at ? new Date(post.created_at) : undefined),
        changeFrequency: 'weekly',
        priority: 0.75,
      }))
      dynamicPages = [...dynamicPages, ...postPages]
    }

  } catch (error) {
    console.error("Error generating dynamic sitemap routes:", error)
  }

  return [...staticPages, ...dynamicPages, ...reportPages]
}
