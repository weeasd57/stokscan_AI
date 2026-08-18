import { SupabaseClient } from "@supabase/supabase-js";
import crypto from "crypto";

/**
 * Uploads a base64 image data URL to the Supabase 'chat-images' public bucket.
 * Returns the public URL of the uploaded image, or null if upload fails.
 */
export async function uploadChatImage(
    supabase: SupabaseClient,
    userId: string,
    sessionId: string,
    base64DataUrl: string
): Promise<string | null> {
    if (!base64DataUrl || typeof base64DataUrl !== "string") return null;

    // If it's already a hosted HTTP/HTTPS URL, return as-is
    if (base64DataUrl.startsWith("http://") || base64DataUrl.startsWith("https://")) {
        return base64DataUrl;
    }

    try {
        const matches = base64DataUrl.match(/^data:image\/([a-zA-Z0-9+]+);base64,(.+)$/);
        if (!matches || matches.length < 3) return null;

        const rawFormat = matches[1].toLowerCase();
        const ext = rawFormat === "jpeg" ? "jpg" : rawFormat.replace(/[^a-z0-9]/g, "") || "png";
        const base64Content = matches[2];
        const buffer = Buffer.from(base64Content, "base64");

        const fileId = crypto.randomUUID();
        const safeSession = sessionId ? sessionId.replace(/[^a-zA-Z0-9_-]/g, "_") : "general";
        const filePath = `${userId}/${safeSession}/${fileId}.${ext}`;

        const mimeType = `image/${rawFormat === "jpg" ? "jpeg" : rawFormat}`;

        const { error: uploadError } = await supabase.storage
            .from("chat-images")
            .upload(filePath, buffer, {
                contentType: mimeType,
                upsert: true,
                cacheControl: "31536000" // 1 year cache
            });

        if (uploadError) {
            console.error("[ChatStorage] Failed to upload image to Supabase Storage:", uploadError);
            return null;
        }

        const { data: publicUrlData } = supabase.storage
            .from("chat-images")
            .getPublicUrl(filePath);

        return publicUrlData?.publicUrl || null;
    } catch (e) {
        console.error("[ChatStorage] Error processing chat image upload:", e);
        return null;
    }
}

/**
 * Batch upload multiple images. Returns an array of public URLs.
 */
export async function uploadChatImages(
    supabase: SupabaseClient,
    userId: string,
    sessionId: string,
    images: string[]
): Promise<string[]> {
    if (!Array.isArray(images) || images.length === 0) return [];
    
    const results = await Promise.all(
        images.map(img => uploadChatImage(supabase, userId, sessionId, img))
    );

    return results.filter((url): url is string => Boolean(url));
}
