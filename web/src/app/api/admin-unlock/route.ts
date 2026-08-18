import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
    try {
        const { password } = await req.json();
        const secret = process.env.ADMIN_SECRET_PASSWORD || "Aa@@@20507090";

        if (!password || typeof password !== "string") {
            return NextResponse.json({ ok: false, error: "Password required" }, { status: 400 });
        }

        if (password === secret) {
            return NextResponse.json({ ok: true });
        }

        return NextResponse.json({ ok: false, error: "Wrong password" }, { status: 401 });
    } catch {
        return NextResponse.json({ ok: false, error: "Server error" }, { status: 500 });
    }
}
