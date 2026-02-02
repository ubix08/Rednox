// ===================================================================
// OpenAI Provider Implementation
// ===================================================================

import { 
  LLMProvider, 
  ChatParams, 
  ChatResponse, 
  StreamChunk,
  ToolCall,
  LLMMessage,
  LLMError
} from './base';

interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  name?: string;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: {
      name: string;
      arguments: string;
    };
  }>;
}

export class OpenAIProvider extends LLMProvider {
  private readonly apiUrl: string;

  constructor(apiKey: string, baseUrl?: string) {
    super(apiKey, baseUrl);
    this.apiUrl = baseUrl || 'https://api.openai.com/v1';
  }

  async chat(params: ChatParams): Promise<ChatResponse> {
    try {
      const messages = this.convertMessages(params.messages, params.systemInstruction);
      const tools = params.tools?.map(tool => this.convertTool(tool));

      const requestBody: any = {
        model: params.model,
        messages,
        temperature: params.temperature ?? 1.0,
        max_tokens: params.maxTokens,
        top_p: params.topP ?? 1.0,
      };

      if (tools && tools.length > 0) {
        requestBody.tools = tools;
        requestBody.tool_choice = 'auto';
      }

      const response = await fetch(`${this.apiUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: { message: 'Unknown error' } }));
        throw new LLMError(
          error.error?.message || 'OpenAI API request failed',
          'openai',
          response.status,
          error
        );
      }

      const data = await response.json();
      const choice = data.choices[0];
      const message = choice.message;

      // Handle tool calls
      let toolCalls: ToolCall[] | undefined;
      if (message.tool_calls && message.tool_calls.length > 0) {
        toolCalls = message.tool_calls.map((tc: any) => ({
          id: tc.id,
          type: 'function' as const,
          function: {
            name: tc.function.name,
            arguments: tc.function.arguments,
          },
        }));
      }

      return {
        content: message.content || '',
        toolCalls,
        finishReason: choice.finish_reason === 'tool_calls' ? 'tool_calls' : 
                      choice.finish_reason === 'length' ? 'length' : 'stop',
        usage: {
          promptTokens: data.usage?.prompt_tokens || 0,
          completionTokens: data.usage?.completion_tokens || 0,
          totalTokens: data.usage?.total_tokens || 0,
        },
        raw: data,
      };
    } catch (error: any) {
      if (error instanceof LLMError) throw error;
      throw new LLMError(
        error.message || 'OpenAI request failed',
        'openai',
        undefined,
        error
      );
    }
  }

  async *stream(params: ChatParams): AsyncGenerator<StreamChunk> {
    try {
      const messages = this.convertMessages(params.messages, params.systemInstruction);
      const tools = params.tools?.map(tool => this.convertTool(tool));

      const requestBody: any = {
        model: params.model,
        messages,
        temperature: params.temperature ?? 1.0,
        max_tokens: params.maxTokens,
        top_p: params.topP ?? 1.0,
        stream: true,
      };

      if (tools && tools.length > 0) {
        requestBody.tools = tools;
        requestBody.tool_choice = 'auto';
      }

      const response = await fetch(`${this.apiUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: { message: 'Unknown error' } }));
        throw new LLMError(
          error.error?.message || 'OpenAI streaming request failed',
          'openai',
          response.status,
          error
        );
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let buffer = '';
      let toolCallsBuffer: Record<number, { id: string; name: string; arguments: string }> = {};

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim() || line.trim() === 'data: [DONE]') continue;
          if (!line.startsWith('data: ')) continue;

          try {
            const data = JSON.parse(line.slice(6));
            const delta = data.choices[0]?.delta;

            if (!delta) continue;

            // Handle content
            if (delta.content) {
              yield {
                content: delta.content,
                done: false,
              };
            }

            // Handle tool calls (streaming)
            if (delta.tool_calls) {
              for (const tc of delta.tool_calls) {
                const index = tc.index;
                if (!toolCallsBuffer[index]) {
                  toolCallsBuffer[index] = {
                    id: tc.id || '',
                    name: '',
                    arguments: '',
                  };
                }
                if (tc.function?.name) {
                  toolCallsBuffer[index].name = tc.function.name;
                }
                if (tc.function?.arguments) {
                  toolCallsBuffer[index].arguments += tc.function.arguments;
                }
              }
            }

            // Check if done
            if (data.choices[0]?.finish_reason) {
              const toolCalls = Object.values(toolCallsBuffer).map((tc, idx) => ({
                id: tc.id || `call_${idx}`,
                type: 'function' as const,
                function: {
                  name: tc.name,
                  arguments: tc.arguments,
                },
              }));

              yield {
                content: '',
                toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
                done: true,
              };
            }
          } catch (e) {
            console.error('Error parsing SSE line:', e);
          }
        }
      }

      yield { content: '', done: true };
    } catch (error: any) {
      if (error instanceof LLMError) throw error;
      throw new LLMError(
        error.message || 'OpenAI streaming failed',
        'openai',
        undefined,
        error
      );
    }
  }

  private convertMessages(messages: LLMMessage[], systemInstruction?: string): OpenAIMessage[] {
    const converted: OpenAIMessage[] = [];

    // Add system instruction if provided
    if (systemInstruction) {
      converted.push({
        role: 'system',
        content: systemInstruction,
      });
    }

    // Convert messages
    for (const msg of messages) {
      if (msg.role === 'system') {
        converted.push({
          role: 'system',
          content: msg.content,
        });
      } else if (msg.role === 'user') {
        converted.push({
          role: 'user',
          content: msg.content,
        });
      } else if (msg.role === 'assistant') {
        converted.push({
          role: 'assistant',
          content: msg.content || null,
          tool_calls: msg.tool_calls,
        });
      } else if (msg.role === 'tool') {
        converted.push({
          role: 'tool',
          content: msg.content,
          tool_call_id: msg.tool_call_id!,
        });
      }
    }

    return converted;
  }

  private convertTool(tool: any) {
    return {
      type: 'function',
      function: {
        name: tool.function.name,
        description: tool.function.description,
        parameters: tool.function.parameters,
      },
    };
  }

  async embeddings(text: string): Promise<number[]> {
    try {
      const response = await fetch(`${this.apiUrl}/embeddings`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'text-embedding-3-small',
          input: text,
        }),
      });

      if (!response.ok) {
        throw new Error(`Embeddings request failed: ${response.status}`);
      }

      const data = await response.json();
      return data.data[0].embedding;
    } catch (error: any) {
      throw new LLMError(
        error.message || 'Embeddings request failed',
        'openai',
        undefined,
        error
      );
    }
  }
}
