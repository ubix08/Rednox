
// ===================================================================
// RedNox - Enhanced Flow Engine with Circuit Breaker & Tracing
// ===================================================================

import { NodeInstance } from './NodeInstance';
import { registry } from './NodeRegistry';
import { RED, CircuitBreaker } from '../utils';
import { FlowConfig, ExecutionContext, NodeMessage, MessageTrace } from '../types/core';

export class FlowEngine {
  private nodes = new Map<string, NodeInstance>();
  private flowConfig: FlowConfig;
  private context: ExecutionContext;
  private httpResponse: NodeMessage | null = null;
  private circuitBreaker: CircuitBreaker;
  private traces = new Map<string, MessageTrace>();
  private executionDepth = new Map<string, number>();
  private maxExecutionDepth = 50;
  private initializedNodes = new Set<string>();
  
  constructor(flowConfig: FlowConfig, context: ExecutionContext) {
    this.flowConfig = flowConfig;
    this.context = context;
    this.context.flowEngine = this;
    this.circuitBreaker = new CircuitBreaker();
  }
  
  async initialize() {
    this.nodes.clear();
    this.initializedNodes.clear();
    
    // Create node instances (lazy init)
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
    // Check execution depth to prevent infinite loops
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
    
    // Lazy initialize node
    await this.initializeNode(nodeId);
    
    // Get or create trace
    const trace = this.traces.get(msg._msgid) || {
      msgId: msg._msgid,
      startTime: Date.now(),
      nodeExecutions: []
    };
    
    const execStart = Date.now();
    
    try {
      // Execute with circuit breaker
      const result = await this.circuitBreaker.execute(
        `node:${nodeId}`,
        async () => await definition.execute(msg, nodeInstance, this.context)
      );
      
      // Track execution
      trace.nodeExecutions.push({
        nodeId,
        nodeType: nodeInstance.type,
        startTime: execStart,
        duration: Date.now() - execStart,
        status: 'success'
      });
      
      this.traces.set(msg._msgid, trace);
      
      // Check for HTTP response
      if (result && (result as NodeMessage)._httpResponse) {
        this.httpResponse = result as NodeMessage;
      }
      
      // Route message
      if (result) {
        await this.routeMessage(nodeInstance, result);
      }
      
      this.executionDepth.set(msg._msgid, depth);
      return result;
      
    } catch (err: any) {
      // Track error
      trace.nodeExecutions.push({
        nodeId,
        nodeType: nodeInstance.type,
        startTime: execStart,
        duration: Date.now() - execStart,
        status: 'error',
        error: err.message
      });
      
      this.traces.set(msg._msgid, trace);
      this.executionDepth.set(msg._msgid, depth);
      
      await this.handleNodeError(err, nodeInstance, msg);
      return null;
    }
  }
  
  async routeMessage(
    sourceNode: NodeInstance,
    msg: NodeMessage | NodeMessage[] | NodeMessage[][]
  ) {
    const wires = sourceNode.config.wires;
    if (!wires || wires.length === 0) return;
    
    // Handle array outputs
    if (Array.isArray(msg)) {
      const promises: Promise<any>[] = [];
      
      for (let outputIdx = 0; outputIdx < msg.length; outputIdx++) {
        const outputMsg = msg[outputIdx];
        const targetWires = wires[outputIdx] || [];
        
        if (outputMsg === null || outputMsg === undefined) continue;
        
        // Handle nested array (multiple messages per output)
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
          // Single message per output
          for (const targetNodeId of targetWires) {
            promises.push(
              this.executeNode(targetNodeId, RED.util.cloneMessage(outputMsg))
            );
          }
        }
      }
      
      // Execute all in parallel with error handling
      await Promise.allSettled(promises);
      
    } else {
      // Single message output
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
      
      // Check if catch applies to this node
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
    this.traces.clear();
    this.executionDepth.clear();
    
    const msg = initialMsg || {
      _msgid: crypto.randomUUID(),
      payload: {},
      topic: ''
    };
    
    try {
      await this.executeNode(entryNodeId, msg);
      
      // Attach trace to response
      if (this.httpResponse) {
        this.httpResponse._trace = this.traces.get(msg._msgid);
      }
      
      return this.httpResponse;
      
    } catch (err: any) {
      console.error('[FlowEngine] Flow execution error:', err);
      
      // Return error response
      return {
        _msgid: msg._msgid,
        _httpResponse: {
          statusCode: 500,
          headers: { 'Content-Type': 'application/json' },
          payload: {
            error: 'Flow execution failed',
            message: err.message,
            trace: this.traces.get(msg._msgid)
          }
        }
      };
    } finally {
      // Cleanup old traces (keep last 100)
      if (this.traces.size > 100) {
        const keys = Array.from(this.traces.keys());
        for (let i = 0; i < keys.length - 100; i++) {
          this.traces.delete(keys[i]);
        }
      }
    }
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
    this.traces.clear();
    this.executionDepth.clear();
  }
  
  getNodeStatus(nodeId: string): any {
    const nodeInstance = this.nodes.get(nodeId);
    return nodeInstance ? (nodeInstance as any)._status : null;
  }
  
  getTrace(msgId: string): MessageTrace | undefined {
    return this.traces.get(msgId);
  }
  
  resetCircuitBreaker(nodeId: string): void {
    this.circuitBreaker.reset(`node:${nodeId}`);
  }
}
