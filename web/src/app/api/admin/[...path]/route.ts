import { NextResponse } from "next/server";

export const runtime = "nodejs";

async function localAdminRequest(_req: Request, context: { params: { path?: string[] } }) {
  const path = (context.params.path || []).join("/");
  return NextResponse.json(
    { detail: `Admin route '${path}' is not proxied to any external backend.` },
    { status: 404 }
  );
}

export const GET = localAdminRequest;
export const POST = localAdminRequest;
export const PUT = localAdminRequest;
export const PATCH = localAdminRequest;
export const DELETE = localAdminRequest;
