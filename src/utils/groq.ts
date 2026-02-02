// ===================================================================
// Groq Provider Implementation (OpenAI-compatible)
// ===================================================================

import { OpenAIProvider } from './openai';

export class GroqProvider extends OpenAIProvider {
  constructor(apiKey: string) {
    super(apiKey, 'https://api.groq.com/openai/v1');
  }
}
