/** Shared by ChatContext and the HTTP verification runner. No auth bypass. */
function createChatRequest(input) {
    const images = Array.isArray(input.images) ? input.images : [];
    return {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream, application/json", "x-stream": "true" },
        body: JSON.stringify({
            message: input.message || "قم بقراءة وتحليل هذه الصورة المرفقة.",
            history: input.history || [],
            images: images.length ? images : undefined,
            image: images[0] || undefined,
            model: input.model,
            session_id: input.sessionId,
            client_message_id: input.clientMessageId,
            stream: true,
            chart_context: input.chartContext,
        }),
    };
}
module.exports = { createChatRequest };
