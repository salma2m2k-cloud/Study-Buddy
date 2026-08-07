/* =========================================================
   STUDY BUDDY — OPTIONAL BACKEND
   ---------------------------------------------------------
   This server exists for ONE reason: to keep your AI API key
   off the frontend. The frontend never sees ANTHROPIC_API_KEY —
   it only knows the URL of this server (set in Settings → AI →
   "AI backend URL").

   Run it with:  npm install && npm start
   Then set the AI backend URL in the app to http://localhost:3001
   ========================================================= */

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { getAIReply } = require("./services/ai");

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (req, res) => {
  res.json({ ok: true, hasApiKey: Boolean(process.env.ANTHROPIC_API_KEY) });
});

app.post("/api/chat", async (req, res) => {
  const { message, context, history } = req.body || {};
  if (!message || typeof message !== "string") {
    return res.status(400).json({ error: "Missing 'message' string in request body." });
  }
  try {
    const reply = await getAIReply({ message, context, history });
    res.json({ reply });
  } catch (err) {
    console.error("AI request failed:", err.message);
    res.status(500).json({ error: "The AI service is unavailable right now." });
  }
});

app.listen(PORT, () => {
  console.log(`Study Buddy backend listening on http://localhost:${PORT}`);
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn("⚠️  ANTHROPIC_API_KEY is not set — copy .env.example to .env and add your key.");
  }
});
