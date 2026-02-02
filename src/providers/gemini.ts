// ===================================================================
// Google Gemini Provider Implementation
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

interface GeminiContent {
  role: 'user' | 'model';
  parts: Array<{ text: string } | { functionCall?: any; functionResponse?: any }>;
}

export class GeminiProvider extends LLMProvider {
  private readonly apiUrl: string;

  constructor(apiKey: string, baseUrl?: string) {
    super(apiKey, baseUrl);
    this.apiUrl = baseUrl || 'https://generativelanguage.googleapis.com/v1beta';
  }

  async chat(params: ChatParams): Promise<ChatResponse> {
    try {
      const contents = this.convertMessages(params.messages);
      const tools = params.tools?.map(tool => this.convertTool(tool));

      const requestBody: any = {
        contents,
        generationConfig: {
          temperature: params.temperature ?? 1.0,
          maxOutputTokens: params.maxTokens || 8192,
          topP: params.topP ?? 0.95,
          topK: params.topK ?? 64,
        },
      };

      if (params.systemInstruction) {
        requestBody.systemInstruction = {
          parts: [{ text: params.systemInstruction }],
        };
      }

      if (tools && tools.length > 0) {
        requestBody.tools = [{
          functionDeclarations: tools,
        }];
      }

      const url = `${this.apiUrl}/models/${params.model}:generateContent?key=${this.apiKey}`;

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: { message: 'Unknown error' } }));
        throw new LLMError(
          error.error?.message || 'Gemini API request failed',
          'gemini',
          response.status,
          error
        );
      }

      const data = await response.json();
      
      // Handle safety blocking
      if (data.promptFeedback?.blockReason) {
        throw new LLMError(
          `Content blocked: ${data.promptFeedback.blockReason}`,
          'gemini',
          400,
          data
        );
      }

      const candidate = data.candidates?.[0];
      if (!candidate) {
        throw new LLMError('No response from Gemini', 'gemini', 500, data);
      }

      // Handle safety ratings
      if (candidate.finishReason === 'SAFETY') {
        throw new LLMError(
          'Content blocked by safety filters',
          'gemini',
          400,
          candidate.safetyRatings
        );
      }

      const parts = candidate.content?.parts || [];
      
      // Extract text content
      let content = '';
      for (const part of parts) {
        if (part.text) {
          content += part.text;
        }
      }

      // Extract function calls
      let toolCalls: ToolCall[] | undefined;
      const functionCalls = parts.filter((p: any) => p.functionCall);
      
      if (functionCalls.length > 0) {
        toolCalls = functionCalls.map((fc: any, idx: number) => ({
          id: `call_${idx}_${Date.now()}`,
          type: 'function' as const,
          function: {
            name: fc.functionCall.name,
            arguments: JSON.stringify(fc.functionCall.args || {}),
          },
        }));
      }

      return {
        content,
        toolCalls,
        finishReason: toolCalls ? 'tool_calls' : 
                      candidate.finishReason === 'MAX_TOKENS' ? 'length' : 'stop',
        usage: {
          promptTokens: data.usageMetadata?.promptTokenCount || 0,
          completionTokens: data.usageMetadata?.candidatesTokenCount || 0,
          totalTokens: data.usageMetadata?.totalTokenCount || 0,
        },
        raw: data,
      };
    } catch (error: any) {
      if (error instanceof LLMError) throw error;
      throw new LLMError(
        error.message || 'Gemini request failed',
        'gemini',
        undefined,
        error
      );
    }
  }

  async *stream(params: ChatParams): AsyncGenerator<StreamChunk> {
    try {
      const contents = this.convertMessages(params.messages);
      const tools = params.tools?.map(tool => this.convertTool(tool));

      const requestBody: any = {
        contents,
        generationConfig: {
          temperature: params.temperature ?? 1.0,
          maxOutputTokens: params.maxTokens || 8192,
          topP: params.topP ?? 0.95,
          topK: params.topK ?? 64,
        },
      };

      if (params.systemInstruction) {
        requestBody.systemInstruction = {
          parts: [{ text: params.systemInstruction }],
        };
      }

      if (tools && tools.length > 0) {
        requestBody.tools = [{
          functionDeclarations: tools,
        }];
      }

      const url = `${this.apiUrl}/models/${params.model}:streamGenerateContent?key=${this.apiKey}&alt=sse`;

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: { message: 'Unknown error' } }));
        throw new LLMError(
          error.error?.message || 'Gemini streaming request failed',
          'gemini',
          response.status,
          error
        );
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let buffer = '';
      let functionCallsBuffer: any[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim() || !line.startsWith('data: ')) continue;

          try {
            const data = JSON.parse(line.slice(6));
            const candidate = data.candidates?.[0];
            if (!candidate) continue;

            const parts = candidate.content?.parts || [];

            // Handle text content
            for (const part of parts) {
              if (part.text) {
                yield {
                  content: part.text,
                  done: false,
                };
              }

              if (part.functionCall) {
                functionCallsBuffer.push(part.functionCall);
              }
            }

            // Check if done
            if (candidate.finishReason && candidate.finishReason !== 'STOP') {
              if (functionCallsBuffer.length > 0) {
                const toolCalls = functionCallsBuffer.map((fc, idx) => ({
                  id: `call_${idx}_${Date.now()}`,
                  type: 'function' as const,
                  function: {
                    name: fc.name,
                    arguments: JSON.stringify(fc.args || {}),
                  },
                }));

                yield {
                  content: '',
                  toolCalls,
                  done: true,
                };
              } else {
                yield { content: '', done: true };
              }
            }
          } catch (e) {
            console.error('Error parsing Gemini SSE line:', e);
          }
        }
      }

      yield { content: '', done: true };
    } catch (error: any) {
      if (error instanceof LLMError) throw error;
      throw new LLMError(
        error.message || 'Gemini streaming failed',
        'gemini',
        undefined,
        error
      );
    }
  }

  private convertMessages(messages: LLMMessage[]): GeminiContent[] {
    const contents: GeminiContent[] = [];
    let currentRole: 'user' | 'model' | null = null;
    let currentParts: any[] = [];

    for (const msg of messages) {
      // Skip system messages (handled via systemInstruction)
      if (msg.role === 'system') continue;

      const role = msg.role === 'assistant' ? 'model' : 'user';

      // If role changes, push current content
      if (currentRole && currentRole !== role && currentParts.length > 0) {
        contents.push({
          role: currentRole,
          parts: currentParts,
        });
        currentParts = [];
      }

      currentRole = role;

      // Handle different message types
      if (msg.role === 'tool') {
        // Tool response
        currentParts.push({
          functionResponse: {
            name: msg.name,
            response: JSON.parse(msg.content),
          },
        });
      } else if (msg.tool_calls && msg.tool_calls.length > 0) {
        // Assistant with tool calls
        for (const tc of msg.tool_calls) {
          currentParts.push({
            functionCall: {
              name: tc.function.name,
              args: JSON.parse(tc.function.arguments),
            },
          });
        }
      } else {
        // Regular text message
        currentParts.push({
          text: msg.content,
        });
      }
    }

    // Push final content
    if (currentRole && currentParts.length > 0) {
      contents.push({
        role: currentRole,
        parts: currentParts,
      });
    }

    return contents;
  }

  private convertTool(tool: any) {
    // Gemini uses functionDeclaration format
    return {
      name: tool.function.name,
      description: tool.function.description,
      parameters: tool.function.parameters,
    };
  }
}
