import { MetadataRoute } from 'next'
import { createClient } from '@supabase/supabase-js'

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = 'https://egxbots.com'
  const currentDate = new Date()
  
  const staticPages: MetadataRoute.Sitemap = [
    {
      url: baseUrl,
      lastModified: currentDate,
      changeFrequency: 'daily',
      priority: 1.0,
    },
    {
      url: `${baseUrl}/scanner/ai`,
      lastModified: currentDate,
      changeFrequency: 'daily',
      priority: 0.95,
    },
    {
      url: `${baseUrl}/scanner/technical`,
      lastModified: currentDate,
      changeFrequency: 'daily',
      priority: 0.85,
    },
    {
      url: `${baseUrl}/scanner/backtests`,
      lastModified: currentDate,
      changeFrequency: 'daily',
      priority: 0.85,
    },
    {
      url: `${baseUrl}/scanner/market`,
      lastModified: currentDate,
      changeFrequency: 'daily',
      priority: 0.85,
    },
    {
      url: `${baseUrl}/scanner/comparison`,
      lastModified: currentDate,
      changeFrequency: 'daily',
      priority: 0.8,
    },
    {
      url: `${baseUrl}/blogs`,
      lastModified: currentDate,
      changeFrequency: 'daily',
      priority: 0.8,
    },
    {
      url: `${baseUrl}/news`,
      lastModified: currentDate,
      changeFrequency: 'hourly',
      priority: 0.8,
    },
    {
      url: `${baseUrl}/chart`,
      lastModified: currentDate,
      changeFrequency: 'weekly',
      priority: 0.75,
    },
    {
      url: `${baseUrl}/faq`,
      lastModified: currentDate,
      changeFrequency: 'weekly',
      priority: 0.75,
    },
    {
      url: `${baseUrl}/disclaimer`,
      lastModified: currentDate,
      changeFrequency: 'monthly',
      priority: 0.3,
    },
  ]

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY || '';

  if (!supabaseUrl || !supabaseAnonKey) {
    console.warn("Supabase credentials missing for sitemap generation, returning static pages only.");
    return staticPages;
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
        lastModified: currentDate,
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
        lastModified: post.updated_at ? new Date(post.updated_at) : (post.created_at ? new Date(post.created_at) : currentDate),
        changeFrequency: 'weekly',
        priority: 0.75,
      }))
      dynamicPages = [...dynamicPages, ...postPages]
    }

  } catch (error) {
    console.error("Error generating dynamic sitemap routes:", error)
  }

  return [...staticPages, ...dynamicPages]
}
