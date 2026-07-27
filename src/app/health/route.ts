import { NextResponse } from "next/server";

export function GET(): NextResponse {
  return NextResponse.json(
    {
      service: "smbos",
      status: "ok",
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
      status: 200,
    },
  );
}
