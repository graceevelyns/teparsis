import { RaftClient, StatusResponse } from './client.js';

const client = new RaftClient();

// UI Functions
function showResult(elementId: string, type: string, message: string, data: any = null): void {
    const element = document.getElementById(elementId);
    if (!element) return;
    
    element.className = `result ${type}`;
    element.style.display = 'block';
    
    let html = `<strong>${message}</strong>`;
    if (data !== null) {
        html += `<pre>${JSON.stringify(data, null, 2)}</pre>`;
    }
    element.innerHTML = html;

    // Auto hide after 5 seconds
    setTimeout(() => {
        element.style.display = 'none';
    }, 5000);
}

async function pingCluster(): Promise<void> {
    try {
        const result = await client.ping();
        showResult('pingResult', 'success', 'Cluster is alive!', result);
    } catch (error) {
        showResult('pingResult', 'error', 'Ping failed: ' + (error as Error).message);
    }
}

async function getValue(): Promise<void> {
    const keyElement = document.getElementById('key') as HTMLInputElement;
    if (!keyElement) return;
    
    const key = keyElement.value.trim();
    if (!key) {
        showResult('operationResult', 'error', 'Please enter a key');
        return;
    }

    try {
        const result = await client.get(key);
        const value = result.value ?? '';
        showResult('operationResult', 'success', `Value for "${key}":`, value);
    } catch (error) {
        showResult('operationResult', 'error', 'Get failed: ' + (error as Error).message);
    }
}

async function setValue(): Promise<void> {
    const keyElement = document.getElementById('key') as HTMLInputElement;
    const valueElement = document.getElementById('value') as HTMLInputElement;
    if (!keyElement || !valueElement) return;
    
    const key = keyElement.value.trim();
    const value = valueElement.value;
    
    if (!key) {
        showResult('operationResult', 'error', 'Please enter a key');
        return;
    }

    try {
        await client.set(key, value);
        showResult('operationResult', 'success', `Successfully set "${key}" = "${value}"`);
    } catch (error) {
        showResult('operationResult', 'error', 'Set failed: ' + (error as Error).message);
    }
}

async function deleteValue(): Promise<void> {
    const keyElement = document.getElementById('key') as HTMLInputElement;
    if (!keyElement) return;
    
    const key = keyElement.value.trim();
    if (!key) {
        showResult('operationResult', 'error', 'Please enter a key');
        return;
    }

    try {
        const result = await client.del(key);
        showResult('operationResult', 'success', `Deleted "${key}". Returned value:`, result.value ?? '');
    } catch (error) {
        showResult('operationResult', 'error', 'Delete failed: ' + (error as Error).message);
    }
}

async function appendValue(): Promise<void> {
    const keyElement = document.getElementById('key') as HTMLInputElement;
    const valueElement = document.getElementById('value') as HTMLInputElement;
    if (!keyElement || !valueElement) return;
    
    const key = keyElement.value.trim();
    const value = valueElement.value;
    
    if (!key) {
        showResult('operationResult', 'error', 'Please enter a key');
        return;
    }

    try {
        const result = await client.append(key, value);
        let lengthInfo: any = null;

        try {
            const lengthResult = await client.strlen(key);
            lengthInfo = { length: lengthResult.value };
        } catch (lengthError) {
            lengthInfo = result.value ?? 'OK';
        }

        showResult('operationResult', 'success', `Appended to "${key}".`, lengthInfo);
    } catch (error) {
        showResult('operationResult', 'error', 'Append failed: ' + (error as Error).message);
    }
}

async function getLength(): Promise<void> {
    const keyElement = document.getElementById('key') as HTMLInputElement;
    if (!keyElement) return;
    
    const key = keyElement.value.trim();
    if (!key) {
        showResult('operationResult', 'error', 'Please enter a key');
        return;
    }

    try {
        const result = await client.strlen(key);
        showResult('operationResult', 'success', `Length of "${key}": ${result.value}`);
    } catch (error) {
        showResult('operationResult', 'error', 'Length failed: ' + (error as Error).message);
    }
}

async function getClusterStatus(): Promise<void> {
    const loading = document.getElementById('statusLoading');
    const statusDiv = document.getElementById('clusterStatus');
    if (!loading || !statusDiv) return;
    
    loading.classList.add('active');
    statusDiv.innerHTML = '';

    try {
        const statuses = await client.status();
        
        statusDiv.innerHTML = statuses.map((status: StatusResponse) => {
            const state = (status.state || 'unreachable').toLowerCase();
            const badgeClass = `badge-${state}`;
            
            let infoHtml = '';
            if (state !== 'unreachable') {
                infoHtml = `
                    <div class="node-info">
                        <div><strong>Term:</strong> ${status.term}</div>
                        <div><strong>Leader:</strong> ${status.isLeader ? 'Yes' : 'No'}</div>
                        ${status.leaderId ? `<div><strong>Leader ID:</strong> ${status.leaderId}</div>` : ''}
                        ${status.votedFor ? `<div><strong>Voted For:</strong> ${status.votedFor}</div>` : ''}
                    </div>
                `;
            } else {
                infoHtml = `<div class="node-info"><div><strong>Error:</strong> ${status.error || 'Unreachable'}</div></div>`;
            }

            return `
                <div class="node-card ${state}">
                    <div class="node-header">
                        <span class="node-id">${status.nodeUrl}</span>
                        <span class="node-badge ${badgeClass}">${state}</span>
                    </div>
                    ${infoHtml}
                </div>
            `;
        }).join('');

    } catch (error) {
        statusDiv.innerHTML = `<div class="result error">Failed to get cluster status: ${(error as Error).message}</div>`;
    } finally {
        loading.classList.remove('active');
    }
}

// Make functions available globally for HTML onclick handlers
(window as any).pingCluster = pingCluster;
(window as any).getValue = getValue;
(window as any).setValue = setValue;
(window as any).deleteValue = deleteValue;
(window as any).appendValue = appendValue;
(window as any).getLength = getLength;
(window as any).getClusterStatus = getClusterStatus;

// Load cluster status on page load
window.addEventListener('load', () => {
    getClusterStatus();
});
