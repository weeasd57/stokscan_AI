import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
    try {
        const { password } = await req.json();
        const secret = process.env.ADMIN_SECRET_PASSWORD;

        if (!secret) {
            return NextResponse.json({ ok: false, error: "Not configured" }, { status: 500 });
        }

        if (!password || typeof password !== "string") {
            return NextResponse.json({ ok: false, error: "Password required" }, { status: 400 });
        }

        if (password === secret) {
            const response = NextResponse.json({ ok: true });
            response.cookies.set("admin_unlock", secret, {
                httpOnly: true,
                secure: process.env.NODE_ENV === "production",
                sameSite: "lax",
                path: "/",
                maxAge: 60 * 60 * 8,
            });
            return response;
        }

        return NextResponse.json({ ok: false, error: "Wrong password" }, { status: 401 });
    } catch {
        return NextResponse.json({ ok: false, error: "Server error" }, { status: 500 });
    }
}
