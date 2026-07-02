import { NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase/route-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const supabase = getSupabaseClient();
    
    // Get model metadata from Supabase
    const { data: models, error } = await supabase
      .from('model_metadata')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Models Supabase error:', error);
      // Return fallback models if Supabase fails
      return NextResponse.json({
        models: [
          { name: 'EGX_DEFAULT', accuracy: 0.75, exchange: 'EGX' },
          { name: 'KING_👑', accuracy: 0.82, exchange: 'EGX' }
        ]
      });
    }

    // Transform to expected format
    const modelList = models?.map(model => ({
      name: model.name,
      accuracy: model.accuracy || 0.0,
      exchange: model.exchange || 'EGX',
      created_at: model.created_at,
      metadata: model.metadata || {}
    })) || [];

    return NextResponse.json({ models: modelList });

  } catch (error) {
    console.error('Models API error:', error);
    // Fallback response
    return NextResponse.json({
      models: [
        { name: 'EGX_DEFAULT', accuracy: 0.75, exchange: 'EGX' }
      ]
    });
  }
}
