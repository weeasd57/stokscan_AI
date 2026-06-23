import { MetadataRoute } from 'next'
import { createClient } from '@supabase/supabase-js'

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = 'https://egxbots.com'
  
  const staticPages: MetadataRoute.Sitemap = [
    {
      url: baseUrl,
      lastModified: new Date(),
      changeFrequency: 'daily',
      priority: 1.0,
    },
    {
      url: `${baseUrl}/faq`,
      lastModified: new Date(),
      changeFrequency: 'monthly',
      priority: 0.8,
    },
  ]

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY || '';

  if (!supabaseUrl || !supabaseAnonKey) {
    console.warn("Supabase credentials missing for sitemap generation, returning static pages only.");
    return staticPages;
  }

  try {
    const supabase = createClient(supabaseUrl, supabaseAnonKey)
    const { data: stocks } = await supabase
      .from("stock_fundamentals")
      .select("symbol")
      .eq("exchange", "EGX")

    if (stocks && stocks.length > 0) {
      // Ensure unique symbols
      const uniqueSymbols = Array.from(new Set(stocks.map((s: any) => s.symbol.toUpperCase())));
      
      const stockPages: MetadataRoute.Sitemap = uniqueSymbols.map((symbol) => ({
        url: `${baseUrl}/stocks/${symbol.toLowerCase()}`,
        lastModified: new Date(),
        changeFrequency: 'daily',
        priority: 0.7,
      }))

      return [...staticPages, ...stockPages]
    }
  } catch (error) {
    console.error("Error generating dynamic sitemap stock routes:", error)
  }

  return staticPages
}
