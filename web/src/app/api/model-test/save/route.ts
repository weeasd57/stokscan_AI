import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { isChatAdminEmail } from '@/lib/chat-sharing';

export async function POST(req: NextRequest) {
  try {
    const { modelName, symbol, exchange, predictions, executionTime } = await req.json();

    if (!modelName || !symbol || !exchange || !predictions || predictions.length === 0) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    // Get the auth token from the request
    const authClient = createSupabaseServerClient(req);
    const { data: { user } } = await authClient.auth.getUser();
    if (!user || !(user.app_metadata?.role === 'admin' || isChatAdminEmail(user.email))) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL || '',
      process.env.SUPABASE_SERVICE_ROLE_KEY || ''
    );

    // Count total unique symbols for symbol_count parameter
    const symbolCount = 1; // Single symbol test

    // Call the save_model_test RPC function with execution time as direction indicator
    const { data, error } = await supabase.rpc('save_model_test', {
      p_model_name: modelName,
      p_symbol: symbol,
      p_exchange: exchange,
      p_predictions: predictions,
      p_execution_time_ms: executionTime || 0,
      p_symbol_count: symbolCount,
    });

    if (error) {
      console.error('Supabase error:', error);
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      testId: data,
      message: 'Test results saved successfully ✅',
    });
  } catch (error) {
    console.error('API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
