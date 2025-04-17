Okay, let's refine the plan with more detailed implementation steps and code examples, referencing the Gemini documentation concepts.

**Detailed Implementation Plan for Migrating Codex to `@google/genai`**

**Phase 1: Setup and Configuration**

1.  **Update Dependencies (`package.json`):**
    * Remove the OpenAI dependency: `npm uninstall openai`
    * Add the Google Generative AI dependency: `npm install @google/genai`

2.  **Update Configuration (`codex-cli/src/utils/config.ts`):**
    * **API Key:** Modify logic to prioritize `GOOGLE_API_KEY`.
        ```typescript
        // Before[cite: 1054, 1055]:
        // export let OPENAI_API_KEY = process.env["OPENAI_API_KEY"] || "";
        // export function setApiKey(apiKey: string): void { OPENAI_API_KEY = apiKey; }
        // In loadConfig:
        // const apiKey = OPENAI_API_KEY;

        // After:
        export let GOOGLE_API_KEY = process.env["GOOGLE_API_KEY"] || "";
        // Optionally keep OPENAI_API_KEY for other purposes or remove entirely
        // export let OPENAI_API_KEY = process.env["OPENAI_API_KEY"] || "";

        export function setGoogleApiKey(apiKey: string): void { // New or renamed function
          GOOGLE_API_KEY = apiKey;
        }

        // In loadConfig[cite: 1086, 1091, 1106]:
        export const loadConfig = (...): AppConfig => {
            // ...
            const googleApiKey = GOOGLE_API_KEY; // Use the potentially updated global
            // ... load stored config ...
            const config: AppConfig = {
                apiKey: googleApiKey || undefined, // Pass the Google key
                model: storedModel ?? (options.isFullContext ? DEFAULT_FULL_CONTEXT_MODEL : DEFAULT_AGENTIC_MODEL),
                instructions: combinedInstructions,
                // ... other config fields
            };
            // ... ensure config file creation logic uses appropriate keys if needed ...
            return config;
        };

        // Update setApiKey usage in cli.tsx or elsewhere if needed.
        ```
    * **Default Models:** Update default model names[cite: 1049].
        ```typescript
        // Before:
        // export const DEFAULT_AGENTIC_MODEL = "o4-mini";
        // export const DEFAULT_FULL_CONTEXT_MODEL = "gpt-4.1";

        // After (Example - use current recommended models):
        export const DEFAULT_AGENTIC_MODEL = "gemini-1.5-flash-latest";
        export const DEFAULT_FULL_CONTEXT_MODEL = "gemini-1.5-pro-latest";
        ```
    * **Remove OpenAI Specifics:** Remove `OPENAI_BASE_URL`, `OPENAI_TIMEOUT_MS` usage.

3.  **Update CLI Entrypoint (`codex-cli/src/cli.tsx`):**
    * Adjust API key check to look for `GOOGLE_API_KEY`[cite: 2088].
    * Ensure the loaded `config.apiKey` is the Google API key.
    * Update model validation call (`isModelSupportedForResponses`)[cite: 2092].

4.  **Update Model Utilities (`codex-cli/src/utils/model-utils.ts`):**
    * Update `RECOMMENDED_MODELS`[cite: 2030].
    * Modify `getAvailableModels` and `isModelSupportedForResponses` as discussed previously (likely using a static list or pattern matching for Gemini models like `gemini-.*`)[cite: 2039, 2042]. Since `@google/genai` doesn't provide a model listing API easily accessible like OpenAI's, a static approach is pragmatic.

**Phase 2: Core Agent Logic Refactoring (`AgentLoop`)**

5.  **Refactor `codex-cli/src/utils/agent/agent-loop.ts`:**
    * **Imports:** Replace OpenAI imports with `@google/genai` imports.
        ```typescript
        // Remove: import OpenAI, { APIConnectionTimeoutError } from "openai";
        // Remove: import type { ResponseItem, ResponseFunctionToolCall, ... } from "openai/...";

        // Add:
        import {
            GoogleGenerativeAI,
            GenerativeModel,
            ChatSession,
            FunctionDeclarationSchemaType,
            FunctionDeclarationsTool,
            Part,
            Content,
            GenerateContentResponse,
            // Import specific error types, e.g., GoogleGenerativeAIError if needed
            HarmCategory,
            HarmBlockThreshold, // For safety settings example
        } from "@google/genai";

        // Define internal representation or use Gemini types
        type AgentResponseItem = Part; // Example alias
        ```
    * **Class Members:** Replace `oai` client with Gemini client, model instance, and chat session.
        ```typescript
        // Before: private oai: OpenAI;
        // Add:
        private genAI: GoogleGenerativeAI;
        private modelInstance: GenerativeModel;
        private chatSession?: ChatSession; // Manage lifecycle (e.g., initialize in run)

        // Update callback types
        private onItem: (item: AgentResponseItem) => void;
        ```
    * **Constructor:** Initialize `GoogleGenerativeAI` and `GenerativeModel`. Define tools.
        ```typescript
        constructor({ config, model, instructions, approvalPolicy, ...callbacks }: AgentLoopParams) {
            this.model = model;
            this.instructions = instructions; // Store system instructions
            this.approvalPolicy = approvalPolicy;
            this.config = config ?? { model, instructions: instructions ?? "" } as AppConfig; // Ensure config exists
            // ... assign callbacks ...

            const googleApiKey = this.config.apiKey;
            if (!googleApiKey) {
                log("ERROR: Missing GOOGLE_API_KEY for AgentLoop initialization.");
                throw new Error("Missing GOOGLE_API_KEY");
            }
            this.genAI = new GoogleGenerativeAI(googleApiKey);

            // --- Define Tools ---
            // Based on previous 'shell' tool
            const shellTool: FunctionDeclarationsTool = {
                functionDeclarations: [{
                    name: "shell", // Keep name consistent
                    description: "Runs a shell command, and returns its output.",
                    parameters: {
                        type: FunctionDeclarationSchemaType.OBJECT,
                        properties: {
                            command: { type: FunctionDeclarationSchemaType.ARRAY, items: { type: FunctionDeclarationSchemaType.STRING }, description: "Command and arguments" },
                            workdir: { type: FunctionDeclarationSchemaType.STRING, nullable: true, description: "Working directory" },
                            timeout: { type: FunctionDeclarationSchemaType.NUMBER, nullable: true, description: "Timeout in ms" },
                        },
                        required: ["command"],
                    },
                }],
            };
            // Add other tools (like apply_patch) here if needed

            // --- Get Model Instance ---
            this.modelInstance = this.genAI.getGenerativeModel({
                model: this.model,
                // System instructions are passed here
                systemInstruction: this.instructions,
                tools: [shellTool], // Provide defined tools
                // Optional: Configure safety settings
                safetySettings: [
                    { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
                    { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
                    { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
                    { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
                ],
            });

            this.sessionId = getSessionId() || randomUUID().replaceAll("-", "");
            setSessionId(this.sessionId);
            setCurrentModel(this.model);
            this.hardAbort = new AbortController();
            // ... rest of constructor ...
        }
        ```
    * **`run` Method:** Overhaul the main loop.
        ```typescript
        public async run(
            input: Array<Part>, // Expect Gemini Parts or map internally
            // previousResponseId parameter is no longer needed
        ): Promise<void> {
            log(`AgentLoop.run generation ${this.generation + 1} starting`);
            if (this.terminated) throw new Error("AgentLoop terminated");

            const thinkingStart = Date.now();
            const thisGeneration = ++this.generation;
            this.canceled = false;
            this.execAbortController = new AbortController(); // New controller for this run's exec calls

            // --- Initialize Chat Session ---
            // Decide whether to reuse or start fresh based on your session logic
            // If reusing, load history. If starting fresh, history is empty.
            // For this example, let's assume we start a new chat per `run` call,
            // but a real implementation might manage this differently.
            // If needed, convert previous Codex items to Gemini history format here.
            const history: Content[] = []; // Populate with converted history if needed
            this.chatSession = this.modelInstance.startChat({ history });

            this.onLoading(true);
            const staged: Array<AgentResponseItem | undefined> = [];
            const stageItem = (item: AgentResponseItem) => {
                if (thisGeneration !== this.generation || this.canceled || this.hardAbort.signal.aborted) return;
                const idx = staged.push(item) - 1;
                setTimeout(() => { // Debounce/stage emission
                    if (thisGeneration === this.generation && !this.canceled && !this.hardAbort.signal.aborted) {
                        this.onItem(item);
                        staged[idx] = undefined; // Mark as delivered
                    }
                }, 10);
            };

             // Process user input first
            input.forEach(stageItem);

            try {
                log(`Sending message parts: ${JSON.stringify(input)}`);
                const result = this.chatSession.sendMessageStream(input);
                this.currentStream = result; // Store for cancellation

                let aggregatedResponse: GenerateContentResponse | null = null;
                let functionCalls: any[] = []; // Collect function calls in this turn

                for await (const chunk of result) {
                     if (this.canceled || this.hardAbort.signal.aborted) {
                         log("Cancellation detected during stream processing.");
                         // Aborting the stream itself might not be directly possible,
                         // just stop processing. The underlying HTTP request might complete.
                         break; // Exit the loop
                     }
                     log(`Received stream chunk`);

                     // Process the response parts from the chunk
                     // Note: chunk.response contains the *aggregated* response so far.
                     aggregatedResponse = chunk.response;
                     const candidate = aggregatedResponse?.candidates?.[0];
                     if (candidate?.content?.parts) {
                        candidate.content.parts.forEach(part => {
                            if (!part) return;
                             // Staging logic ensures we only emit novel parts if needed,
                             // or simply emit all parts from the latest chunk.
                             // For simplicity, let's stage every part received.
                             // UI layer might need deduplication if not handled here.
                             stageItem(part);

                            if (part.functionCall) {
                                log(`Detected function call: ${part.functionCall.name}`);
                                functionCalls.push(part.functionCall);
                                // Track for potential abortion
                                // this.pendingAborts.add(part.functionCall.name); // Use appropriate ID if available
                            }
                        });
                     }
                      // Check for finish reason or safety blocks
                     if (candidate?.finishReason && candidate.finishReason !== "STOP") {
                         log(`Stream finished with reason: ${candidate.finishReason}`);
                         if (candidate.finishReason === "SAFETY") {
                             this.onItem({ text: `⚠️ Response blocked due to: ${candidate.safetyRatings?.map(r => r.category).join(', ')}` });
                         }
                         // Handle other finish reasons (MAX_TOKENS, RECITATION, etc.)
                     }
                } // End of stream loop

                if (this.canceled || this.hardAbort.signal.aborted) {
                    log("Run cancelled after stream loop.");
                    this.onLoading(false);
                    return; // Don't process function calls if cancelled
                }

                 // --- Handle Function Calls ---
                if (functionCalls.length > 0) {
                    log(`Processing ${functionCalls.length} function calls.`);
                    const functionResponses: Part[] = [];
                    // Use Promise.all for potentially parallel execution
                    await Promise.all(functionCalls.map(async (funcCall) => {
                        // eslint-disable-next-line no-await-in-loop
                        const responsePart = await this.handleGeminiFunctionCall(funcCall, thisGeneration);
                        if (responsePart) { // handleGeminiFunctionCall might return null if cancelled
                           functionResponses.push(responsePart);
                        }
                    }));

                    // If cancelled during function call execution, stop here
                    if (this.canceled || this.hardAbort.signal.aborted) {
                         log("Run cancelled during function call processing.");
                         this.onLoading(false);
                         return;
                    }

                    // Send responses back if any were generated
                    if (functionResponses.length > 0) {
                         log(`Sending ${functionResponses.length} function responses back.`);
                         // Stage the responses for UI display
                         functionResponses.forEach(stageItem);
                         // Recursively call run or send message again
                         // For simplicity, let's restart the process with the responses
                         // This assumes the agent loop should continue reacting to tool output.
                         // A different design might end the turn here.
                         await this.run(functionResponses); // Recursive call with tool results
                         return; // End this invocation after the recursive call returns
                    }
                }

            } catch (error: any) {
                 log(`Error during Gemini API call: ${error}`);
                 // Add specific Gemini error handling here
                 let errorMessage = "An error occurred with the Gemini API.";
                 if (error.message?.includes("API key not valid")) {
                     errorMessage = "⚠️ Invalid Google API Key. Please check your GOOGLE_API_KEY.";
                 } else if (error.message?.includes("429")) { // Example check
                     errorMessage = "⚠️ Rate limit reached for Gemini API. Please try again later.";
                 } else if (error.message?.includes("SAFETY")) {
                      errorMessage = `⚠️ Request blocked by Gemini safety filters: ${error.message}`;
                 }
                 this.onItem({ text: errorMessage });
                 // Consider adding retry logic for specific errors like 5xx or rate limits

            } finally {
                this.currentStream = null;
                // Ensure loading state is turned off if the run concludes here
                 if (!this.canceled && thisGeneration === this.generation) {
                     log(`AgentLoop.run generation ${thisGeneration} finishing.`);
                     this.onLoading(false);
                 } else {
                      log(`AgentLoop.run generation ${thisGeneration} was cancelled or superseded.`);
                 }
            }

            // Final flush of any remaining staged items
             const flush = () => {
                 if (!this.canceled && !this.hardAbort.signal.aborted && thisGeneration === this.generation) {
                     staged.forEach(item => { if (item) this.onItem(item); });
                     this.pendingAborts.clear(); // Clear aborts if run completed successfully
                 }
                 // Removed thinking time messages for brevity, re-add if needed
             };
             setTimeout(flush, 30);

        } // End run method
        ```

    * **New `handleGeminiFunctionCall` Method:** (Refined from previous plan)
        ```typescript
        private async handleGeminiFunctionCall(funcCall: any, callGeneration: number): Promise<Part | null> {
            // Ensure this execution belongs to the current active run
            if (this.canceled || this.hardAbort.signal.aborted || callGeneration !== this.generation) {
                log(`Skipping function call ${funcCall.name} due to cancellation or generation mismatch.`);
                // Store needed abort info if required by subsequent calls
                // this.pendingAborts.add(funcCall.name); // Or ID if available
                return null; // Indicate it wasn't processed
            }

            const toolName = funcCall.name;
            const args = funcCall.args; // Already an object
            log(`Handling function call: ${toolName} with args: ${JSON.stringify(args)}`);

            let execInput: ExecInput | undefined;
            let isApplyPatch = false;
            let patchContent: string | undefined;

            // --- Map Tool Name/Args to Action ---
            if (toolName === 'shell' && args?.command) {
                 execInput = {
                     cmd: args.command as string[],
                     workdir: args.workdir as string | undefined,
                     timeoutInMillis: args.timeout as number | undefined,
                 };
                 // Special handling for apply_patch embedded in shell command [cite: 1853, 1881-1887]
                 if (execInput.cmd[0] === 'bash' && execInput.cmd[1] === '-lc' && execInput.cmd[2]?.includes('apply_patch')) {
                     // Extract patch content from the heredoc or argument
                     const patchCmdString = execInput.cmd[2];
                     const match = patchCmdString.match(/apply_patch\s*<<\s*['"]?EOF['"]?\s*([\s\S]*)\s*EOF/m) ||
                                   patchCmdString.match(/apply_patch\s*(['"])([\s\S]*)\1/); // Simple quoted string match

                     if (match && match[1]) {
                          patchContent = match[1].trim();
                          isApplyPatch = true;
                          log("Detected apply_patch within shell command.");
                     } else {
                          log("Could not extract patch content from shell command.");
                          // Proceed as regular shell command, might fail later
                     }
                 }
            } else if (toolName === 'apply_patch' && args?.patch) { // If apply_patch is a direct tool
                 patchContent = args.patch as string;
                 isApplyPatch = true;
                 execInput = { cmd: ['apply_patch'], workdir: args.workdir, timeoutInMillis: args.timeout }; // Dummy ExecInput for approval flow
            } else {
                 log(`Unknown or invalid tool call: ${toolName}`);
                 return { functionResponse: { name: toolName, response: { error: `Tool '${toolName}' not implemented or invalid arguments.` } } };
            }

            // --- Get User Confirmation (if needed) ---
            let outputText = "Command execution failed.";
            let metadata: Record<string, any> = { exit_code: 1, duration_seconds: 0 };
            let confirmationResult: CommandConfirmation | null = null;

            // Determine if auto-approved or needs confirmation
            const commandToApprove = execInput.cmd; // Use the extracted command
            const applyPatchArg: ApplyPatchCommand | undefined = isApplyPatch ? { patch: patchContent! } : undefined;
            const approvalKey = deriveCommandKey(commandToApprove); // Use existing key derivation

            let needsConfirmation = false;
            let runInSandbox = false;
            if (alwaysApprovedCommands.has(approvalKey)) {
                log(`Command auto-approved (cached): ${approvalKey}`);
                runInSandbox = false; // Already approved, don't sandbox
            } else {
                const safety = canAutoApprove(commandToApprove, this.approvalPolicy, [process.cwd()], process.env);
                log(`Safety assessment for '${approvalKey}': ${JSON.stringify(safety)}`);
                if (safety.type === 'ask-user') {
                    needsConfirmation = true;
                } else if (safety.type === 'auto-approve') {
                    runInSandbox = safety.runInSandbox;
                } else { // reject
                     log(`Command rejected by policy: ${safety.reason}`);
                     return { functionResponse: { name: toolName, response: { error: `Command rejected by policy: ${safety.reason}` } } };
                }
            }

            if (needsConfirmation) {
                 log(`Requesting user confirmation for: ${formatCommandForDisplay(commandToApprove)}`);
                 confirmationResult = await this.getCommandConfirmation(commandToApprove, applyPatchArg);
                 log(`User confirmation result: ${JSON.stringify(confirmationResult)}`);

                 if (confirmationResult.review === ReviewDecision.ALWAYS) {
                     alwaysApprovedCommands.add(approvalKey);
                     runInSandbox = false; // User explicitly approved, don't sandbox
                 } else if (confirmationResult.review !== ReviewDecision.YES) {
                      // User denied or requested exit
                      const note = confirmationResult.review === ReviewDecision.NO_CONTINUE
                          ? confirmationResult.customDenyMessage?.trim() || "User denied execution."
                          : "User cancelled execution.";
                       log(`User denied command execution: ${note}`);
                      // We need to inform the model *why* it wasn't executed.
                      return { functionResponse: { name: toolName, response: { error: `Execution denied by user: ${note}` } } };
                 } else {
                      // User said YES for this instance
                      runInSandbox = false; // Explicit user approval usually bypasses sandbox
                 }
            } else {
                 log(`Command auto-approved (policy): ${approvalKey}`);
            }

            // --- Execute Command ---
            const start = Date.now();
            try {
                let execResult: ExecResult;
                if (isApplyPatch && patchContent) {
                    log(`Executing apply_patch directly.`);
                    execResult = execApplyPatch(patchContent); // Use direct patch application [cite: 1757]
                } else {
                     log(`Executing command via exec: ${formatCommandForDisplay(execInput.cmd)} in sandbox: ${runInSandbox}`);
                     execResult = await exec(execInput, await getSandbox(runInSandbox), this.execAbortController?.signal); // Use existing exec [cite: 1754]
                }

                // Check for cancellation *after* exec returns/throws
                if (this.canceled || this.hardAbort.signal.aborted || callGeneration !== this.generation) {
                     log(`Cancellation detected after exec for ${toolName}.`);
                     // this.pendingAborts.add(funcCall.name); // Mark as aborted if needed
                     return null;
                }

                outputText = execResult.stdout || execResult.stderr; // Combine outputs? Or structure differently?
                metadata = {
                    exit_code: execResult.exitCode,
                    duration_seconds: Math.round((Date.now() - start) / 100) / 10,
                    // Add stderr if separate field is desired
                    ...(execResult.stderr && { stderr: execResult.stderr }),
                };
                log(`Execution finished for ${toolName}: Exit Code ${metadata.exit_code}, Duration ${metadata.duration_seconds}s`);

            } catch (execError: any) {
                 // Handle errors during execution itself
                 log(`Error during command execution for ${toolName}: ${execError}`);
                 if (this.canceled || this.hardAbort.signal.aborted || callGeneration !== this.generation) {
                     log(`Cancellation detected during error handling for ${toolName}.`);
                     return null;
                 }
                 metadata.error = execError instanceof Error ? execError.message : String(execError);
                 metadata.exit_code = metadata.exit_code ?? 1; // Ensure non-zero exit code on error
                 outputText = metadata.error; // Put error in main output for model
            }


            // --- Format Response ---
            const responsePayload: Record<string, any> = { // Gemini expects an object payload
                 stdout: outputText,
                 exit_code: metadata.exit_code,
                 duration_seconds: metadata.duration_seconds,
                 ...(metadata.stderr && { stderr: metadata.stderr }), // Include stderr if present
                 ...(metadata.error && { error: metadata.error }), // Include error if present
            };

            return { functionResponse: { name: toolName, response: responsePayload } };
        }
        ```

**Phase 3: UI and Finalization**

6.  **Update UI Components:**
    * **`codex-cli/src/components/chat/terminal-chat-response-item.tsx`:** Modify to render `Part` objects.
        ```typescript
        // Inside the component:
        // const item = props.item as Part; // Cast or use proper type

        if (item.text) {
            return <Markdown>{item.text}</Markdown>;
        } else if (item.functionCall) {
            // Render function call representation (e.g., "$ shell command...")
            const fcArgs = item.functionCall.args;
            const cmdDisplay = fcArgs?.command ? formatCommandForDisplay(fcArgs.command) : item.functionCall.name;
            return <Text color="magentaBright" bold>$ {cmdDisplay}</Text>;
        } else if (item.functionResponse) {
            // Render function response (stdout/stderr/exit code)
            const fr = item.functionResponse;
            const output = fr.response?.stdout || fr.response?.error || JSON.stringify(fr.response);
            const exitCode = fr.response?.exit_code;
            // Add logic to format and display the response details
             return (
                 <Box flexDirection="column" gap={1}>
                   <Text color="magenta" bold>
                     command output ({fr.name}) <Text dimColor>{exitCode !== undefined ? `(exit: ${exitCode})` : ""}</Text>
                   </Text>
                   <Text dimColor>{String(output)}</Text>
                 </Box>
             );
        }
        // Handle other Part types if necessary (e.g., Blob data)
        return <Text dimColor>Unsupported part type</Text>;
        ```
    * Update `ModelOverlay` and `TerminalHeader` for Gemini model names[cite: 412, 568].

7.  **Update Type Definitions:** Search and replace OpenAI types (`ResponseItem`, etc.) with Gemini types (`Part`, `Content`, etc.) or mapped internal types across the codebase. This includes function signatures and state variables.

8.  **Testing and Documentation:**
    * Add comprehensive tests covering the new Gemini flow, including successful chats, function calls (shell, apply\_patch), error handling (API errors, execution errors), and cancellation.
    * Update `README.md` and any other documentation regarding `GOOGLE_API_KEY` setup and supported Gemini models.

9.  **Cleanup:** Once confident, remove the `openai` dependency from `package.json`.

This detailed plan provides specific code examples and addresses the core changes required in `AgentLoop` and related modules. Remember that error handling, cancellation nuances, and the exact mapping between Codex's internal state and Gemini's `ChatSession` history will require careful implementation and testing based on the `@google/genai` library's behavior.