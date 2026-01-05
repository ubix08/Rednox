
// ===================================================================
// RedNox Admin UI - Main Application
// ===================================================================

const API_BASE = window.location.origin;

// State
const state = {
    flows: [],
    routes: [],
    nodeDefinitions: new Map(),
    categories: [],
    currentFlow: null,
    editor: null,
    selectedNodeId: null,
    zoom: 1
};

// ===================================================================
// Initialization
// ===================================================================

document.addEventListener('DOMContentLoaded', async () => {
    console.log('RedNox Admin UI initializing...');
    
    // Setup navigation
    setupNavigation();
    
    // Setup event listeners
    setupEventListeners();
    
    // Initialize database
    await initializeDatabase();
    
    // Load initial data
    await loadNodes();
    await loadFlows();
    
    // Setup Drawflow
    setupDrawflow();
});

// ===================================================================
// Navigation
// ===================================================================

function setupNavigation() {
    const navBtns = document.querySelectorAll('.nav-btn');
    const views = document.querySelectorAll('.view');
    
    navBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const viewId = btn.dataset.view + 'View';
            
            // Update nav buttons
            navBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            
            // Update views
            views.forEach(v => v.classList.remove('active'));
            document.getElementById(viewId)?.classList.add('active');
            
            // Load data for view
            if (btn.dataset.view === 'routes') {
                loadRoutes();
            }
        });
    });
}

// ===================================================================
// Event Listeners
// ===================================================================

function setupEventListeners() {
    // New flow button
    document.getElementById('newFlowBtn').addEventListener('click', () => {
        openFlowEditor(null);
    });
    
    // Refresh button
    document.getElementById('refreshBtn').addEventListener('click', async () => {
        await loadFlows();
        showToast('Data refreshed', 'success');
    });
    
    // Editor controls
    document.getElementById('closeEditorBtn').addEventListener('click', () => {
        closeFlowEditor();
    });
    
    document.getElementById('saveFlowBtn').addEventListener('click', async () => {
        await saveCurrentFlow();
    });
    
    document.getElementById('validateBtn').addEventListener('click', () => {
        validateCurrentFlow();
    });
    
    document.getElementById('clearFlowBtn').addEventListener('click', () => {
        if (confirm('Clear all nodes from canvas?')) {
            state.editor.clear();
            showToast('Canvas cleared', 'info');
        }
    });
    
    // Zoom controls
    document.getElementById('zoomInBtn').addEventListener('click', () => {
        state.zoom = Math.min(state.zoom + 0.1, 2);
        state.editor.zoom_in();
    });
    
    document.getElementById('zoomOutBtn').addEventListener('click', () => {
        state.zoom = Math.max(state.zoom - 0.1, 0.5);
        state.editor.zoom_out();
    });
    
    document.getElementById('zoomResetBtn').addEventListener('click', () => {
        state.zoom = 1;
        state.editor.zoom_reset();
    });
    
    // Properties panel close
    document.getElementById('closePropsBtn').addEventListener('click', () => {
        document.getElementById('propertiesPanel').classList.remove('visible');
    });
    
    // Confirm modal
    document.getElementById('confirmCancelBtn').addEventListener('click', () => {
        closeConfirmModal();
    });
    
    // Palette search
    document.getElementById('paletteSearch').addEventListener('input', (e) => {
        filterPaletteNodes(e.target.value);
    });
    
    // Node search
    document.getElementById('nodeSearchInput')?.addEventListener('input', (e) => {
        filterNodeCategories(e.target.value);
    });
}

// ===================================================================
// Database Initialization
// ===================================================================

async function initializeDatabase() {
    try {
        const response = await fetch(`${API_BASE}/admin/flows`);
        
        if (!response.ok) {
            console.log('Database not initialized, attempting initialization...');
            
            const initResponse = await fetch(`${API_BASE}/admin/init`, {
                method: 'POST'
            });
            
            if (initResponse.ok) {
                showToast('Database initialized successfully', 'success');
            } else {
                const error = await initResponse.json();
                showToast(`Database initialization failed: ${error.error}`, 'error');
            }
        }
    } catch (error) {
        console.error('Error checking database:', error);
        showToast('Error connecting to server', 'error');
    }
}

// ===================================================================
// Data Loading
// ===================================================================

async function loadFlows() {
    try {
        const response = await fetch(`${API_BASE}/admin/flows`);
        const data = await response.json();
        
        state.flows = data.flows || [];
        renderFlows();
        updateStats();
    } catch (error) {
        console.error('Error loading flows:', error);
        showToast('Error loading flows', 'error');
    }
}

async function loadRoutes() {
    try {
        const response = await fetch(`${API_BASE}/admin/routes`);
        const data = await response.json();
        
        state.routes = data.routes || [];
        renderRoutes();
    } catch (error) {
        console.error('Error loading routes:', error);
        showToast('Error loading routes', 'error');
    }
}

async function loadNodes() {
    try {
        // Load full node definitions
        const nodeResponse = await fetch(`${API_BASE}/admin/nodes`);
        const nodeData = await nodeResponse.json();
        
        if (nodeData.nodes) {
            nodeData.nodes.forEach(node => {
                state.nodeDefinitions.set(node.type, node);
            });
        }
        
        // Load categories
        const categoryResponse = await fetch(`${API_BASE}/admin/nodes/categories`);
        const categoryData = await categoryResponse.json();
        
        state.categories = categoryData.categories || [];
        renderNodes();
        renderNodePalette();
    } catch (error) {
        console.error('Error loading nodes:', error);
        showToast('Error loading nodes', 'error');
    }
}

// ===================================================================
// Rendering
// ===================================================================

function renderFlows() {
    const grid = document.getElementById('flowsGrid');
    
    if (state.flows.length === 0) {
        grid.innerHTML = '<div class="loading">No flows yet. Create your first flow!</div>';
        return;
    }
    
    grid.innerHTML = state.flows.map(flow => `
        <div class="flow-card" onclick="openFlowEditor('${flow.id}')">
            <div class="flow-card-header">
                <div>
                    <div class="flow-card-title">${escapeHtml(flow.name)}</div>
                    <div class="flow-card-description">${escapeHtml(flow.description || 'No description')}</div>
                </div>
                <span class="flow-badge ${flow.enabled ? 'enabled' : 'disabled'}">
                    ${flow.enabled ? 'Active' : 'Inactive'}
                </span>
            </div>
            <div class="flow-card-meta">
                <span>Created: ${formatDate(flow.created_at)}</span>
            </div>
            <div class="flow-card-actions" onclick="event.stopPropagation()">
                <button class="btn-secondary" onclick="toggleFlow('${flow.id}', ${!flow.enabled})">
                    ${flow.enabled ? 'Disable' : 'Enable'}
                </button>
                <button class="btn-secondary" onclick="duplicateFlow('${flow.id}')">Duplicate</button>
                <button class="btn-danger" onclick="confirmDeleteFlow('${flow.id}')">Delete</button>
            </div>
        </div>
    `).join('');
}

function renderRoutes() {
    const list = document.getElementById('routesList');
    
    if (state.routes.length === 0) {
        list.innerHTML = '<div class="loading">No routes configured</div>';
        return;
    }
    
    list.innerHTML = state.routes.map(route => `
        <div class="route-card">
            <div class="route-header">
                <span class="route-method ${route.method}">${route.method}</span>
                <code class="route-path">${escapeHtml(route.fullUrl)}</code>
            </div>
            <div class="route-flow">Flow: ${escapeHtml(route.flow_name)}</div>
        </div>
    `).join('');
}

function renderNodes() {
    const container = document.getElementById('nodesCategories');
    
    if (state.categories.length === 0) {
        container.innerHTML = '<div class="loading">No nodes available</div>';
        return;
    }
    
    container.innerHTML = state.categories.map(category => `
        <div class="node-category" data-category="${escapeHtml(category.name)}">
            <div class="node-category-title">
                ${escapeHtml(category.name)}
                <span class="node-count">${category.count}</span>
            </div>
            <div class="nodes-grid">
                ${category.nodes.map(node => `
                    <div class="node-item">
                        <div class="node-icon">${node.icon || '📦'}</div>
                        <div class="node-label">${escapeHtml(node.label)}</div>
                    </div>
                `).join('')}
            </div>
        </div>
    `).join('');
}

function renderNodePalette() {
    const palette = document.getElementById('paletteNodes');
    
    palette.innerHTML = state.categories.map(category => `
        <div class="palette-category" data-category="${escapeHtml(category.name)}">
            <div class="palette-category-title">${escapeHtml(category.name)}</div>
            ${category.nodes.map(node => `
                <div class="palette-node" 
                     draggable="true" 
                     data-node-type="${node.type}"
                     data-node-label="${escapeHtml(node.label)}">
                    ${node.icon || '📦'} ${escapeHtml(node.label)}
                </div>
            `).join('')}
        </div>
    `).join('');
    
    // Add drag event listeners
    document.querySelectorAll('.palette-node').forEach(node => {
        node.addEventListener('dragstart', handleDragStart);
    });
}

function updateStats() {
    const total = state.flows.length;
    const active = state.flows.filter(f => f.enabled).length;
    
    const stats = document.getElementById('flowStats');
    const statValues = stats.querySelectorAll('.stat-value');
    statValues[0].textContent = total;
    statValues[1].textContent = active;
}

// ===================================================================
// Flow Editor - Drawflow Setup
// ===================================================================

function setupDrawflow() {
    const container = document.getElementById('drawflow');
    state.editor = new Drawflow(container);
    state.editor.reroute = true;
    state.editor.reroute_fix_curvature = true;
    state.editor.force_first_input = false;
    state.editor.start();
    
    // Editor events
    state.editor.on('nodeCreated', (nodeId) => {
        console.log('Node created:', nodeId);
    });
    
    state.editor.on('nodeSelected', (nodeId) => {
        state.selectedNodeId = nodeId;
        showNodeProperties(nodeId);
        document.getElementById('propertiesPanel').classList.add('visible');
    });
    
    state.editor.on('nodeUnselected', () => {
        state.selectedNodeId = null;
        clearNodeProperties();
    });
    
    state.editor.on('nodeRemoved', (nodeId) => {
        if (state.selectedNodeId === nodeId) {
            state.selectedNodeId = null;
            clearNodeProperties();
        }
    });
    
    state.editor.on('connectionCreated', (connection) => {
        console.log('Connection created:', connection);
    });
    
    state.editor.on('connectionRemoved', (connection) => {
        console.log('Connection removed:', connection);
    });
    
    // Setup drop zone for nodes
    const dropZone = container;
    
    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
    });
    
    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        handleDrop(e);
    });
}

// ===================================================================
// Flow Editor - Open/Close
// ===================================================================

async function openFlowEditor(flowId) {
    const modal = document.getElementById('editorModal');
    modal.classList.add('active');
    
    // Clear editor first
    state.editor.clear();
    state.editor.zoom_reset();
    state.zoom = 1;
    clearNodeProperties();
    
    if (flowId) {
        // Load existing flow
        try {
            const response = await fetch(`${API_BASE}/admin/flows/${flowId}`);
            const flow = await response.json();
            
            state.currentFlow = flow;
            document.getElementById('flowName').value = flow.name;
            document.getElementById('flowDescription').value = flow.description || '';
            
            // Load flow into editor
            if (flow.config && flow.config.nodes) {
                loadFlowIntoEditor(flow.config);
            }
        } catch (error) {
            console.error('Error loading flow:', error);
            showToast('Error loading flow', 'error');
        }
    } else {
        // New flow
        state.currentFlow = {
            id: generateId(),
            name: 'New Flow',
            description: '',
            nodes: []
        };
        document.getElementById('flowName').value = state.currentFlow.name;
        document.getElementById('flowDescription').value = '';
    }
}

function closeFlowEditor() {
    const modal = document.getElementById('editorModal');
    modal.classList.remove('active');
    state.currentFlow = null;
    state.editor.clear();
    clearNodeProperties();
}

// ===================================================================
// Flow Editor - Loading Flows
// ===================================================================

function loadFlowIntoEditor(config) {
    if (!config.nodes || config.nodes.length === 0) {
        return;
    }
    
    // Create a map to store old ID to new ID mapping
    const idMap = new Map();
    
    // First pass: Add all nodes
    config.nodes.forEach(node => {
        const nodeDefinition = state.nodeDefinitions.get(node.type);
        if (!nodeDefinition) {
            console.warn(`Node type not found: ${node.type}`);
            return;
        }
        
        const html = createNodeHTML(node, nodeDefinition);
        const inputCount = nodeDefinition.inputs || 1;
        const outputCount = nodeDefinition.outputs || 1;
        const x = node.x || 100;
        const y = node.y || 100;
        
        // Add node to editor
        const newNodeId = state.editor.addNode(
            node.type,
            inputCount,
            outputCount,
            x,
            y,
            node.type,
            node,
            html
        );
        
        // Map old ID to new ID
        idMap.set(node.id, newNodeId);
    });
    
    // Second pass: Add connections if available
    if (config.connections) {
        config.connections.forEach(conn => {
            const outputNodeId = idMap.get(conn.source.node);
            const inputNodeId = idMap.get(conn.target.node);
            
            if (outputNodeId && inputNodeId) {
                try {
                    state.editor.addConnection(
                        outputNodeId,
                        inputNodeId,
                        `output_${conn.source.port || 1}`,
                        `input_${conn.target.port || 1}`
                    );
                } catch (error) {
                    console.warn('Could not create connection:', error);
                }
            }
        });
    }
}

function createNodeHTML(nodeData, nodeDefinition) {
    const ui = nodeDefinition.ui || {};
    const icon = ui.icon || '📦';
    const label = ui.paletteLabel || nodeData.type;
    const color = ui.color || '#0066cc';
    
    return `
        <div class="node-content" style="border-left: 4px solid ${color}">
            <div class="node-header">
                ${icon} ${escapeHtml(label)}
            </div>
            <div class="node-body">
                ${nodeData.name ? `<div style="font-weight: 500">${escapeHtml(nodeData.name)}</div>` : ''}
                ${nodeData.url ? `<div style="font-size: 0.7rem; color: #666">${escapeHtml(nodeData.url)}</div>` : ''}
                ${nodeData.method ? `<div style="font-size: 0.7rem; color: #666">${escapeHtml(nodeData.method)}</div>` : ''}
            </div>
        </div>
    `;
}

// ===================================================================
// Flow Editor - Saving Flows
// ===================================================================

async function saveCurrentFlow() {
    if (!state.currentFlow) return;
    
    const flowName = document.getElementById('flowName').value.trim();
    const flowDescription = document.getElementById('flowDescription').value.trim();
    
    if (!flowName) {
        showToast('Flow name is required', 'error');
        return;
    }
    
    const exportData = state.editor.export();
    const drawflowData = exportData.drawflow.Home.data;
    
    // Extract nodes
    const nodes = Object.values(drawflowData).map(node => {
        const nodeData = node.data || {};
        return {
            id: node.id.toString(),
            type: node.name,
            x: node.pos_x,
            y: node.pos_y,
            ...nodeData
        };
    });
    
    // Extract connections
    const connections = [];
    Object.values(drawflowData).forEach(node => {
        if (node.outputs) {
            Object.entries(node.outputs).forEach(([outputKey, outputData]) => {
                if (outputData.connections) {
                    outputData.connections.forEach(conn => {
                        connections.push({
                            source: {
                                node: node.id.toString(),
                                port: outputKey.replace('output_', '')
                            },
                            target: {
                                node: conn.node,
                                port: conn.output.replace('input_', '')
                            }
                        });
                    });
                }
            });
        }
    });
    
    const flowData = {
        id: state.currentFlow.id,
        name: flowName,
        description: flowDescription,
        nodes: nodes,
        connections: connections
    };
    
    try {
        const url = state.currentFlow.created_at
            ? `${API_BASE}/admin/flows/${state.currentFlow.id}`
            : `${API_BASE}/admin/flows`;
        
        const method = state.currentFlow.created_at ? 'PUT' : 'POST';
        
        const response = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(flowData)
        });
        
        const result = await response.json();
        
        if (response.ok) {
            showToast('Flow saved successfully', 'success');
            
            // Show endpoints if available
            if (result.endpoints && result.endpoints.length > 0) {
                const endpointInfo = result.endpoints.map(ep => 
                    `${ep.method} ${ep.url}`
                ).join('\n');
                console.log('Flow endpoints:\n', endpointInfo);
            }
            
            await loadFlows();
            closeFlowEditor();
        } else {
            showToast(`Error: ${result.error}`, 'error');
            if (result.errors) {
                console.error('Validation errors:', result.errors);
            }
        }
    } catch (error) {
        console.error('Error saving flow:', error);
        showToast('Error saving flow', 'error');
    }
}

function validateCurrentFlow() {
    const exportData = state.editor.export();
    const nodes = Object.values(exportData.drawflow.Home.data);
    
    if (nodes.length === 0) {
        showToast('Flow is empty', 'warning');
        return;
    }
    
    // Check for http-in nodes
    const httpInNodes = nodes.filter(n => n.name === 'http-in');
    if (httpInNodes.length === 0) {
        showToast('Warning: No HTTP trigger nodes found', 'warning');
    }
    
    // Check for http-response nodes
    const httpResponseNodes = nodes.filter(n => n.name === 'http-response');
    if (httpResponseNodes.length === 0) {
        showToast('Warning: No HTTP response nodes found', 'warning');
    }
    
    // Check for disconnected nodes
    const disconnectedNodes = nodes.filter(n => {
        const hasInputs = n.inputs && Object.keys(n.inputs).length > 0;
        const hasOutputs = n.outputs && Object.keys(n.outputs).length > 0;
        const hasInputConnections = hasInputs && Object.values(n.inputs).some(i => i.connections.length > 0);
        const hasOutputConnections = hasOutputs && Object.values(n.outputs).some(o => o.connections.length > 0);
        
        return !hasInputConnections && !hasOutputConnections && n.name !== 'http-in';
    });
    
    if (disconnectedNodes.length > 0) {
        showToast(`Warning: ${disconnectedNodes.length} disconnected node(s)`, 'warning');
    }
    
    showToast(`Flow validated: ${nodes.length} nodes`, 'success');
}

// ===================================================================
// Node Properties Panel
// ===================================================================

function showNodeProperties(nodeId) {
    const content = document.getElementById('propertiesContent');
    const nodeInfo = state.editor.getNodeFromId(nodeId);
    const nodeData = nodeInfo.data || {};
    const nodeDefinition = state.nodeDefinitions.get(nodeInfo.name);
    
    if (!nodeDefinition) {
        content.innerHTML = '<div class="properties-empty">Node definition not found</div>';
        return;
    }
    
    const defaults = nodeDefinition.defaults || {};
    
    let html = `
        <div class="property-group">
            <label class="property-label">Node ID</label>
            <input type="text" class="property-input" value="${nodeId}" readonly>
        </div>
        <div class="property-group">
            <label class="property-label">Node Type</label>
            <input type="text" class="property-input" value="${escapeHtml(nodeInfo.name)}" readonly>
        </div>
    `;
    
    // Generate property fields based on node definition
    Object.entries(defaults).forEach(([key, defaultValue]) => {
        const currentValue = nodeData[key] !== undefined ? nodeData[key] : defaultValue;
        const propertyType = typeof defaultValue;
        
        html += `<div class="property-group">`;
        html += `<label class="property-label">${escapeHtml(key)}</label>`;
        
        if (propertyType === 'boolean') {
            html += `
                <div class="property-checkbox">
                    <input type="checkbox" 
                           id="prop_${key}" 
                           ${currentValue ? 'checked' : ''}>
                    <label for="prop_${key}">Enable</label>
                </div>
            `;
        } else if (key === 'method' && nodeInfo.name === 'http-in') {
            html += `
                <select class="property-select" id="prop_${key}">
                    <option value="get" ${currentValue === 'get' ? 'selected' : ''}>GET</option>
                    <option value="post" ${currentValue === 'post' ? 'selected' : ''}>POST</option>
                    <option value="put" ${currentValue === 'put' ? 'selected' : ''}>PUT</option>
                    <option value="delete" ${currentValue === 'delete' ? 'selected' : ''}>DELETE</option>
                    <option value="patch" ${currentValue === 'patch' ? 'selected' : ''}>PATCH</option>
                </select>
            `;
        } else if (key === 'func' || key === 'code' || propertyType === 'string' && currentValue.length > 50) {
            html += `
                <textarea class="property-textarea" 
                         id="prop_${key}" 
                         placeholder="Enter ${key}">${escapeHtml(currentValue.toString())}</textarea>
            `;
        } else {
            html += `
                <input type="text" 
                       class="property-input" 
                       id="prop_${key}" 
                       value="${escapeHtml(currentValue.toString())}" 
                       placeholder="Enter ${key}">
            `;
        }
        
        html += `</div>`;
    });
    
    html += `
        <div class="property-group">
            <button class="btn-danger" onclick="deleteSelectedNode()">Delete Node</button>
        </div>
    `;
    
    content.innerHTML = html;
    
    // Add event listeners for property changes
    Object.keys(defaults).forEach(key => {
        const element = document.getElementById(`prop_${key}`);
        if (element) {
            element.addEventListener('change', (e) => {
                const value = element.type === 'checkbox' ? element.checked : element.value;
                updateNodeData(nodeId, { [key]: value });
                
                // Update node display
                const updatedData = state.editor.getNodeFromId(nodeId).data;
                const updatedDefinition = state.nodeDefinitions.get(nodeInfo.name);
                const newHTML = createNodeHTML(updatedData, updatedDefinition);
                state.editor.updateNodeDataFromId(nodeId, updatedData);
            });
        }
    });
}

function clearNodeProperties() {
    const content = document.getElementById('propertiesContent');
    content.innerHTML = '<div class="properties-empty">Select a node to edit properties</div>';
}

function updateNodeData(nodeId, data) {
    const nodeInfo = state.editor.getNodeFromId(nodeId);
    const updatedData = { ...nodeInfo.data, ...data };
    state.editor.updateNodeDataFromId(nodeId, updatedData);
}

function deleteSelectedNode() {
    if (state.selectedNodeId) {
        state.editor.removeNodeId(`node-${state.selectedNodeId}`);
        clearNodeProperties();
        showToast('Node deleted', 'info');
    }
}

// ===================================================================
// Drag and Drop
// ===================================================================

function handleDragStart(e) {
    const nodeType = e.target.dataset.nodeType;
    const nodeLabel = e.target.dataset.nodeLabel;
    e.dataTransfer.setData('node-type', nodeType);
    e.dataTransfer.setData('node-label', nodeLabel);
}

function handleDrop(e) {
    const nodeType = e.dataTransfer.getData('node-type');
    if (!nodeType) return;
    
    const nodeDefinition = state.nodeDefinitions.get(nodeType);
    if (!nodeDefinition) {
        showToast('Node type not found', 'error');
        return;
    }
    
    // Calculate position relative to canvas
    const rect = e.target.getBoundingClientRect();
    const x = (e.clientX - rect.left) / state.zoom;
    const y = (e.clientY - rect.top) / state.zoom;
    
    // Create node data with defaults
    const nodeData = { ...nodeDefinition.defaults };
    
    const html = createNodeHTML(nodeData, nodeDefinition);
    const inputCount = nodeDefinition.inputs || 1;
    const outputCount = nodeDefinition.outputs || 1;
    
    const nodeId = state.editor.addNode(
        nodeType,
        inputCount,
        outputCount,
        x,
        y,
        nodeType,
        nodeData,
        html
    );
    
    console.log('Node added:', nodeId, nodeType);
    showToast(`Added ${nodeDefinition.ui.paletteLabel || nodeType}`, 'success');
}

// ===================================================================
// Search and Filter
// ===================================================================

function filterPaletteNodes(searchTerm) {
    const term = searchTerm.toLowerCase();
    const categories = document.querySelectorAll('.palette-category');
    
    categories.forEach(category => {
        const nodes = category.querySelectorAll('.palette-node');
        let visibleCount = 0;
        
        nodes.forEach(node => {
            const label = node.textContent.toLowerCase();
            if (label.includes(term)) {
                node.classList.remove('hidden');
                visibleCount++;
            } else {
                node.classList.add('hidden');
            }
        });
        
        category.classList.toggle('hidden', visibleCount === 0);
    });
}

function filterNodeCategories(searchTerm) {
    const term = searchTerm.toLowerCase();
    const categories = document.querySelectorAll('.node-category');
    
    categories.forEach(category => {
        const categoryName = category.dataset.category.toLowerCase();
        const nodes = category.querySelectorAll('.node-item');
        let hasVisibleNodes = false;
        
        nodes.forEach(node => {
            const label = node.querySelector('.node-label').textContent.toLowerCase();
            if (label.includes(term) || categoryName.includes(term)) {
                hasVisibleNodes = true;
            }
        });
        
        category.classList.toggle('hidden', !hasVisibleNodes);
    });
}

// ===================================================================
// Flow Actions
// ===================================================================

async function toggleFlow(flowId, enable) {
    try {
        const action = enable ? 'enable' : 'disable';
        const response = await fetch(`${API_BASE}/admin/flows/${flowId}/${action}`, {
            method: 'POST'
        });
        
        if (response.ok) {
            showToast(`Flow ${action}d successfully`, 'success');
            await loadFlows();
        } else {
            showToast(`Error ${action}ing flow`, 'error');
        }
    } catch (error) {
        console.error('Error toggling flow:', error);
        showToast('Error toggling flow', 'error');
    }
}

async function duplicateFlow(flowId) {
    try {
        const response = await fetch(`${API_BASE}/admin/flows/${flowId}`);
        const flow = await response.json();
        
        const newFlow = {
            id: generateId(),
            name: `${flow.name} (Copy)`,
            description: flow.description,
            nodes: flow.config.nodes,
            connections: flow.config.connections
        };
        
        const createResponse = await fetch(`${API_BASE}/admin/flows`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(newFlow)
        });
        
        if (createResponse.ok) {
            showToast('Flow duplicated successfully', 'success');
            await loadFlows();
        } else {
            showToast('Error duplicating flow', 'error');
        }
    } catch (error) {
        console.error('Error duplicating flow:', error);
        showToast('Error duplicating flow', 'error');
    }
}

function confirmDeleteFlow(flowId) {
    showConfirmModal(
        'Delete Flow',
        'Are you sure you want to delete this flow? This action cannot be undone.',
        () => deleteFlow(flowId)
    );
}

async function deleteFlow(flowId) {
    try {
        const response = await fetch(`${API_BASE}/admin/flows/${flowId}`, {
            method: 'DELETE'
        });
        
        if (response.ok) {
            showToast('Flow deleted successfully', 'success');
            await loadFlows();
        } else {
            showToast('Error deleting flow', 'error');
        }
    } catch (error) {
        console.error('Error deleting flow:', error);
        showToast('Error deleting flow', 'error');
    }
}

// ===================================================================
// UI Helpers
// ===================================================================

function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    
    container.appendChild(toast);
    
    setTimeout(() => {
        toast.style.animation = 'slideIn 0.3s reverse';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

function showConfirmModal(title, message, onConfirm) {
    const modal = document.getElementById('confirmModal');
    document.getElementById('confirmTitle').textContent = title;
    document.getElementById('confirmMessage').textContent = message;
    
    const okBtn = document.getElementById('confirmOkBtn');
    const newOkBtn = okBtn.cloneNode(true);
    okBtn.parentNode.replaceChild(newOkBtn, okBtn);
    
    newOkBtn.addEventListener('click', () => {
        onConfirm();
        closeConfirmModal();
    });
    
    modal.classList.add('active');
}

function closeConfirmModal() {
    document.getElementById('confirmModal').classList.remove('active');
}

// ===================================================================
// Utility Functions
// ===================================================================

function escapeHtml(text) {
    if (text === null || text === undefined) return '';
    const div = document.createElement('div');
    div.textContent = text.toString();
    return div.innerHTML;
}

function formatDate(dateString) {
    if (!dateString) return 'N/A';
    const date = new Date(dateString);
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
}

function generateId() {
    return 'flow_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now();
}

// ===================================================================
// Export for global access and debugging
// ===================================================================

window.RedNoxAdmin = {
    state,
    loadFlows,
    loadRoutes,
    loadNodes,
    openFlowEditor,
    deleteSelectedNode
};
