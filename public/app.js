
// app.js
// ===================================================================
// RedNox Admin UI - Fixed Implementation
// ===================================================================

const API_BASE = window.location.origin;

// State Management
const state = {
    flows: [],
    routes: [],
    nodeDefinitions: new Map(),
    categories: [],
    currentFlow: null,
    editor: null,
    selectedNodeId: null,
    zoom: 1,
    isModified: false,
    autoSaveTimer: null
};

// ===================================================================
// Initialization
// ===================================================================

document.addEventListener('DOMContentLoaded', async () => {
    console.log('🚀 RedNox Admin UI initializing...');
    
    const drawflowLoaded = await waitForDrawflow();
    if (!drawflowLoaded) {
        showToast('Failed to load editor. Please refresh.', 'error');
        return;
    }
    
    setupNavigation();
    setupEventListeners();
    setupKeyboardShortcuts();
    
    await initializeDatabase();
    
    await Promise.all([
        loadNodes(),
        loadFlows()
    ]);
    
    console.log('✅ RedNox Admin UI ready');
});

function waitForDrawflow() {
    return new Promise((resolve) => {
        if (typeof Drawflow !== 'undefined') {
            console.log('✓ Drawflow library loaded');
            resolve(true);
            return;
        }
        
        let attempts = 0;
        const maxAttempts = 30;
        
        const checkInterval = setInterval(() => {
            attempts++;
            
            if (typeof Drawflow !== 'undefined') {
                console.log(`✓ Drawflow loaded after ${attempts * 100}ms`);
                clearInterval(checkInterval);
                resolve(true);
                return;
            }
            
            if (attempts >= maxAttempts) {
                console.error('✗ Drawflow failed to load');
                clearInterval(checkInterval);
                resolve(false);
            }
        }, 100);
    });
}

// ===================================================================
// Navigation
// ===================================================================

function setupNavigation() {
    const navBtns = document.querySelectorAll('.nav-btn');
    const views = document.querySelectorAll('.view');
    
    navBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const viewId = btn.dataset.view + 'View';
            
            navBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            
            views.forEach(v => v.classList.remove('active'));
            document.getElementById(viewId)?.classList.add('active');
            
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
    document.getElementById('newFlowBtn').addEventListener('click', () => {
        openFlowEditor(null);
    });
    
    document.getElementById('refreshBtn').addEventListener('click', async () => {
        await loadFlows();
        showToast('Data refreshed', 'success');
    });
    
    document.getElementById('closeEditorBtn').addEventListener('click', () => {
        if (state.isModified) {
            showConfirmModal(
                'Unsaved Changes',
                'You have unsaved changes. Are you sure you want to close?',
                () => closeFlowEditor()
            );
        } else {
            closeFlowEditor();
        }
    });
    
    document.getElementById('saveFlowBtn').addEventListener('click', () => {
        saveCurrentFlow();
    });
    
    document.getElementById('validateBtn').addEventListener('click', () => {
        validateCurrentFlow();
    });
    
    document.getElementById('clearFlowBtn').addEventListener('click', () => {
        if (state.editor) {
            showConfirmModal(
                'Clear Canvas',
                'Are you sure you want to clear all nodes?',
                () => {
                    state.editor.clear();
                    state.isModified = true;
                    showToast('Canvas cleared', 'info');
                }
            );
        }
    });
    
    document.getElementById('executeBtn').addEventListener('click', () => {
        executeCurrentFlow();
    });
    
    document.getElementById('exportBtn').addEventListener('click', () => {
        exportCurrentFlow();
    });
    
    document.getElementById('importBtn').addEventListener('click', () => {
        openImportModal();
    });
    
    document.getElementById('togglePaletteBtn').addEventListener('click', () => {
        const palette = document.getElementById('nodePalette');
        palette.classList.toggle('hidden');
    });
    
    document.getElementById('zoomInBtn').addEventListener('click', () => {
        if (state.editor) {
            state.zoom = Math.min(state.zoom + 0.1, 2);
            state.editor.zoom_in();
        }
    });
    
    document.getElementById('zoomOutBtn').addEventListener('click', () => {
        if (state.editor) {
            state.zoom = Math.max(state.zoom - 0.1, 0.5);
            state.editor.zoom_out();
        }
    });
    
    document.getElementById('zoomResetBtn').addEventListener('click', () => {
        if (state.editor) {
            state.zoom = 1;
            state.editor.zoom_reset();
        }
    });
    
    document.getElementById('fitViewBtn').addEventListener('click', () => {
        showToast('Fit view', 'info');
    });
    
    document.getElementById('closePropsBtn').addEventListener('click', () => {
        document.getElementById('propertiesPanel').classList.remove('visible');
    });
    
    document.getElementById('toggleDebugBtn').addEventListener('click', () => {
        const panel = document.getElementById('debugPanel');
        panel.classList.toggle('collapsed');
        const icon = document.querySelector('#toggleDebugBtn svg path');
        icon.setAttribute('d', panel.classList.contains('collapsed') 
            ? 'M2 8l5-5 5 5' 
            : 'M2 8l5 5 5-5'
        );
    });
    
    document.getElementById('clearDebugBtn').addEventListener('click', () => {
        clearDebugOutput();
    });
    
    document.getElementById('confirmCancelBtn').addEventListener('click', () => {
        closeConfirmModal();
    });
    
    document.getElementById('paletteSearch').addEventListener('input', (e) => {
        filterPaletteNodes(e.target.value);
    });
    
    document.getElementById('nodeSearchInput')?.addEventListener('input', (e) => {
        filterNodeCategories(e.target.value);
    });
    
    document.getElementById('importFile').addEventListener('change', handleFileImport);
    document.getElementById('importFlowBtn').addEventListener('click', importFlow);
    
    document.getElementById('flowName').addEventListener('input', () => {
        state.isModified = true;
        scheduleAutoSave();
    });
    
    document.getElementById('flowDescription').addEventListener('input', () => {
        state.isModified = true;
        scheduleAutoSave();
    });
}

function setupKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 's') {
            e.preventDefault();
            if (state.currentFlow) {
                saveCurrentFlow();
            }
        }
        
        if (e.key === 'Delete' && state.selectedNodeId && state.editor) {
            deleteSelectedNode();
        }
        
        if (e.key === 'Escape') {
            const editorModal = document.getElementById('editorModal');
            const importModal = document.getElementById('importModal');
            const confirmModal = document.getElementById('confirmModal');
            
            if (editorModal.classList.contains('active')) {
                document.getElementById('closeEditorBtn').click();
            } else if (importModal.classList.contains('active')) {
                closeImportModal();
            } else if (confirmModal.classList.contains('active')) {
                closeConfirmModal();
            }
        }
    });
}

// ===================================================================
// Database Operations
// ===================================================================

async function initializeDatabase() {
    try {
        const response = await fetch(`${API_BASE}/admin/flows`);
        
        if (!response.ok) {
            console.log('Database not initialized, initializing...');
            
            const initResponse = await fetch(`${API_BASE}/admin/init`, {
                method: 'POST'
            });
            
            if (initResponse.ok) {
                showToast('Database initialized', 'success');
            } else {
                const error = await initResponse.json();
                showToast(`Database error: ${error.error}`, 'error');
            }
        }
    } catch (error) {
        console.error('Database check error:', error);
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
        const [nodeResponse, categoryResponse] = await Promise.all([
            fetch(`${API_BASE}/admin/nodes`),
            fetch(`${API_BASE}/admin/nodes/categories`)
        ]);
        
        const nodeData = await nodeResponse.json();
        const categoryData = await categoryResponse.json();
        
        if (nodeData.nodes) {
            nodeData.nodes.forEach(node => {
                state.nodeDefinitions.set(node.type, node);
            });
        }
        
        state.categories = categoryData.categories || [];
        renderNodes();
        renderNodePalette();
    } catch (error) {
        console.error('Error loading nodes:', error);
        showToast('Error loading nodes', 'error');
    }
}

// ===================================================================
// Rendering Functions
// ===================================================================

function renderFlows() {
    const container = document.getElementById('flowsContainer');
    
    if (state.flows.length === 0) {
        container.innerHTML = `
            <div class="loading">
                <p>No flows yet. Create your first flow!</p>
            </div>
        `;
        return;
    }
    
    container.innerHTML = state.flows.map(flow => `
        <div class="flow-card" onclick="openFlowEditor('${flow.id}')">
            <div class="flow-card-header">
                <div class="flow-card-info">
                    <div class="flow-card-title">${escapeHtml(flow.name)}</div>
                    <div class="flow-card-description">${escapeHtml(flow.description || 'No description')}</div>
                </div>
                <span class="flow-badge ${flow.enabled ? 'enabled' : 'disabled'}">
                    ${flow.enabled ? 'Active' : 'Inactive'}
                </span>
            </div>
            <div class="flow-card-meta">
                <span>📅 ${formatDate(flow.created_at)}</span>
                ${flow.updated_at ? `<span>✏️ ${formatDate(flow.updated_at)}</span>` : ''}
            </div>
            <div class="flow-card-actions" onclick="event.stopPropagation()">
                <button class="btn-secondary btn-small" onclick="toggleFlow('${flow.id}', \( {!flow.enabled})" title=" \){flow.enabled ? 'Disable' : 'Enable'}">
                    ${flow.enabled ? '⏸' : '▶️'}
                </button>
                <button class="btn-secondary btn-small" onclick="duplicateFlow('${flow.id}')" title="Duplicate">
                    📋
                </button>
                <button class="btn-secondary btn-small" onclick="exportFlow('${flow.id}')" title="Export">
                    💾
                </button>
                <button class="btn-danger btn-small" onclick="confirmDeleteFlow('${flow.id}')" title="Delete">
                    🗑️
                </button>
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
                <span class="route-method \( {route.method}"> \){route.method}</span>
                <code class="route-path">${escapeHtml(route.fullUrl)}</code>
            </div>
            <div class="route-flow">
                Flow: <strong>${escapeHtml(route.flow_name)}</strong> | Node: ${escapeHtml(route.node_id)}
            </div>
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
                     data-node-label="${escapeHtml(node.label)}"
                     data-node-icon="${node.icon || '📦'}">
                    ${node.icon || '📦'} ${escapeHtml(node.label)}
                </div>
            `).join('')}
        </div>
    `).join('');
    
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
    if (state.editor) {
        return state.editor;
    }
    
    if (typeof Drawflow === 'undefined') {
        console.error('Drawflow not available');
        showToast('Editor not available', 'error');
        return null;
    }
    
    const container = document.getElementById('drawflow');
    if (!container) {
        console.error('Drawflow container not found');
        return null;
    }
    
    try {
        state.editor = new Drawflow(container);
        state.editor.reroute = true;
        state.editor.reroute_fix_curvature = true;
        state.editor.force_first_input = false;
        state.editor.start();
        
        setupEditorEvents();
        setupDropZone(container);
        
        console.log('✓ Drawflow editor initialized');
        return state.editor;
    } catch (error) {
        console.error('Drawflow initialization error:', error);
        showToast('Failed to initialize editor', 'error');
        return null;
    }
}

function setupEditorEvents() {
    if (!state.editor) return;
    
    state.editor.on('nodeCreated', (nodeId) => {
        console.log('Node created:', nodeId);
        state.isModified = true;
    });
    
    state.editor.on('nodeSelected', (nodeId) => {
        state.selectedNodeId = nodeId;
    });
    
    state.editor.on('nodeUnselected', () => {
        state.selectedNodeId = null;
        document.getElementById('propertiesPanel').classList.remove('visible');
    });
    
    state.editor.on('nodeRemoved', (nodeId) => {
        if (state.selectedNodeId === nodeId) {
            state.selectedNodeId = null;
            clearNodeProperties();
        }
        state.isModified = true;
    });
    
    state.editor.on('connectionCreated', (connection) => {
        console.log('Connection created:', connection);
        state.isModified = true;
    });
    
    state.editor.on('connectionRemoved', (connection) => {
        console.log('Connection removed:', connection);
        state.isModified = true;
    });
    
    state.editor.on('nodeMoved', (nodeId) => {
        state.isModified = true;
    });
    
    const container = document.getElementById('drawflow');
    container.addEventListener('dblclick', (e) => {
        if (state.selectedNodeId) {
            showNodeProperties(state.selectedNodeId);
            document.getElementById('propertiesPanel').classList.add('visible');
        }
    });
}

function setupDropZone(container) {
    container.addEventListener('dragover', (e) => {
        e.preventDefault();
    });
    
    container.addEventListener('drop', (e) => {
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
    
    if (!state.editor) {
        await new Promise(resolve => setTimeout(resolve, 100));
        setupDrawflow();
    }
    
    if (!state.editor) {
        showToast('Editor failed to initialize', 'error');
        closeFlowEditor();
        return;
    }
    
    try {
        state.editor.clear();
        state.editor.zoom_reset();
        state.zoom = 1;
        state.isModified = false;
        clearNodeProperties();
        clearDebugOutput();
    } catch (error) {
        console.error('Error clearing editor:', error);
    }
    
    if (flowId) {
        await loadFlowIntoEditor(flowId);
    } else {
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
    state.isModified = false;
    
    if (state.editor) {
        try {
            state.editor.clear();
        } catch (error) {
            console.error('Error clearing editor:', error);
        }
    }
    
    clearNodeProperties();
    document.getElementById('propertiesPanel').classList.remove('visible');
}

async function loadFlowIntoEditor(flowId) {
    try {
        const response = await fetch(`\( {API_BASE}/admin/flows/ \){flowId}`);
        const flow = await response.json();
        
        state.currentFlow = flow;
        document.getElementById('flowName').value = flow.name;
        document.getElementById('flowDescription').value = flow.description || '';
        
        if (flow.config && flow.config.nodes) {
            await loadFlowData(flow.config);
        }
    } catch (error) {
        console.error('Error loading flow:', error);
        showToast('Error loading flow', 'error');
    }
}

// ===================================================================
// FIXED: Load Flow Data - Use wires array
// ===================================================================

function loadFlowData(config) {
    if (!state.editor || !config.nodes || config.nodes.length === 0) {
        return;
    }
    
    const idMap = new Map();
    
    // First pass: Add nodes
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
        
        idMap.set(node.id, newNodeId);
    });
    
    // Second pass: Add connections FROM WIRES (Node-RED format)
    config.nodes.forEach(node => {
        const sourceNodeId = idMap.get(node.id);
        
        if (node.wires && Array.isArray(node.wires) && sourceNodeId) {
            node.wires.forEach((wireGroup, outputIndex) => {
                if (Array.isArray(wireGroup)) {
                    wireGroup.forEach(targetId => {
                        const targetNodeId = idMap.get(targetId);
                        
                        if (targetNodeId) {
                            try {
                                state.editor.addConnection(
                                    sourceNodeId,
                                    targetNodeId,
                                    `output_${outputIndex + 1}`,
                                    `input_1`
                                );
                            } catch (error) {
                                console.warn('Could not create connection:', error);
                            }
                        }
                    });
                }
            });
        }
    });
    
    state.isModified = false;
}

function createNodeHTML(nodeData, nodeDefinition) {
    const ui = nodeDefinition.ui || {};
    const icon = ui.icon || '📦';
    const label = ui.paletteLabel || nodeData.type;
    const color = ui.color || '#0066cc';
    
    let details = '';
    if (nodeData.name) {
        details += `<div style="font-weight: 500; margin-top: 0.25rem;">${escapeHtml(nodeData.name)}</div>`;
    }
    if (nodeData.url) {
        details += `<div style="font-size: 0.7rem; color: #666; margin-top: 0.25rem;">${escapeHtml(nodeData.url)}</div>`;
    }
    if (nodeData.method) {
        details += `<div style="font-size: 0.7rem; color: #666;">${escapeHtml(nodeData.method.toUpperCase())}</div>`;
    }
    
    return `
        <div class="node-content" style="border-left: 4px solid ${color}">
            <div class="node-header">
                ${icon} ${escapeHtml(label)}
            </div>
            <div class="node-body">
                ${details}
            </div>
        </div>
    `;
}

// ===================================================================
// FIXED: Save Flow - Build wires array from Drawflow outputs
// ===================================================================

async function saveCurrentFlow() {
    if (!state.currentFlow || !state.editor) {
        showToast('Editor not ready', 'error');
        return;
    }
    
    const flowName = document.getElementById('flowName').value.trim();
    const flowDescription = document.getElementById('flowDescription').value.trim();
    
    if (!flowName) {
        showToast('Flow name is required', 'error');
        return;
    }
    
    try {
        const exportData = state.editor.export();
        const drawflowData = exportData.drawflow.Home.data;
        
        // Build nodes with wires array (Node-RED format)
        const nodes = Object.values(drawflowData).map(node => {
            const nodeData = node.data || {};
            
            // BUILD WIRES ARRAY FROM DRAWFLOW OUTPUTS
            const wires = [];
            if (node.outputs) {
                Object.entries(node.outputs).forEach(([outputKey, outputData]) => {
                    const outputIndex = parseInt(outputKey.replace('output_', '')) - 1;
                    wires[outputIndex] = outputData.connections?.map(conn => conn.node) || [];
                });
            }
            
            // Fill empty wire slots
            const nodeDefinition = state.nodeDefinitions.get(node.name);
            const outputCount = nodeDefinition?.outputs || 1;
            for (let i = 0; i < outputCount; i++) {
                if (!wires[i]) {
                    wires[i] = [];
                }
            }
            
            return {
                id: node.id.toString(),
                type: node.name,
                wires: wires,
                x: node.pos_x,
                y: node.pos_y,
                ...nodeData
            };
        });
        
        const flowData = {
            id: state.currentFlow.id,
            name: flowName,
            description: flowDescription,
            nodes: nodes
        };
        
        const url = state.currentFlow.created_at
            ? `\( {API_BASE}/admin/flows/ \){state.currentFlow.id}`
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
            state.isModified = false;
            
            if (result.endpoints && result.endpoints.length > 0) {
                addDebugMessage('info', 'Flow endpoints created:');
                result.endpoints.forEach(ep => {
                    addDebugMessage('info', `${ep.method} ${ep.url}`);
                });
            }
            
            await loadFlows();
            
            if (!state.currentFlow.created_at) {
                closeFlowEditor();
            }
        } else {
            showToast(`Error: ${result.error}`, 'error');
            if (result.errors) {
                result.errors.forEach(err => {
                    addDebugMessage('error', err);
                });
            }
        }
    } catch (error) {
        console.error('Error saving flow:', error);
        showToast('Error saving flow', 'error');
    }
}

function validateCurrentFlow() {
    if (!state.editor) {
        showToast('Editor not ready', 'error');
        return;
    }
    
    const exportData = state.editor.export();
    const nodes = Object.values(exportData.drawflow.Home.data);
    
    if (nodes.length === 0) {
        showToast('Flow is empty', 'warning');
        return;
    }
    
    const issues = [];
    
    const httpInNodes = nodes.filter(n => n.name === 'http-in');
    if (httpInNodes.length === 0) {
        issues.push('⚠️ No HTTP trigger nodes found');
    }
    
    const httpResponseNodes = nodes.filter(n => n.name === 'http-response');
    if (httpResponseNodes.length === 0) {
        issues.push('⚠️ No HTTP response nodes found');
    }
    
    const disconnectedNodes = nodes.filter(n => {
        const hasInputConnections = n.inputs && Object.values(n.inputs).some(i => i.connections.length > 0);
        const hasOutputConnections = n.outputs && Object.values(n.outputs).some(o => o.connections.length > 0);
        return !hasInputConnections && !hasOutputConnections && n.name !== 'http-in';
    });
    
    if (disconnectedNodes.length > 0) {
        issues.push(`⚠️ ${disconnectedNodes.length} disconnected node(s)`);
    }
    
    clearDebugOutput();
    
    if (issues.length > 0) {
        addDebugMessage('warning', 'Validation warnings:');
        issues.forEach(issue => addDebugMessage('warning', issue));
        showToast('Validation completed with warnings', 'warning');
    } else {
        addDebugMessage('success', `✓ Flow validated: ${nodes.length} nodes, no issues found`);
        showToast(`Flow validated: ${nodes.length} nodes`, 'success');
    }
}

function scheduleAutoSave() {
    if (state.autoSaveTimer) {
        clearTimeout(state.autoSaveTimer);
    }
    
    state.autoSaveTimer = setTimeout(() => {
        if (state.isModified && state.currentFlow && state.currentFlow.created_at) {
            saveCurrentFlow();
        }
    }, 30000);
}

// ===================================================================
// Node Properties Panel
// ===================================================================

function showNodeProperties(nodeId) {
    if (!state.editor) return;
    
    const content = document.getElementById('propertiesContent');
    const nodeInfo = state.editor.getNodeFromId(nodeId);
    
    if (!nodeInfo) {
        content.innerHTML = '<div class="properties-empty">Node not found</div>';
        return;
    }
    
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
    
    Object.entries(defaults).forEach(([key, defaultValue]) => {
        const currentValue = nodeData[key] !== undefined ? nodeData[key] : defaultValue;
        const propertyType = typeof defaultValue;
        
        html += `<div class="property-group">`;
        html += `<label class="property-label">${escapeHtml(formatLabel(key))}</label>`;
        
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
        } else if (['func', 'code', 'template'].includes(key) || (propertyType === 'string' && currentValue.length > 50)) {
            html += `
                <textarea class="property-textarea" 
                         id="prop_${key}" 
                         placeholder="Enter \( {key}"> \){escapeHtml(currentValue.toString())}</textarea>
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
    
    // Add change listeners
    Object.keys(defaults).forEach(key => {
        const element = document.getElementById(`prop_${key}`);
        if (element) {
            element.addEventListener('change', (e) => {
                const value = element.type === 'checkbox' ? element.checked : element.value;
                updateNodeData(nodeId, { [key]: value });
                updateNodeDisplay(nodeId);
                state.isModified = true;
            });
        }
    });
}

function clearNodeProperties() {
    const content = document.getElementById('propertiesContent');
    content.innerHTML = '<div class="properties-empty">Double-click a node to edit properties</div>';
}

function updateNodeData(nodeId, data) {
    if (!state.editor) return;
    
    const nodeInfo = state.editor.getNodeFromId(nodeId);
    if (nodeInfo) {
        const updatedData = { ...nodeInfo.data, ...data };
        state.editor.updateNodeDataFromId(nodeId, updatedData);
    }
}

function updateNodeDisplay(nodeId) {
    if (!state.editor) return;
    
    const nodeInfo = state.editor.getNodeFromId(nodeId);
    if (!nodeInfo) return;
    
    const nodeDefinition = state.nodeDefinitions.get(nodeInfo.name);
    if (!nodeDefinition) return;
    
    const nodeElement = document.getElementById(`node-${nodeId}`);
    if (nodeElement) {
        const newHTML = createNodeHTML(nodeInfo.data, nodeDefinition);
        const contentDiv = nodeElement.querySelector('.node-content');
        if (contentDiv) {
            contentDiv.outerHTML = newHTML;
        }
    }
}

function deleteSelectedNode() {
    if (state.selectedNodeId && state.editor) {
        showConfirmModal(
            'Delete Node',
            'Are you sure you want to delete this node?',
            () => {
                state.editor.removeNodeId(`node-${state.selectedNodeId}`);
                clearNodeProperties();
                document.getElementById('propertiesPanel').classList.remove('visible');
                showToast('Node deleted', 'info');
            }
        );
    }
}

function formatLabel(key) {
    return key.split(/(?=[A-Z])|_/).map(word => 
        word.charAt(0).toUpperCase() + word.slice(1)
    ).join(' ');
}

// ===================================================================
// Drag and Drop
// ===================================================================

function handleDragStart(e) {
    const nodeType = e.target.dataset.nodeType;
    const nodeLabel = e.target.dataset.nodeLabel;
    const nodeIcon = e.target.dataset.nodeIcon;
    e.dataTransfer.setData('node-type', nodeType);
    e.dataTransfer.setData('node-label', nodeLabel);
    e.dataTransfer.setData('node-icon', nodeIcon);
}

function handleDrop(e) {
    if (!state.editor) {
        showToast('Editor not ready', 'error');
        return;
    }
    
    const nodeType = e.dataTransfer.getData('node-type');
    if (!nodeType) return;
    
    const nodeDefinition = state.nodeDefinitions.get(nodeType);
    if (!nodeDefinition) {
        showToast('Node type not found', 'error');
        return;
    }
    
    const rect = e.target.closest('#drawflow').getBoundingClientRect();
    const x = (e.clientX - rect.left) / state.zoom;
    const y = (e.clientY - rect.top) / state.zoom;
    
    const nodeData = { ...nodeDefinition.defaults };
    
    const html = createNodeHTML(nodeData, nodeDefinition);
    const inputCount = nodeDefinition.inputs || 1;
    const outputCount = nodeDefinition.outputs || 1;
    
    try {
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
        state.isModified = true;
    } catch (error) {
        console.error('Error adding node:', error);
        showToast('Failed to add node', 'error');
    }
}

// ===================================================================
// FIXED: Flow Execution with Timeout
// ===================================================================

async function executeCurrentFlow() {
    if (!state.currentFlow || !state.editor) {
        showToast('No flow to execute', 'error');
        return;
    }
    
    const exportData = state.editor.export();
    const nodes = Object.values(exportData.drawflow.Home.data);
    const httpInNodes = nodes.filter(n => n.name === 'http-in');
    
    if (httpInNodes.length === 0) {
        showToast('No HTTP trigger nodes found', 'warning');
        return;
    }
    
    clearDebugOutput();
    addDebugMessage('info', `⚙️ Executing flow: ${state.currentFlow.name}`);
    
    for (const node of httpInNodes) {
        const nodeId = node.id.toString();
        addDebugMessage('info', `▶️ Triggering node \( {nodeId} ( \){node.data.url || '/'})`);
        
        // Create abort controller for timeout
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000);
        
        try {
            const response = await fetch(`\( {API_BASE}/admin/flows/ \){state.currentFlow.id}/execute`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    nodeId: nodeId,
                    payload: { test: true }
                }),
                signal: controller.signal
            });
            
            clearTimeout(timeoutId);
            
            const result = await response.json();
            
            if (response.ok) {
                addDebugMessage('success', `✓ Execution completed`);
                if (result.output) {
                    addDebugMessage('info', JSON.stringify(result.output, null, 2));
                }
            } else {
                addDebugMessage('error', `✗ Execution failed: ${result.error}`);
            }
        } catch (error) {
            clearTimeout(timeoutId);
            
            if (error.name === 'AbortError') {
                addDebugMessage('error', `✗ Execution timeout (30s)`);
                showToast('Execution timeout', 'error');
            } else {
                console.error('Execution error:', error);
                addDebugMessage('error', `✗ Error: ${error.message}`);
                showToast('Execution failed', 'error');
            }
        }
    }
}

// ===================================================================
// Import/Export
// ===================================================================

async function exportCurrentFlow() {
    if (!state.currentFlow) {
        showToast('No flow to export', 'error');
        return;
    }
    
    try {
        const response = await fetch(`\( {API_BASE}/admin/flows/ \){state.currentFlow.id}/export`);
        const data = await response.json();
        
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${state.currentFlow.name}.json`;
        a.click();
        URL.revokeObjectURL(url);
        
        showToast('Flow exported', 'success');
    } catch (error) {
        console.error('Export error:', error);
        showToast('Export failed', 'error');
    }
}

async function exportFlow(flowId) {
    try {
        const response = await fetch(`\( {API_BASE}/admin/flows/ \){flowId}/export`);
        const data = await response.json();
        
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${data.name}.json`;
        a.click();
        URL.revokeObjectURL(url);
        
        showToast('Flow exported', 'success');
    } catch (error) {
        console.error('Export error:', error);
        showToast('Export failed', 'error');
    }
}

function openImportModal() {
    document.getElementById('importModal').classList.add('active');
    document.getElementById('importJson').value = '';
    document.getElementById('importFileName').textContent = '';
}

function closeImportModal() {
    document.getElementById('importModal').classList.remove('active');
}

function handleFileImport(e) {
    const file = e.target.files[0];
    if (!file) return;
    
    document.getElementById('importFileName').textContent = file.name;
    
    const reader = new FileReader();
    reader.onload = (event) => {
        document.getElementById('importJson').value = event.target.result;
    };
    reader.readAsText(file);
}

async function importFlow() {
    const jsonText = document.getElementById('importJson').value.trim();
    
    if (!jsonText) {
        showToast('Please provide flow JSON', 'error');
        return;
    }
    
    try {
        const flowData = JSON.parse(jsonText);
        
        const response = await fetch(`${API_BASE}/admin/flows/import`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(flowData)
        });
        
        const result = await response.json();
        
        if (response.ok) {
            showToast('Flow imported successfully', 'success');
            closeImportModal();
            await loadFlows();
        } else {
            showToast(`Import failed: ${result.error}`, 'error');
        }
    } catch (error) {
        console.error('Import error:', error);
        showToast('Invalid JSON format', 'error');
    }
}

// ===================================================================
// Flow Actions
// ===================================================================

async function toggleFlow(flowId, enable) {
    try {
        const action = enable ? 'enable' : 'disable';
        const response = await fetch(`\( {API_BASE}/admin/flows/ \){flowId}/${action}`, {
            method: 'POST'
        });
        
        if (response.ok) {
            showToast(`Flow ${action}d`, 'success');
            await loadFlows();
        } else {
            showToast(`Error ${action}ing flow`, 'error');
        }
    } catch (error) {
        console.error('Toggle error:', error);
        showToast('Error toggling flow', 'error');
    }
}

async function duplicateFlow(flowId) {
    try {
        const response = await fetch(`\( {API_BASE}/admin/flows/ \){flowId}`);
        const flow = await response.json();
        
        const newFlow = {
            id: generateId(),
            name: `${flow.name} (Copy)`,
            description: flow.description,
            nodes: flow.config.nodes
        };
        
        const createResponse = await fetch(`${API_BASE}/admin/flows`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(newFlow)
        });
        
        if (createResponse.ok) {
            showToast('Flow duplicated', 'success');
            await loadFlows();
        } else {
            showToast('Duplication failed', 'error');
        }
    } catch (error) {
        console.error('Duplicate error:', error);
        showToast('Duplication failed', 'error');
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
        const response = await fetch(`\( {API_BASE}/admin/flows/ \){flowId}`, {
            method: 'DELETE'
        });
        
        if (response.ok) {
            showToast('Flow deleted', 'success');
            await loadFlows();
        } else {
            showToast('Delete failed', 'error');
        }
    } catch (error) {
        console.error('Delete error:', error);
        showToast('Delete failed', 'error');
    }
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
// Debug Panel
// ===================================================================

function addDebugMessage(type, message) {
    const content = document.getElementById('debugContent');
    const empty = content.querySelector('.debug-empty');
    if (empty) {
        empty.remove();
    }
    
    const timestamp = new Date().toLocaleTimeString();
    const messageDiv = document.createElement('div');
    messageDiv.className = `debug-message ${type}`;
    messageDiv.innerHTML = `
        <div class="debug-timestamp">[${timestamp}]</div>
        <div>${escapeHtml(message)}</div>
    `;
    
    content.appendChild(messageDiv);
    content.scrollTop = content.scrollHeight;
    
    const panel = document.getElementById('debugPanel');
    if (panel.classList.contains('collapsed')) {
        panel.classList.remove('collapsed');
    }
}

function clearDebugOutput() {
    const content = document.getElementById('debugContent');
    content.innerHTML = '<div class="debug-empty">No debug output yet. Execute flow to see results.</div>';
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
    const now = new Date();
    const diff = now - date;
    
    if (diff < 60000) {
        return 'Just now';
    }
    
    if (diff < 3600000) {
        const minutes = Math.floor(diff / 60000);
        return `\( {minutes} minute \){minutes > 1 ? 's' : ''} ago`;
    }
    
    if (diff < 86400000) {
        const hours = Math.floor(diff / 3600000);
        return `\( {hours} hour \){hours > 1 ? 's' : ''} ago`;
    }
    
    if (diff < 604800000) {
        const days = Math.floor(diff / 86400000);
        return `\( {days} day \){days > 1 ? 's' : ''} ago`;
    }
    
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { 
        hour: '2-digit', 
        minute: '2-digit' 
    });
}

function generateId() {
    return 'flow_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now();
}

// ===================================================================
// Export for Global Access
// ===================================================================

window.RedNoxAdmin = {
    state,
    loadFlows,
    loadRoutes,
    loadNodes,
    openFlowEditor,
    closeFlowEditor,
    saveCurrentFlow,
    executeCurrentFlow,
    exportCurrentFlow,
    deleteSelectedNode,
    showToast,
    addDebugMessage
};

console.log('%cRedNox Admin UI', 'font-size: 20px; font-weight: bold; color: #0066cc;');
console.log('%cVersion 2.0 - Fixed Edition', 'font-size: 12px; color: #666;');
console.log('API:', window.RedNoxAdmin);
