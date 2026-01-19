// ===================================================================
// RedNox - Ephemeral Flow Engine with Optional Debug Tracing
// ===================================================================

import { NodeInstance } from './NodeInstance';
import { registry } from './NodeRegistry';
import { RED } from '../utils';
import { 
  FlowConfig, 
  ExecutionContext, 
  NodeMessage, 
  NodeExecutionTrace,
  ExecutionTrace,
  NodeStatus
} from '../types/core';

class ExecutionTraceImpl implements ExecutionTrace {
  traces: NodeExecutionTrace[] = [];
  
  addTrace(trace: NodeExecutionTrace): void {
    this.traces.push(trace);
  }
  
  getTraces(): NodeExecutionTrace[] {
    return this.traces;
  }
}

export class FlowEngine {
  private nodes = new Map<string, NodeInstance>();
  private flowConfig: FlowConfig;
  private context: ExecutionContext;
  private httpResponse: NodeMessage | null = null;
  private executionDepth = new Map<string, number>();
  private maxExecutionDepth = 50;
  private initializedNodes = new Set<string>();
  private debugMode: boolean;
  
  constructor(flowConfig: FlowConfig, context: ExecutionContext, debugMode = false) {
    this.flowConfig = flowConfig;
    this.context = context;
    this.debugMode = debugMode;
    this.context.flowEngine = this;
    this.context.debugMode = debugMode;
    
    // Initialize trace collector if in debug mode
    if (debugMode) {
      this.context.trace = new ExecutionTraceImpl();
    }
  }
  
  async initialize() {
    this.nodes.clear();
    this.initializedNodes.clear();
    
    // Create node instances
    for (const nodeConfig of this.flowConfig.nodes || []) {
      const definition = registry.get(nodeConfig.type);
      if (!definition) {
        console.warn(`[FlowEngine] Unknown node type: ${nodeConfig.type}`);
        continue;
      }
      
      const nodeInstance = new NodeInstance(nodeConfig, this.context);
      this.nodes.set(nodeConfig.id, nodeInstance);
    }
  }
  
  private async initializeNode(nodeId: string): Promise<void> {
    if (this.initializedNodes.has(nodeId)) return;
    
    const nodeInstance = this.nodes.get(nodeId);
    if (!nodeInstance) return;
    
    const definition = registry.get(nodeInstance.type);
    if (definition?.onInit) {
      await definition.onInit(nodeInstance, this.context);
    }
    
    this.initializedNodes.add(nodeId);
  }
  
  async executeNode(
    nodeId: string,
    msg: NodeMessage
  ): Promise<NodeMessage | NodeMessage[] | NodeMessage[][] | null> {
    // Prevent infinite loops
    const depth = this.executionDepth.get(msg._msgid) || 0;
    if (depth > this.maxExecutionDepth) {
      throw new Error(`Maximum execution depth exceeded for message ${msg._msgid}`);
    }
    this.executionDepth.set(msg._msgid, depth + 1);
    
    const nodeInstance = this.nodes.get(nodeId);
    if (!nodeInstance) {
      this.executionDepth.set(msg._msgid, depth);
      return null;
    }
    
    const definition = registry.get(nodeInstance.type);
    if (!definition) {
      this.executionDepth.set(msg._msgid, depth);
      return null;
    }
    
    // Lazy initialize
    await this.initializeNode(nodeId);
    
    // Debug tracing
    const startTime = this.debugMode ? Date.now() : 0;
    const statusUpdates: NodeStatus[] = [];
    let result: NodeMessage | NodeMessage[] | NodeMessage[][] | null = null;
    let executionError: Error | null = null;
    
    // Intercept status updates if debugging
    if (this.debugMode) {
      const originalStatus = nodeInstance.status.bind(nodeInstance);
      nodeInstance.status = (status: NodeStatus) => {
        statusUpdates.push({ ...status });
        originalStatus(status);
      };
    }
    
    try {
      result = await definition.execute(msg, nodeInstance, this.context);
      
      // Check for HTTP response
      if (result && (result as NodeMessage)._httpResponse) {
        this.httpResponse = result as NodeMessage;
      }
      
      // Route message to next nodes
      if (result) {
        await this.routeMessage(nodeInstance, result);
      }
      
    } catch (err: any) {
      executionError = err;
      await this.handleNodeError(err, nodeInstance, msg);
    }
    
    // Record trace if in debug mode
    if (this.debugMode && this.context.trace) {
      const endTime = Date.now();
      const trace: NodeExecutionTrace = {
        nodeId: nodeInstance.id,
        nodeType: nodeInstance.type,
        nodeName: nodeInstance.name,
        startTime,
        endTime,
        duration: endTime - startTime,
        input: RED.util.cloneMessage(msg),
        output: result ? (Array.isArray(result) ? result.map(m => 
          m ? RED.util.cloneMessage(m) : null
        ) : RED.util.cloneMessage(result)) : null,
        status: executionError ? 'error' : 'success',
        error: executionError?.message,
        stack: executionError?.stack,
        statusUpdates
      };
      
      this.context.trace.addTrace(trace);
    }
    
    this.executionDepth.set(msg._msgid, depth);
    return executionError ? null : result;
  }
  
  async routeMessage(
    sourceNode: NodeInstance,
    msg: NodeMessage | NodeMessage[] | NodeMessage[][]
  ) {
    const wires = sourceNode.config.wires;
    if (!wires || wires.length === 0) return;
    
    if (Array.isArray(msg)) {
      const promises: Promise<any>[] = [];
      
      for (let outputIdx = 0; outputIdx < msg.length; outputIdx++) {
        const outputMsg = msg[outputIdx];
        const targetWires = wires[outputIdx] || [];
        
        if (outputMsg === null || outputMsg === undefined) continue;
        
        if (Array.isArray(outputMsg)) {
          for (const singleMsg of outputMsg) {
            if (singleMsg) {
              for (const targetNodeId of targetWires) {
                promises.push(
                  this.executeNode(targetNodeId, RED.util.cloneMessage(singleMsg))
                );
              }
            }
          }
        } else {
          for (const targetNodeId of targetWires) {
            promises.push(
              this.executeNode(targetNodeId, RED.util.cloneMessage(outputMsg))
            );
          }
        }
      }
      
      await Promise.allSettled(promises);
      
    } else {
      const targetWires = wires[0] || [];
      const promises = targetWires.map(nodeId => 
        this.executeNode(nodeId, RED.util.cloneMessage(msg))
      );
      
      await Promise.allSettled(promises);
    }
  }
  
  async handleNodeError(error: Error, sourceNode: NodeInstance, msg?: NodeMessage) {
    console.error(`[FlowEngine] Node error [${sourceNode.id}]:`, error);
    
    // Find catch nodes
    const catchNodes = Array.from(this.nodes.values()).filter(
      node => node.type === 'catch'
    );
    
    for (const catchNode of catchNodes) {
      const scope = catchNode.config.scope || [];
      
      if (scope.length === 0 || scope.includes(sourceNode.id)) {
        const errorMsg: NodeMessage = {
          _msgid: crypto.randomUUID(),
          payload: msg?.payload,
          error: {
            message: error.message,
            source: {
              id: sourceNode.id,
              type: sourceNode.type,
              name: sourceNode.name
            },
            stack: error.stack
          }
        };
        
        await this.executeNode(catchNode.id, errorMsg);
      }
    }
  }
  
  async triggerFlow(
    entryNodeId: string,
    initialMsg?: NodeMessage
  ): Promise<NodeMessage | null> {
    this.httpResponse = null;
    this.executionDepth.clear();
    
    const msg = initialMsg || {
      _msgid: crypto.randomUUID(),
      payload: {},
      topic: ''
    };
    
    try {
      await this.executeNode(entryNodeId, msg);
      return this.httpResponse;
      
    } catch (err: any) {
      console.error('[FlowEngine] Flow execution error:', err);
      
      // Record error in trace if debugging
      if (this.debugMode && this.context.trace) {
        this.context.trace.addTrace({
          nodeId: 'system',
          nodeType: 'system',
          nodeName: 'Flow Engine',
          startTime: Date.now(),
          endTime: Date.now(),
          duration: 0,
          input: msg,
          output: null,
          status: 'error',
          error: err.message,
          stack: err.stack,
          statusUpdates: []
        });
      }
      
      return {
        _msgid: msg._msgid,
        _httpResponse: {
          statusCode: 500,
          headers: { 'Content-Type': 'application/json' },
          payload: {
            error: 'Flow execution failed',
            message: err.message
          }
        }
      };
    }
  }
  
  getTrace(): NodeExecutionTrace[] {
    return this.context.trace?.getTraces() || [];
  }
  
  async close() {
    // Close all nodes
    for (const [nodeId, nodeInstance] of this.nodes) {
      const definition = registry.get(nodeInstance.type);
      if (definition?.onClose) {
        try {
          await definition.onClose(nodeInstance, this.context);
        } catch (err) {
          console.error(`[FlowEngine] Error closing node ${nodeId}:`, err);
        }
      }
    }
    
    this.nodes.clear();
    this.initializedNodes.clear();
    this.executionDepth.clear();
  }
}
