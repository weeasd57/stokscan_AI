import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action } = body;

    if (!process.env.PYTHON_BACKEND_URL) {
      return NextResponse.json(
        { success: false, error: "Backend URL not configured" },
        { status: 500 }
      );
    }

    let endpoint = "";
    let payload = {};

    switch (action) {
      case "test_bot":
        endpoint = "/admin/telegram/test-bot";
        break;
      case "daily_recommendations":
        endpoint = "/admin/telegram/send-daily";
        break;
      case "weekly_report":
        endpoint = "/admin/telegram/send-weekly";
        break;
      default:
        return NextResponse.json(
          { success: false, error: "Invalid action" },
          { status: 400 }
        );
    }

    const response = await fetch(`${process.env.PYTHON_BACKEND_URL}${endpoint}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || `HTTP ${response.status}`);
    }

    return NextResponse.json({
      success: true,
      message: data.message || "Telegram test completed successfully",
      data: data,
    });
  } catch (error) {
    console.error("Telegram test error:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

// GET method for testing basic connectivity
export async function GET() {
  return NextResponse.json({
    success: true,
    message: "Telegram test endpoint is available",
    actions: [
      "test_bot",
      "daily_recommendations", 
      "weekly_report"
    ]
  });
}