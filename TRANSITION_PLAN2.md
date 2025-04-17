Below is a step‑by‑step migration recipe that turns the **codex** code‑base from OpenAI models to Google Gemini.  It is organised so that a junior engineer can tackle it file‑by‑file and commit‑by‑commit.

---

## 0  Preparation

| action | command / note |
| ------ | -------------- |
| **Audit files that mention OpenAI** | `git grep -I -n -e 'openai' -e 'OPENAI_API_KEY'` (verify the list in §4). |
| **Create a feature branch** | `git checkout -b feat/gemini-migration` |
| **Add the SDK** | `npm i @google/genai` (JS) and, if you have Python utilities, `pip install google-generativeai`.  The quick‑start shows the NPM install line. citeturn0view0 |
| **Add a new env var** | `GEMINI_API_KEY` in `.envrc` / CI secrets.  Keep `OPENAI_API_KEY` for a grace period; the config layer will look for either. |

---

## 1  Replace the model utility layer first

### 1.1 Create `src/utils/genai.ts`

```ts
// utils/genai.ts
import { GoogleGenAI } from "@google/genai";

export const GEMINI_API_KEY =
  process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY || "";

export const genai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

// Convenience wrapper for the chat‑style call
export async function chat(
  prompt: string,
  opts: { model?: string } = {},
): Promise<string> {
  const response = await genai.models.generateContent({
    model: opts.model ?? "gemini-2.0-flash",
    contents: prompt,
  });
  return response.text;
}
```

*The code mirrors the quick‑start sample which calls `ai.models.generateContent()`* citeturn0view0.

### 1.2 Rewrite `model-utils.ts`

*File to touch:* `codex-cli/src/utils/model-utils.ts` (currently imports **OpenAI**) .

*Key changes*

| before | after |
| ------ | ----- |
| `import OpenAI from "openai"` | `import { genai } from "./genai"` |
| `openai.models.list()` | **Gemini has no public “list models” yet.**  Replace the network call with a constant list + a TODO to upgrade once the SDK exposes it.  Keep the 2‑second timeout logic. |
| Rename `OPENAI_API_KEY` → `GEMINI_API_KEY` (with alias for back‑compat). |

> **Tip:** keep the `RECOMMENDED_MODELS` array; change entries to `"gemini-2.0-flash"` and `"gemini-1.5-pro"`.

---

## 2  Update every direct completion call

Search for `openai.responses.create` or `chat.completions.create`.  
For each occurrence replace:

```ts
const res = await openai.responses.create({...});
const text = res.output_text;
```

with

```ts
const text = await chat(prompt, { model: "gemini-2.0-flash" });
```

If you need streaming: `await genai.models.generateContentStream(...)`.

### 2.1 Function‑calling support

Gemini exposes the tools interface via the `tools` field: citeturn1view0.

```ts
const response = await genai.models.generateContent({
  model: "gemini-2.0-flash",
  contents: userPrompt,
  config: { tools: [{ functionDeclarations: tools }] },
});
if (response.functionCalls?.length) {
  const call = response.functionCalls[0];
  // …
}
```

Update:

* `utils/parsers.ts` – teach `parseToolCall()` to read `response.functionCalls`.
* `AgentLoop` – where it records `lastResponseId`, switch the shape when `content.parts[0].function_call` is present (see example at lines 117‑118 of the docs). citeturn1view0

### 2.2 Structured JSON output

When Codex expects JSON (e.g. patch plans), pass `responseMimeType: 'application/json'` and an explicit schema as shown in the docs: citeturn2view0.

```ts
const response = await genai.models.generateContent({
  model: 'gemini-2.0-flash',
  contents: prompt,
  config: {
    responseMimeType: 'application/json',
    responseSchema: {/*…see docs sample…*/}
  }
});
```

Refactor any helper that currently instructs GPT‑4 with “Reply in JSON” text to use this API instead.

---

## 3  Config & CLI surfaces

*Files to modify*

| file | change |
| ---- | ------ |
| `src/utils/config.ts` (exported `OPENAI_API_KEY`)  | Rename to `GEMINI_API_KEY`, export a getter that falls back to the old variable so existing scripts keep working. |
| `src/cli.tsx` main entry (search result turn2file9/11/14/17) | Change copy such as “Missing **OpenAI** API key” → “Missing Gemini API key”; replace the URL in the help text with https://ai.google.dev; delete logic that calls `openai models list` for validation. |
| Any UX string that shows “OpenAI Codex” (e.g. banner in `components/terminal-chat.tsx`)  | Rebrand to “Codex (Gemini edition)”. |

---

## 4  Comprehensive file checklist

Below are every path that the grep surfaced and that therefore needs at least a touch:

```
codex-cli/src/utils/model-utils.ts
codex-cli/src/utils/config.ts
codex-cli/src/cli.tsx
codex-cli/src/cli_singlepass.tsx
codex-cli/src/components/** (strings & model‑list warnings)  [turn2file16]
codex-cli/src/components/terminal-chat/**                   [turn2file19]
codex-cli/src/utils/parsers.ts      (tool‑call parsing)
codex-cli/src/utils/agent/agent-loop.ts (functionCalls stream)
codex-cli/scripts/build_container.sh (removes 'openai-*' artefacts)  [turn2file14]
codex-cli/scripts/run_in_container.sh (env var, curl health‑check)   [turn2file18]
codex-cli/scripts/init_firewall.sh (drop openai.com reachability test)  [turn2file13]
codex-cli/examples/** (prompt‑analyzer notebooks & README)   [turn2file5,12,15]
codex-cli/tests/**/*.test.ts (all vitest mocks of "openai") [turn2file1,3‑8]
Dockerfile / CI templates that set OPENAI_API_KEY
docs/README, task.yaml templates
```

*(The square‑bracket citations point to one instance in that file family to justify its inclusion.)*

---

## 5  Testing strategy

1. **Unit tests** – replace vitest mocks:

   ```ts
   vi.mock("@google/genai", () => ({ GoogleGenAI: FakeGenAI }));
   ```

2. **E2E smoke** – `codex -q "echo hello"` in quiet mode.

3. **Function‑calling** – add a test that returns `functionCalls` and assert your parser gets the name/args.

4. **Docker image** – rebuild via `scripts/build_container.sh`; ensure container passes the firewall script which no longer contacts api.openai.com.

---

## 6  Gradual rollout / feature flag (optional)

* Add `export CODEX_LLM_PROVIDER=openai|gemini` in config.  
* Gate `genai.ts` vs `openai.ts` behind that switch for a week, then delete the OpenAI path.

---

## 7  Cleanup & docs

* Update README badges and setup instructions.
* Deprecation notice: “`OPENAI_API_KEY` will be removed after 2025‑05‑31”.
* Open a follow‑up ticket for “implement model listing once the Gemini SDK exposes it”.

---

### Reference snippets from Gemini docs used in this plan

*Install & first request* – “`npm install @google/genai` … `generateContent({ model:'gemini-2.0-flash', contents:'…' })`” citeturn0view0  
*Function calling* – JS example showing `tools` and reading `response.functionCalls` citeturn1view0  
*Structured JSON* – example with `responseMimeType` and `responseSchema` citeturn2view0

---

**You now have a deterministic checklist: update the utility layer, sweep the repo once with search‑and‑replace, migrate the tests, then remove legacy code in a second pass.  Nothing else in the build or UI needs to change.  Happy shipping!**