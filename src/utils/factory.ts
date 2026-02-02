// ===================================================================
// Provider Factory - Creates LLM Provider Instances
// ===================================================================

import { LLMProvider, LLMProviderConfig, LLMError } from './base';
import { OpenAIProvider } from './openai';
import { AnthropicProvider } from './anthropic';
import { GeminiProvider } from './gemini';
import { GroqProvider } from './groq';

export class ProviderFactory {
  static create(config: LLMProviderConfig): LLMProvider {
    if (!config.apiKey) {
      throw new LLMError('API key is required', config.provider);
    }

    switch (config.provider) {
      case 'openai':
        return new OpenAIProvider(config.apiKey, config.baseUrl);
      
      case 'anthropic':
        return new AnthropicProvider(config.apiKey, config.baseUrl);
      
      case 'gemini':
        return new GeminiProvider(config.apiKey, config.baseUrl);
      
      case 'groq':
        return new GroqProvider(config.apiKey);
      
      case 'custom':
        if (!config.baseUrl) {
          throw new LLMError('Base URL is required for custom provider', 'custom');
        }
        // Assume OpenAI-compatible API for custom providers
        return new OpenAIProvider(config.apiKey, config.baseUrl);
      
      default:
        throw new LLMError(
          `Unsupported provider: ${config.provider}`,
          config.provider
        );
    }
  }

  static getSupportedProviders(): string[] {
    return ['openai', 'anthropic', 'gemini', 'groq', 'custom'];
  }

  static getDefaultModels(provider: string): string[] {
    const models: Record<string, string[]> = {
      openai: [
        'gpt-4o',
        'gpt-4o-mini',
        'gpt-4-turbo',
        'gpt-4',
        'gpt-3.5-turbo',
        'o1-preview',
        'o1-mini',
      ],
      anthropic: [
        'claude-3-5-sonnet-20241022',
        'claude-3-5-haiku-20241022',
        'claude-3-opus-20240229',
        'claude-3-sonnet-20240229',
        'claude-3-haiku-20240307',
      ],
      gemini: [
        'gemini-2.0-flash-exp',
        'gemini-1.5-pro',
        'gemini-1.5-flash',
        'gemini-1.5-flash-8b',
      ],
      groq: [
        'llama-3.3-70b-versatile',
        'llama-3.1-70b-versatile',
        'llama-3.1-8b-instant',
        'mixtral-8x7b-32768',
        'gemma2-9b-it',
      ],
    };

    return models[provider] || [];
  }

  static getProviderCapabilities(provider: string): {
    supportsStreaming: boolean;
    supportsTools: boolean;
    supportsVision: boolean;
    supportsEmbeddings: boolean;
  } {
    const capabilities: Record<string, any> = {
      openai: {
        supportsStreaming: true,
        supportsTools: true,
        supportsVision: true,
        supportsEmbeddings: true,
      },
      anthropic: {
        supportsStreaming: true,
        supportsTools: true,
        supportsVision: true,
        supportsEmbeddings: false,
      },
      gemini: {
        supportsStreaming: true,
        supportsTools: true,
        supportsVision: true,
        supportsEmbeddings: false,
      },
      groq: {
        supportsStreaming: true,
        supportsTools: true,
        supportsVision: false,
        supportsEmbeddings: false,
      },
    };

    return capabilities[provider] || {
      supportsStreaming: false,
      supportsTools: false,
      supportsVision: false,
      supportsEmbeddings: false,
    };
  }
}

// Re-export all providers
export { OpenAIProvider } from './openai';
export { AnthropicProvider } from './anthropic';
export { GeminiProvider } from './gemini';
export { GroqProvider } from './groq';
export * from './base';
