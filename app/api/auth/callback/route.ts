import { NextResponse } from "next/server";
import { google } from "googleapis";
import { upsertGoogleOauthConfig } from "@/lib/server/google-oauth-config";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");

  if (!code) {
    return NextResponse.json({ error: "Missing code" }, { status: 400 });
  }

  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );

  try {
    const { tokens } = await oauth2Client.getToken(code);
    const refreshToken =
      typeof tokens.refresh_token === "string" ? tokens.refresh_token.trim() : "";

    if (!refreshToken) {
      return NextResponse.json(
        { error: "OAuth success but missing refresh_token; please re-consent" },
        { status: 400 }
      );
    }

    const clientId = process.env.GOOGLE_CLIENT_ID?.trim() || "";
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim() || "";
    const redirectUri = process.env.GOOGLE_REDIRECT_URI?.trim() || "";
    const calendarId = process.env.GOOGLE_CALENDAR_ID?.trim() || "primary";

    if (!clientId || !clientSecret || !redirectUri) {
      return NextResponse.json(
        { error: "OAuth env is incomplete (clientId/clientSecret/redirectUri)" },
        { status: 500 }
      );
    }

    await upsertGoogleOauthConfig({
      refreshToken,
      clientId,
      clientSecret,
      redirectUri,
      calendarId,
      updatedBy: "api_auth_callback",
      source: "oauth_callback",
    });

    return NextResponse.json({
      message: "Google OAuth success and config updated",
      refreshTokenSaved: true,
      source: "oauth_callback",
    });
  } catch (error) {
    console.error("OAuth callback error:", error);
    return NextResponse.json({ error: "OAuth failed" }, { status: 500 });
  }
}
