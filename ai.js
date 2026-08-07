/* =========================================================
   AI SERVICE — talks to the Anthropic API using the server-side
   API key. This is the ONLY file in the whole project that
   should ever reference process.env.ANTHROPIC_API_KEY.
   ========================================================= */

const Anthropic = require("@anthropic-ai/sdk");

let client = null;
function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not configured on the server.");
  }
  if (!client) client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return client;
}

function buildSystemPrompt(context = {}) {
  return [
    "You are Study Buddy, a friendly, encouraging AI study companion for a high-school student",
    `following the ${context.curriculum || "Egyptian secondary-school"} curriculum` +
      (context.grade ? `, ${context.grade}.` : "."),
    context.subject ? `They are currently focused on: ${context.subject}.` : "",
    context.lesson ? `Current lesson: ${context.lesson}.` : "",
    "Explain clearly, use step-by-step breakdowns for concepts, offer to quiz them,",
    "and keep a warm, motivating tone without being childish.",
  ]
    .filter(Boolean)
    .join(" ");
}

async function getAIReply({ message, context, history }) {
  const anthropic = getClient();

  const messages = (history || [])
    .slice(-12)
    .map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.text }))
    .concat([{ role: "user", content: message }]);

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 800,
    system: buildSystemPrompt(context),
    messages,
  });

  const textBlock = response.content.find((b) => b.type === "text");
  return textBlock ? textBlock.text : "I'm not sure how to respond to that — could you rephrase?";
}

module.exports = { getAIReply };
