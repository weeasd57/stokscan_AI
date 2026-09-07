// Cairo/Egypt local date helpers. Chat responses and the LLM prompt must show
// the user's trading-day date (Africa/Cairo), never the raw UTC date (UTC can
// be one day behind Egypt between midnight and 02:00/03:00 local).

const CAIRO_TIMEZONE = "Africa/Cairo";

/** Today's date (YYYY-MM-DD) in Africa/Cairo. Falls back to UTC on failure. */
export function todayInCairo(): string {
    try {
        return new Intl.DateTimeFormat("en-CA", {
            timeZone: CAIRO_TIMEZONE,
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
        }).format(new Date());
    } catch {
        return new Date().toISOString().split("T")[0];
    }
}

/** The current clock time in Africa/Cairo as an ISO-like string HH:MM:SS. */
export function cairoTimeString(date: Date = new Date()): string {
    try {
        return new Intl.DateTimeFormat("en-GB", {
            timeZone: CAIRO_TIMEZONE,
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: false,
        }).format(date);
    } catch {
        return date.toISOString().slice(11, 19);
    }
}

/** True when the EGX trading session is open today in Cairo time. */
export function isEgxSessionOpen(date: Date = new Date()): boolean {
    const now = new Intl.DateTimeFormat("en-GB", {
        timeZone: CAIRO_TIMEZONE,
        weekday: "short",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
    }).formatToParts(date);
    const weekday = (now.find(p => p.type === "weekday")?.value || "").toLowerCase();
    const hour = Number(now.find(p => p.type === "hour")?.value || "0");
    const minute = Number(now.find(p => p.type === "minute")?.value || "0");
    const fridayOrSaturday = weekday === "fri" || weekday === "sat";
    if (fridayOrSaturday) return false;
    const minutes = hour * 60 + minute;
    // EGX cash session: 10:00–14:30 Cairo (10:00–15:00 with the extension).
    return minutes >= 10 * 60 && minutes < 15 * 60;
}
