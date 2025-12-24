
// ===================================================================
// RedNox - Ephemeral Flow Engine
// ===================================================================

import { NodeInstance } from './NodeInstance';
import { registry } from './NodeRegistry';
import { RED } from '../utils';
import { FlowConfig, ExecutionContext, NodeMessage } from '../types/core';

export class FlowEngine {
  private nodes = new Map<string, NodeInstance>();
  private flowConfig: FlowConfig;
  private context: ExecutionContext;
  private httpResponse: NodeMessage | null = null;
  private executionDepth = new Map<string, number>();
  private maxExecutionDepth = 50;
  private initializedNodes = new Set<string>();
  
  constructor(flowConfig: FlowConfig, context: ExecutionContext) {
    this.flowConfig = flowConfig;
    this.context = context;
    this.context.flowEngine = this;
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
    
    try {
      const result = await definition.execute(msg, nodeInstance, this.context);
      
      // Check for HTTP response
      if (result && (result as NodeMessage)._httpResponse) {
        this.httpResponse = result as NodeMessage;
      }
      
      // Route message to next nodes
      if (result) {
        await this.routeMessage(nodeInstance, result);
      }
      
      this.executionDepth.set(msg._msgid, depth);
      return result;
      
    } catch (err: any) {
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
