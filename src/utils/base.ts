// ===================================================================
// Base Provider Interface - LLM Abstraction Layer
// ===================================================================

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string; // JSON string
  };
}

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, any>;
      required?: string[];
    };
  };
}

export interface ChatParams {
  model: string;
  messages: LLMMessage[];
  tools?: ToolDefinition[];
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  topK?: number;
  systemInstruction?: string;
}

export interface ChatResponse {
  content: string;
  toolCalls?: ToolCall[];
  finishReason: 'stop' | 'tool_calls' | 'length' | 'error';
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  raw?: any; // Original provider response
}

export interface StreamChunk {
  content: string;
  toolCalls?: ToolCall[];
  done: boolean;
}

export abstract class LLMProvider {
  protected apiKey: string;
  protected baseUrl?: string;

  constructor(apiKey: string, baseUrl?: string) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
  }

  abstract chat(params: ChatParams): Promise<ChatResponse>;
  abstract stream(params: ChatParams): AsyncGenerator<StreamChunk>;
  
  // Optional: Override if provider supports embeddings
  async embeddings(text: string): Promise<number[]> {
    throw new Error('Embeddings not supported by this provider');
  }

  // Utility: Convert tool calls to messages for follow-up
  toolCallsToMessages(toolCalls: ToolCall[], results: Record<string, any>): LLMMessage[] {
    return toolCalls.map(call => ({
      role: 'tool' as const,
      name: call.function.name,
      tool_call_id: call.id,
      content: JSON.stringify(results[call.function.name])
    }));
  }
}

export interface LLMProviderConfig {
  provider: 'openai' | 'anthropic' | 'gemini' | 'groq' | 'custom';
  apiKey: string;
  model: string;
  baseUrl?: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  topK?: number;
  defaultSystemPrompt?: string;
}

export class LLMError extends Error {
  constructor(
    message: string,
    public provider: string,
    public statusCode?: number,
    public originalError?: any
  ) {
    super(message);
    this.name = 'LLMError';
  }
}
