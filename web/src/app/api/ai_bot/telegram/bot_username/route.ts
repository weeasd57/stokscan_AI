import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const revalidate = 86400;

export async function GET() {
  return NextResponse.json({ username: "egxbots_bot" });
}
