const knowledgeBase = require("./knowledge-base.js");

const GROQ_MODEL = "openai/gpt-oss-120b";
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

function pickConcept(excludeIds) {
  const pool = knowledgeBase.filter((c) => !excludeIds.includes(c.id));
  const source = pool.length > 0 ? pool : knowledgeBase; // reset once exhausted
  return source[Math.floor(Math.random() * source.length)];
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    res.status(500).json({
      error: "GROQ_API_KEY is not set on this deployment. Add it in Vercel project settings, then redeploy.",
    });
    return;
  }

  let excludeIds = [];
  try {
    const raw = req.method === "GET" ? req.query.exclude : req.body && req.body.exclude;
    if (raw) {
      excludeIds = Array.isArray(raw) ? raw : String(raw).split(",").filter(Boolean);
    }
  } catch (_) {
    excludeIds = [];
  }

  const concept = pickConcept(excludeIds);

  const systemPrompt = `You are a patient tutor writing a quiz question for a young student learning software
engineering and machine learning. They know the basics but are not an expert, so explanations must be in
plain, everyday language, not academic or overly formal English. Short, clear sentences.

Given ONE grounding concept, write ONE multiple-choice question that tests real understanding of it,
not just term recall. The question should be reasonably explanatory: it can describe a short scenario
or ask the student to reason about a tradeoff, not just "what does X stand for".

Respond with ONLY a JSON object, no markdown fences, no extra text, in exactly this shape:
{
  "question": "string",
  "options": ["string", "string", "string", "string"],
  "correctIndex": 0,
  "explanation": "string",
  "terms": [{ "term": "string", "definition": "string" }]
}

Rules for "explanation":
- Start with one short sentence naming the concept/topic this question is really about, e.g. "This is about how X works."
- Then explain, in simple everyday words, why the correct option is right.
- Then briefly say why the option a confused student would most likely pick instead is wrong.
- Never just restate the option text, actually explain the reasoning a beginner needs.
- The goal is clarity, not length: do not pad it, but do not leave it vague either. 3-5 short sentences is fine if each one earns its place.

Rules for "terms":
- List 1-4 technical terms that appear in the question or options and that a beginner might not already know.
- Each definition must be one plain-English sentence, no jargon inside the definition itself.
- If every term used is already common knowledge, return an empty array.

Rules for the question itself:
- Exactly 4 options, plausible distractors, only one clearly correct.
- correctIndex is the 0-based index of the correct option.
- Base everything ONLY on the grounding concept given. Do not introduce facts it doesn't support.`;

  const userPrompt = `Grounding concept (category: ${concept.category}, topic: ${concept.topic}):
"""${concept.content}"""

Write the question now.`;

  try {
    const groqRes = await fetch(GROQ_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        temperature: 0.7,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    });

    if (!groqRes.ok) {
      const errText = await groqRes.text();
      res.status(502).json({ error: `Groq API error (${groqRes.status}): ${errText.slice(0, 300)}` });
      return;
    }

    const data = await groqRes.json();
    const content = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (!content) {
      res.status(502).json({ error: "Groq returned no content" });
      return;
    }

    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch (_) {
      const match = content.match(/\{[\s\S]*\}/);
      if (!match) {
        res.status(502).json({ error: "Could not parse question JSON from model output" });
        return;
      }
      parsed = JSON.parse(match[0]);
    }

    if (
      !parsed.question ||
      !Array.isArray(parsed.options) ||
      parsed.options.length !== 4 ||
      typeof parsed.correctIndex !== "number"
    ) {
      res.status(502).json({ error: "Model output did not match expected question shape" });
      return;
    }

    res.status(200).json({
      conceptId: concept.id,
      category: concept.category,
      topic: concept.topic,
      question: parsed.question,
      options: parsed.options,
      correctIndex: parsed.correctIndex,
      explanation: parsed.explanation || "",
      terms: Array.isArray(parsed.terms)
        ? parsed.terms.filter((t) => t && t.term && t.definition).slice(0, 4)
        : [],
    });
  } catch (err) {
    res.status(500).json({ error: `Server error: ${String(err && err.message ? err.message : err)}` });
  }
};
