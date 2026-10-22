const knowledgeBase = require("./knowledge-base.js");

const GROQ_MODEL = "openai/gpt-oss-120b";
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

// Share of questions drawn from ML, math and capstone topics (the rest are general SE).
const ML_SHARE = 0.75;
// Chance that a topic with a worked example becomes a calculation question.
const CALC_SHARE = 0.8;

const ML_PREFIXES = ["ml-", "nn-", "mlops-", "cap-", "math-", "clu-", "nlp-"];
const isML = (c) => ML_PREFIXES.some((p) => c.id.startsWith(p));

function pickConcept(excludeIds) {
  const available = knowledgeBase.filter((c) => !excludeIds.includes(c.id));
  const pool = available.length > 0 ? available : knowledgeBase; // reset once exhausted
  const mlPool = pool.filter(isML);
  const sePool = pool.filter((c) => !isML(c));
  const useML = mlPool.length > 0 && (sePool.length === 0 || Math.random() < ML_SHARE);
  const source = useML ? mlPool : sePool;
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
  const wantCalc = Boolean(concept.calc) && Math.random() < CALC_SHARE;

  const modeLine = wantCalc
    ? `QUESTION TYPE: CALCULATION. Ask the student to work out a number by hand using the formula and worked example in the grounding concept. You may change the numbers, but keep them small and friendly, and recompute very carefully. The correct option must equal your own result. Make each wrong option come from a typical mistake (forgot to divide, used the wrong formula, swapped two values, skipped a step). All four options must be in the same format (all numbers, or all short expressions).`
    : `QUESTION TYPE: UNDERSTANDING. Ask a short scenario or "what would happen if" question that tests real understanding of the concept, not memorised wording.`;

  const systemPrompt = `You are a friendly tutor writing ONE multiple-choice quiz question for a young student learning software engineering and machine learning. Explain things the way you would to a curious 10 year old: plain words, short sentences, no jargon without a definition.

${modeLine}

Respond with ONLY a JSON object, no markdown fences, no extra text, in exactly this shape:
{
  "question": "string",
  "options": ["string", "string", "string", "string"],
  "correctIndex": 0,
  "explanation": "string",
  "terms": [{ "term": "string", "definition": "string" }]
}

Rules for "explanation" (use a blank line, written as \\n\\n inside the JSON string, between the three parts):
- Part 1: one short line that starts with "Topic:" and names the concept being tested.
- Part 2: 2 to 4 very short sentences. Use one everyday comparison a child knows (a lunch queue, sorting sweets, a school bag, a shop counter, a football team). Say WHY the right option is right, and WHY the most tempting wrong option is wrong. For a calculation question, show the steps with the real numbers ("Step 1: ... Step 2: ...") and the final answer.
- Part 3: one sentence that starts with "Real-life use:" and gives a concrete use, ideally from phones, voice assistants, shops, schools, maps or farming.
- Keep the whole explanation under about 90 words. Be clear, never vague, and never just repeat the option text.

Rules for "terms":
- List 1 to 4 technical words from the question or options that a beginner may not know.
- Each definition is one plain sentence a child could follow, with no jargon inside it.
- If every word is already common knowledge, return an empty array.

Rules for the question:
- Exactly 4 options, only one correct, correctIndex is the 0-based index of the correct option.
- Write maths in plain text only (x for times, / for divide, ^ for power, sqrt(), no LaTeX).
- Do not give away the answer in the question.
- Base everything ONLY on the grounding concept given. Do not add facts it does not support.`;

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
        temperature: wantCalc ? 0.4 : 0.7,
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
