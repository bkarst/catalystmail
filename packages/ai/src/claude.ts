// The Claude client (spec §10.2): one structured-output request per task through the Anthropic
// SDK, with the task's effort, server-side refusal fallbacks, cache breakpoints after the stable
// blocks, one retry when the output fails validation, and the tokens and cost of every run.

import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import type { z } from 'zod';

import type { PromptBlock } from './context.ts';

export type ClaudeTask = 'analyze_inbound' | 'draft_reply' | 'draft_follow_up' | 'personalize' | 'summarize' | 'kb_test';
export const CLAUDE_TASKS = ['analyze_inbound', 'draft_reply', 'draft_follow_up', 'personalize', 'summarize', 'kb_test'] as const satisfies readonly ClaudeTask[];
export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';
export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const satisfies readonly Effort[];

export interface TaskSettings {
  /** A configuration value, never a code constant (§10.2). */
  model: string;
  effort: Effort;
  maxTokens: number;
}

/** §10.2: Claude Opus 5.5 everywhere, effort set per task (its own default is `medium`). */
export const DEFAULT_TASK_SETTINGS: Record<ClaudeTask, TaskSettings> = {
  analyze_inbound: { model: 'claude-opus-5-5', effort: 'low', maxTokens: 16_000 },
  draft_reply: { model: 'claude-opus-5-5', effort: 'medium', maxTokens: 16_000 },
  draft_follow_up: { model: 'claude-opus-5-5', effort: 'medium', maxTokens: 16_000 },
  personalize: { model: 'claude-opus-5-5', effort: 'low', maxTokens: 16_000 },
  summarize: { model: 'claude-opus-5-5', effort: 'low', maxTokens: 16_000 },
  kb_test: { model: 'claude-opus-5-5', effort: 'low', maxTokens: 16_000 },
};

/** Dollars per million tokens: input, output, cache read, cache write. Unknown models cost null. */
const PRICES: Record<string, [number, number, number, number]> = {
  'claude-opus-5-5': [4, 20, 0.2, 5],
  'claude-sonnet-5-5': [2, 10, 0.1, 2.5],
  'claude-haiku-5-5': [0.1, 0.5, 0.01, 0.125],
};

export interface RunUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /** Millionths of a dollar; null for a model without a known price. */
  costUsdMicros: number | null;
}

export type ClaudeResult<T> =
  | { status: 'ok'; output: T; model: string; stopReason: string | null; usage: RunUsage; latencyMs: number; attempts: number }
  | { status: 'refusal' | 'error' | 'invalid_output'; error: string; model: string; stopReason: string | null; usage: RunUsage | null; latencyMs: number; attempts: number };

export interface ClaudeRequest<T> {
  task: ClaudeTask;
  settings: TaskSettings;
  system: PromptBlock[];
  user: PromptBlock[];
  schema: z.ZodType<T>;
}

export interface ClaudeClient {
  run<T>(request: ClaudeRequest<T>): Promise<ClaudeResult<T>>;
}

/** The part of the SDK client this uses, so tests can stand in for it. */
export interface MessagesParser {
  beta: { messages: { parse: Anthropic['beta']['messages']['parse'] } };
}

/** Models whose prices Catalyst knows, so their runs count against the budget (§10.2). */
export const PRICED_MODELS: readonly string[] = Object.keys(PRICES);

export function costOf(model: string, usage: Omit<RunUsage, 'costUsdMicros'>): number | null {
  const price = PRICES[model];
  if (!price) return null;
  const [input, output, cacheRead, cacheWrite] = price;
  // Dollars per million tokens are millionths of a dollar per token.
  return Math.round(usage.inputTokens * input + usage.outputTokens * output + usage.cacheReadTokens * cacheRead + usage.cacheWriteTokens * cacheWrite);
}

const textBlocks = (blocks: PromptBlock[]) => blocks.map((block) => ({ type: 'text' as const, text: block.text, ...(block.cache && { cache_control: { type: 'ephemeral' as const } }) }));

/** The live client. Credentials come from the environment, as the SDK resolves them. */
export function anthropicClaude(client: MessagesParser = new Anthropic()): ClaudeClient {
  return {
    async run<T>(request: ClaudeRequest<T>): Promise<ClaudeResult<T>> {
      const started = Date.now();
      const { model, effort, maxTokens } = request.settings;
      const totals = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
      const usage = (): RunUsage => ({ ...totals, costUsdMicros: costOf(model, totals) });
      let feedback: string | null = null;
      let attempts = 0;
      for (;;) {
        attempts += 1;
        try {
          const response = await client.beta.messages.parse({
            model,
            max_tokens: maxTokens,
            // A refusal is retried on a fallback model, server-side (§10.2).
            betas: ['server-side-fallback-2026-07-01'],
            fallbacks: 'default',
            output_config: { effort, format: betaZodOutputFormat(request.schema) },
            system: textBlocks(request.system),
            messages: [{ role: 'user', content: [...textBlocks(request.user), ...(feedback ? [{ type: 'text' as const, text: feedback }] : [])] }],
          });
          totals.inputTokens += response.usage.input_tokens;
          totals.outputTokens += response.usage.output_tokens;
          totals.cacheReadTokens += response.usage.cache_read_input_tokens ?? 0;
          totals.cacheWriteTokens += response.usage.cache_creation_input_tokens ?? 0;
          const base = { model: response.model, stopReason: response.stop_reason, latencyMs: Date.now() - started, attempts };
          // Always check why it stopped before reading the content.
          if (response.stop_reason === 'refusal') return { status: 'refusal', error: response.stop_details?.explanation ?? 'The model declined.', usage: usage(), ...base };
          if (response.stop_reason === 'max_tokens') return { status: 'invalid_output', error: 'The output was cut off at max_tokens.', usage: usage(), ...base };
          if (response.parsed_output === null) throw new Anthropic.AnthropicError('Failed to parse structured output: no output');
          return { status: 'ok', output: response.parsed_output as T, usage: usage(), ...base };
        } catch (error) {
          const latencyMs = Date.now() - started;
          if (error instanceof Anthropic.APIError) return { status: 'error', error: error.message, model, stopReason: null, usage: attempts > 1 ? usage() : null, latencyMs, attempts };
          const message = error instanceof Error ? error.message : String(error);
          // Output that fails validation is retried once with the error appended (§10.2).
          if (message.startsWith('Failed to parse structured output') && attempts === 1) {
            feedback = `Your previous answer did not match the required format: ${message.slice(0, 500)}. Answer again, matching it exactly.`;
            continue;
          }
          return { status: message.startsWith('Failed to parse structured output') ? 'invalid_output' : 'error', error: message.slice(0, 500), model, stopReason: null, usage: usage(), latencyMs, attempts };
        }
      }
    },
  };
}
