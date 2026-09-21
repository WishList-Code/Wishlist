// api/chat.js
//
// Vercel serverless function. This is the ONLY place the Gemini API key
// is ever used -- it lives in the GEMINI_API_KEY environment variable on
// Vercel, never in the browser, never in this repo. The "Gift idea
// assistant" panel in the app calls this endpoint instead of calling
// Gemini directly.
//
// Expects:  POST { message: string, history?: {role: "user"|"ai", content: string}[] }
// Returns:  { reply: string }   or   { error: string }

const SYSTEM_PROMPT =
  "You are a friendly gift idea assistant inside a group wishlist app called " +
  "Wishlist. Someone will describe a person -- their interests, hobbies, age, " +
  "or relationship to the asker -- and you suggest 2 to 4 concrete, specific " +
  "gift ideas. Keep your reply short and warm, a few sentences of plain " +
  "conversational text. Do not use markdown headers, bullet points, or bold text.";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Use POST" });
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    res.status(500).json({
      error: "The server is missing a GEMINI_API_KEY environment variable.",
    });
    return;
  }

  const { message, history } = req.body || {};
  if (!message || typeof message !== "string") {
    res.status(400).json({ error: "Missing 'message' in request body" });
    return;
  }

  const contents = [
    { role: "user", parts: [{ text: SYSTEM_PROMPT }] },
    { role: "model", parts: [{ text: "Understood -- I'll suggest specific gift ideas, briefly and warmly." }] },
  ];

  if (Array.isArray(history)) {
    for (const turn of history.slice(-10)) {
      if (!turn || !turn.content) continue;
      contents.push({
        role: turn.role === "ai" ? "model" : "user",
        parts: [{ text: String(turn.content) }],
      });
    }
  }

  contents.push({ role: "user", parts: [{ text: message }] });

  try {
    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents }),
      }
    );

    const data = await geminiRes.json().catch(() => ({}));

    if (!geminiRes.ok) {
      const msg = (data && data.error && data.error.message) || "Gemini API request failed";
      res.status(geminiRes.status).json({ error: msg });
      return;
    }

    const reply =
      (data.candidates &&
        data.candidates[0] &&
        data.candidates[0].content &&
        data.candidates[0].content.parts &&
        data.candidates[0].content.parts.map((p) => p.text).join("")) ||
      "Sorry, I couldn't come up with anything just now -- try rephrasing?";

    res.status(200).json({ reply });
  } catch (err) {
    res.status(500).json({ error: "Failed to reach Gemini: " + err.message });
  }
}
