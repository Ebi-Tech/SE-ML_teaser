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

  const systemPrompt = `You are a quiz generator for a software engineering and machine learning student.
Given ONE grounding concept, write ONE multiple-choice question that tests real understanding of it,
not just term recall. The question should be reasonably explanatory: it can describe a short scenario
or ask the student to reason about a tradeoff, not just "what does X stand for".

Respond with ONLY a JSON object, no markdown fences, no extra text, in exactly this shape:
{
  "question": "string",
  "options": ["string", "string", "string", "string"],
  "correctIndex": 0,
  "explanation": "string, 2-3 sentences explaining why the correct answer is right and briefly why at least one distractor is wrong"
}
Rules:
- Exactly 4 options, plausible distractors, only one clearly correct.
- correctIndex is the 0-based index of the correct option.
- Base the question ONLY on the grounding concept given. Do not introduce facts it doesn't support.`;

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
    });
  } catch (err) {
    res.status(500).json({ error: `Server error: ${String(err && err.message ? err.message : err)}` });
  }
};
