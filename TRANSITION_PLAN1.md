This is the initial outline of a plan to update the `codex` CLI to use the `@google/genai` library for Gemini models, replacing the existing OpenAI integration.

**I. Analysis of Current Codex Structure (based on `codex.txt`)**

The core interaction with the LLM happens within `codex-cli/src/utils/agent/agent-loop.ts`[cite: 1425]. This file is responsible for:

1.  **Client Initialization:** Creates an `OpenAI` client instance using configuration details (API key, base URL, timeout) [cite: 1439, 1487-1489].
2.  **API Calls:** Uses `openai.responses.create` to send requests, including instructions, input items (user messages, tool outputs), and the previous response ID for context[cite: 1554, 1555]. It handles streaming responses.
3.  **Model & Instructions:** Takes the model name and instructions from the configuration[cite: 1436, 1483, 1552].
4.  **Response Handling:** Processes streamed events (`response.output_item.done`, `response.completed`) and passes individual `ResponseItem` objects to the `onItem` callback[cite: 1440, 1621, 1629]. It also manages the `lastResponseId` for conversation history[cite: 1442, 1632].
5.  **Tool/Function Calling:** Parses `function_call` items using helpers from `codex-cli/src/utils/parsers.ts` [cite: 1378, 1505] and orchestrates execution (e.g., `handleExecCommand`)[cite: 1429, 1514], preparing `function_call_output` items for the next turn[cite: 1506, 1517].
6.  **Error Handling:** Catches specific OpenAI errors like timeouts, rate limits, and invalid requests [cite: 1430, 1561-1613, 1653-1677].
7.  **Cancellation:** Manages stream cancellation and aborting tool execution.

Other relevant files include:

* **`codex-cli/src/utils/config.ts`:** Defines default models, loads/saves configuration (API key, model name), and handles project documentation[cite: 1043, 1049, 1054, 1086, 1126].
* **`codex-cli/src/cli.tsx`:** Parses command-line flags (like `--model`), loads config, validates the model, and initializes the main UI or quiet mode loop [cite: 2061, 2071, 2091, 2092, 2100-2102].
* **`codex-cli/src/utils/model-utils.ts`:** Fetches and validates available model names[cite: 2029, 2038, 2042].
* **`codex-cli/src/utils/parsers.ts`:** Contains OpenAI-specific logic for parsing tool call arguments and outputs[cite: 1371, 1378].
* **UI Components (e.g., `TerminalChat`, `TerminalChatResponseItem`, `ModelOverlay`):** Render conversation history, tool calls/outputs, and allow model switching[cite: 444, 463, 846, 397].
* **Type Definitions (various):** Types like `ResponseItem`, `ResponseFunctionToolCall`, etc., are specific to the OpenAI SDK[cite: 454, 1427].

**II. Required Changes for `@google/genai` Integration**

Based on the `@google/genai` documentation and the current Codex structure, the following changes are necessary:

1.  **Dependency Management:**
    * Add `@google/genai` as a project dependency.
    * Remove the `openai` dependency.

2.  **Configuration (`codex-cli/src/utils/config.ts`):**
    * Update `DEFAULT_AGENTIC_MODEL` and `DEFAULT_FULL_CONTEXT_MODEL` to appropriate Gemini model names (e.g., `gemini-1.5-flash-latest`, `gemini-1.5-pro-latest`)[cite: 1049].
    * Update `RECOMMENDED_MODELS` in `codex-cli/src/utils/model-utils.ts`[cite: 2030].
    * Modify API key handling:
        * Look for `GOOGLE_API_KEY` environment variable in addition to or instead of `OPENAI_API_KEY`[cite: 1054]. Update `setApiKey` if necessary[cite: 1055].
        * Update documentation/user guidance regarding API key setup.
    * Remove `OPENAI_BASE_URL` handling unless a similar configuration is needed for Gemini (e.g., Vertex AI endpoints)[cite: 1054].
    * Remove `OPENAI_TIMEOUT_MS` handling; `@google/genai` might have its own timeout configuration methods[cite: 1053].

3.  **Model Utilities (`codex-cli/src/utils/model-utils.ts`):**
    * Rewrite `fetchModels` to use the appropriate `@google/genai` method for listing available models (if one exists) or rely on a hardcoded/configurable list[cite: 2034]. The current implementation uses `openai.models.list()`[cite: 2035].
    * Update `isModelSupportedForResponses` to check against the list of available Gemini models[cite: 2042].

4.  **Agent Loop (`codex-cli/src/utils/agent/agent-loop.ts`):** This requires the most significant changes.
    * **Client Initialization:**
        * Replace `import OpenAI from "openai"` with `import { GoogleGenerativeAI } from "@google/genai";`.
        * Replace `this.oai = new OpenAI(...)`with:
            ```typescript
            const genAI = new GoogleGenerativeAI(apiKey);
            this.modelInstance = genAI.getGenerativeModel({
              model: this.model,
              // Pass system instructions here if applicable via `systemInstruction`
              systemInstruction: this.instructions,
              tools: [/* Define tools/functions here */]
            });
            // Initialize chat session for conversation history
            this.chatSession = this.modelInstance.startChat({ history: [] });
            ```
        * Store `modelInstance` and `chatSession` as class members.
    * **API Calls:**
        * Replace the loop making calls to `this.oai.responses.create`[cite: 1554].
        * Use `this.chatSession.sendMessageStream(parts)` for streaming chat responses. The `parts` variable should be constructed based on the `turnInput` array, mapping Codex's `ResponseInputItem` types to Gemini's `Part` objects (text, functionResponse).
        * The `input` array currently sent [cite: 1555] needs to be transformed into the format expected by `sendMessageStream` (usually a string prompt or an array of `Part` objects).
        * Remove `previous_response_id` handling[cite: 1554, 1632]; history is managed by the `chatSession` object.
    * **Response Handling:**
        * Iterate over the stream returned by `sendMessageStream`. Chunks will contain `response.candidates[0].content.parts`.
        * Map Gemini's `Part` objects (text, functionCall) back to Codex's internal `ResponseItem` format (or define new internal types) before calling `this.onItem`[cite: 1440]. This requires careful mapping, especially for function calls and refusals (safety settings).
        * Update the logic that sets `lastResponseId`; this concept might not map directly and state management may need rethinking based on `chatSession.history`.
    * **Tool/Function Calling:**
        * Define tools using the `{ functionDeclarations: [...] }` structure within the `tools` array passed to `getGenerativeModel`.
        * Adapt `handleFunctionCall` [cite: 1491] and related parsing logic (`codex-cli/src/utils/parsers.ts` [cite: 1371, 1378]) to:
            * Parse `FunctionCall` parts from the Gemini response.
            * Execute the corresponding tool/command (`handleExecCommand` [cite: 1429, 1514] logic likely remains similar, but input extraction changes).
            * Format the tool's output as a `FunctionResponse` part for the *next* call to `sendMessageStream`.
    * **Instructions:** Pass system instructions via `systemInstruction` during `getGenerativeModel` initialization, not within each API call[cite: 1552]. The current `prefix` logic needs removal/adaptation.
    * **Error Handling:** Replace OpenAI-specific error catching (e.g., `APIConnectionTimeoutError`, status codes like 429) with error handling appropriate for `@google/genai` (check its documentation for specific error types/codes related to timeouts, rate limits, content blocking, etc.)[cite: 1561, 1577].
    * **Cancellation:** Adapt the `cancel()` method[cite: 1454]. `@google/genai` streams might support cancellation via `AbortController`. Ensure `execAbortController` logic remains or is adapted[cite: 1447, 1776]. Update how `pendingAborts` is managed based on Gemini's response structure[cite: 1451, 1530].

5.  **Parsers (`codex-cli/src/utils/parsers.ts`):**
    * Completely replace `parseToolCallArguments` [cite: 1383] and `parseToolCallOutput` [cite: 1373] with functions that parse Gemini's `FunctionCall` parts and format `FunctionResponse` parts according to the `@google/genai` library's requirements.

6.  **UI Components:**
    * **`TerminalChatResponseItem`:** Update the `switch` statement and rendering logic to handle Gemini's response part types (text, functionCall, potentially functionResponse if displayed directly) instead of OpenAI's `ResponseItem` types.
    * **`ModelOverlay`:** Ensure it displays and allows selection of Gemini model names correctly[cite: 397].
    * **`TerminalHeader`:** Update display of the current model name[cite: 561].
    * **`TerminalChatInput`:** Commands like `/model` should continue to work[cite: 618].

7.  **Type Definitions:**
    * Remove or replace OpenAI-specific types (e.g., `ResponseItem`, `ResponseFunctionToolCall`) throughout the codebase with types from `@google/genai` or new custom interfaces representing the Gemini interaction flow[cite: 454, 1427].

**III. Implementation Steps:**

1.  **Install Dependency:** `npm install @google/genai`
2.  **Configure API Key:** Update config loading (`codex-cli/src/utils/config.ts`) and CLI (`codex-cli/src/cli.tsx`) to prioritize `GOOGLE_API_KEY`.
3.  **Update Model Defaults & Utils:** Change default model names (`config.ts`) and rewrite model fetching/validation (`model-utils.ts`).
4.  **Refactor `AgentLoop` (Iterative):**
    * Replace OpenAI client with `GoogleGenerativeAI` and `GenerativeModel`.
    * Implement basic chat using `startChat` and `sendMessageStream`, mapping simple text input/output. Get basic conversation flow working.
    * Integrate tool/function calling: Define tools, parse `FunctionCall`, execute, format `FunctionResponse`. Adapt `handleExecCommand` and rewrite `parsers.ts`.
    * Update error handling for Gemini-specific errors.
    * Refactor cancellation logic.
5.  **Update UI Components:** Adapt `TerminalChatResponseItem` and other relevant UI parts to render Gemini responses/tool calls correctly.
6.  **Update Type Definitions:** Replace OpenAI types globally.
7.  **Testing:** Thoroughly test all modes (interactive, quiet), approval policies, tool executions, error conditions, and cancellation.
8.  **Documentation:** Update README and any user guides regarding model selection and API key configuration.
9.  **Remove OpenAI Dependency:** `npm uninstall openai`

This plan provides a detailed roadmap for migrating Codex from the OpenAI API to Google's Gemini API using the `@google/genai` library. The most complex part will be refactoring the `AgentLoop` to handle the different API structure, history management, and function calling mechanisms.
