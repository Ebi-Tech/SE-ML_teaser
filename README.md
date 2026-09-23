# SE + ML Quiz

A self-quizzing web app: a serverless function grounds each question in one
concept from `api/knowledge-base.js` (simple RAG) and asks Groq to generate a
multiple-choice question from it. The frontend tracks your answers and builds
a summary sheet (question, your answer, correct answer, right/wrong).

## Files

- `index.html` - the quiz UI (vanilla HTML/JS, no build step)
- `api/generate-question.js` - Vercel serverless function that calls Groq
- `api/knowledge-base.js` - ~40 SE + ML concept chunks used as grounding context

No `package.json`, no framework, no build step needed. Vercel auto-detects
the `/api` folder as serverless functions and serves `index.html` statically.

## Deploy

**Option A: Vercel dashboard**
1. Go to vercel.com -> Add New -> Project -> "Deploy without Git" / drag-and-drop this folder.
2. Once created, go to Project Settings -> Environment Variables.
3. Add `GROQ_API_KEY` = your key from console.groq.com, target: Production (and Preview if you want).
4. Redeploy (Deployments tab -> ... -> Redeploy) so the function picks up the env var.

**Option B: Vercel CLI**
```bash
npm i -g vercel
cd se-ml-quiz
vercel login
vercel env add GROQ_API_KEY production   # paste your key when prompted
vercel --prod
```

## Notes

- Model used is `llama-3.3-70b-versatile` on Groq's OpenAI-compatible endpoint.
  Change `GROQ_MODEL` in `api/generate-question.js` if you want a different one.
- The frontend avoids repeating a concept within a session (`exclude` query
  param); once every concept has been asked once, it starts recycling.
- To add more topics, just append entries to the array in `api/knowledge-base.js`
  with `{ id, category, topic, content }`.
- Summary sheet is in-memory per browser session only, nothing is persisted
  server-side. If you want it to survive a refresh, the simplest addition
  would be to also write `log` to `localStorage` after each answer.
