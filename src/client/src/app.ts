import { RaftClient, StatusResponse } from "./client.js";

declare global {
  interface Window {
    CLUSTER_CONFIG: {
      nodes: { id: string; address: string }[];
    };
  }
}

const CLUSTER_NODES = window.CLUSTER_CONFIG?.nodes || [];

const client = new RaftClient({
  nodeUrls: CLUSTER_NODES.map((node) => node.address),
});

function initializeNodeDropdown(): void {
  if (CLUSTER_NODES.length === 0) {
    console.warn("No nodes configured in cluster");
    return;
  }

  console.log("Loaded cluster nodes:", CLUSTER_NODES);
  updateNodeDropdown();
}

// Update the node selection dropdown with cluster nodes
function updateNodeDropdown(): void {
  const nodeSelect = document.getElementById("nodeSelect") as HTMLSelectElement;
  if (!nodeSelect) return;

  // Clear existing options except the first one
  nodeSelect.innerHTML = '<option value="">-- Select a node --</option>';

  // Add options for each cluster node
  CLUSTER_NODES.forEach((node) => {
    const option = document.createElement("option");
    option.value = `${node.id}|${node.address.replace(
      "localhost",
      "raft-node" + (parseInt(node.id) - 2999)
    )}`;
    option.textContent = `Node ${node.id} (${node.address})`;
    nodeSelect.appendChild(option);
  });
}

// UI Functions
function showResult(
  elementId: string,
  type: string,
  message: string,
  data: any = null
): void {
  const element = document.getElementById(elementId);
  if (!element) return;

  element.className = `result ${type}`;
  element.style.display = "block";

  let html = `<strong>${message}</strong>`;
  if (data !== null) {
    html += `<pre>${JSON.stringify(data, null, 2)}</pre>`;
  }
  element.innerHTML = html;

  // Auto hide after 5 seconds
  setTimeout(() => {
    element.style.display = "none";
  }, 10000);
}

async function pingCluster(): Promise<void> {
  try {
    const result = await client.ping();
    showResult("pingResult", "success", "Cluster is alive!", result);
  } catch (error) {
    showResult(
      "pingResult",
      "error",
      "Ping failed: " + (error as Error).message
    );
  }
}

async function getValue(): Promise<void> {
  const keyElement = document.getElementById("key") as HTMLInputElement;
  if (!keyElement) return;

  const key = keyElement.value.trim();
  if (!key) {
    showResult("operationResult", "error", "Please enter a key");
    return;
  }

  try {
    const result = await client.get(key);
    const value = result.value ?? "";
    showResult("operationResult", "success", `Value for "${key}":`, value);
  } catch (error) {
    showResult(
      "operationResult",
      "error",
      "Get failed: " + (error as Error).message
    );
  }
}

async function setValue(): Promise<void> {
  const keyElement = document.getElementById("key") as HTMLInputElement;
  const valueElement = document.getElementById("value") as HTMLInputElement;
  if (!keyElement || !valueElement) return;

  const key = keyElement.value.trim();
  const value = valueElement.value;

  if (!key) {
    showResult("operationResult", "error", "Please enter a key");
    return;
  }

  try {
    await client.set(key, value);
    showResult(
      "operationResult",
      "success",
      `Successfully set "${key}" = "${value}"`
    );
  } catch (error) {
    showResult(
      "operationResult",
      "error",
      "Set failed: " + (error as Error).message
    );
  }
}

async function deleteValue(): Promise<void> {
  const keyElement = document.getElementById("key") as HTMLInputElement;
  if (!keyElement) return;

  const key = keyElement.value.trim();
  if (!key) {
    showResult("operationResult", "error", "Please enter a key");
    return;
  }

  try {
    const result = await client.del(key);
    showResult(
      "operationResult",
      "success",
      `Deleted "${key}". Returned value:`,
      result.value ?? ""
    );
  } catch (error) {
    showResult(
      "operationResult",
      "error",
      "Delete failed: " + (error as Error).message
    );
  }
}

async function appendValue(): Promise<void> {
  const keyElement = document.getElementById("key") as HTMLInputElement;
  const valueElement = document.getElementById("value") as HTMLInputElement;
  if (!keyElement || !valueElement) return;

  const key = keyElement.value.trim();
  const value = valueElement.value;

  if (!key) {
    showResult("operationResult", "error", "Please enter a key");
    return;
  }

  try {
    const result = await client.append(key, value);
    let lengthInfo: any = null;

    try {
      const lengthResult = await client.strlen(key);
      lengthInfo = { length: lengthResult.value };
    } catch (lengthError) {
      lengthInfo = result.value ?? "OK";
    }

    showResult(
      "operationResult",
      "success",
      `Appended to "${key}".`,
      lengthInfo
    );
  } catch (error) {
    showResult(
      "operationResult",
      "error",
      "Append failed: " + (error as Error).message
    );
  }
}

async function getLength(): Promise<void> {
  const keyElement = document.getElementById("key") as HTMLInputElement;
  if (!keyElement) return;

  const key = keyElement.value.trim();
  if (!key) {
    showResult("operationResult", "error", "Please enter a key");
    return;
  }

  try {
    const result = await client.strlen(key);
    showResult(
      "operationResult",
      "success",
      `Length of "${key}": ${result.value}`
    );
  } catch (error) {
    showResult(
      "operationResult",
      "error",
      "Length failed: " + (error as Error).message
    );
  }
}

async function getClusterStatus(): Promise<void> {
  const loading = document.getElementById("statusLoading");
  const statusDiv = document.getElementById("clusterStatus");
  if (!loading || !statusDiv) return;

  loading.classList.add("active");
  statusDiv.innerHTML = "";

  try {
    // Get status for all nodes in fixed cluster
    const statuses: StatusResponse[] = await client.status();
    // Add timeout to prevent hanging requests
    // const controller = new AbortController();
    // const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout
    // console.log("Fetching status from node:", node.address);
    // const response = await fetch(`${node.address}/api/raft/status`, {
    //   signal: controller.signal,
    // });
    // clearTimeout(timeoutId);

    // const data = await response.json();
    // statuses.push({
    //   ...data,
    //   nodeUrl: node.address,
    // });

    const selectedNode = client.getSelectedNode();

    statusDiv.innerHTML = statuses
      .map((status: StatusResponse) => {
        const state = (status.state || "unreachable").toLowerCase();
        const badgeClass = `badge-${state}`;
        const isSelected = selectedNode === status.nodeUrl;
        const selectedClass = isSelected ? "selected" : "";

        let infoHtml = "";
        if (state !== "unreachable") {
          infoHtml = `
                    <div class="node-info">
                        <div><strong>Term:</strong> ${status.term}</div>
                        <div><strong>Leader:</strong> ${
                          status.isLeader ? "Yes" : "No"
                        }</div>
                        ${
                          status.leaderId
                            ? `<div><strong>Leader ID:</strong> ${status.leaderId}</div>`
                            : ""
                        }
                        ${
                          status.votedFor
                            ? `<div><strong>Voted For:</strong> ${status.votedFor}</div>`
                            : ""
                        }
                    </div>
                `;
        } else {
          infoHtml = `<div class="node-info"><div><strong>Error:</strong> ${
            status.error || "Unreachable"
          }</div></div>`;
        }

        // Extract node ID from URL (e.g., http://localhost:3001 -> 3001)
        const match = status.nodeUrl.match(/:(\d+)/);
        const nodeId = match ? match[1] : "";

        const actionsHtml = `
                <div class="node-actions">
                    <button class="btn-sm ${
                      isSelected ? "btn-success" : "btn-primary"
                    }" onclick="selectNode('${status.nodeUrl}')">
                        ${isSelected ? "✓ Selected" : "Select"}
                    </button>
                    ${
                      nodeId && state !== "unreachable"
                        ? `
                        <button class="btn-sm btn-danger" onclick="removeNodeFromCluster('${status.nodeUrl}')">
                            Remove
                        </button>
                    `
                        : ""
                    }
                </div>
            `;

        return `
                <div class="node-card ${state} ${selectedClass}">
                    <div class="node-header">
                        <span class="node-id">${status.nodeUrl}</span>
                        <span class="node-badge ${badgeClass}">${state}</span>
                    </div>
                    ${infoHtml}
                    ${actionsHtml}
                </div>
            `;
      })
      .join("");
  } catch (error) {
    statusDiv.innerHTML = `<div class="result error">Failed to get cluster status: ${
      (error as Error).message
    }</div>`;
  } finally {
    loading.classList.remove("active");
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

function buildLogTable(logs: any[]): string {
  const headerHtml =
    '<table class="log-table"><thead><tr><th>Index</th><th>Term</th><th>Operation</th><th>Key</th><th>Value</th><th>Committed</th></tr></thead><tbody>';

  const rowsHtml = logs
    .map((log) => {
      const operation = log.command?.operation || "unknown";
      const key = log.command?.key || "-";
      const value = log.command?.value || "-";
      const committed = log.isCommitted ? "✓" : "✗";

      return `<tr><td>${log.index}</td><td>${log.term}</td><td>${operation}</td><td>${key}</td><td>${value}</td><td class="center">${committed}</td></tr>`;
    })
    .join("");

  return headerHtml + rowsHtml + "</tbody></table>";
}

async function getRequestLog(): Promise<void> {
  const loading = document.getElementById("logLoading");
  const logDiv = document.getElementById("requestLogResult");
  if (!loading || !logDiv) return;

  loading.classList.add("active");
  logDiv.innerHTML = "";

  try {
    const result = await client.requestLog();

    if (!result.value || (result.value as any[]).length === 0) {
      logDiv.innerHTML = '<div class="result info">No log entries yet</div>';
      return;
    }

    const logs = result.value as any[];
    logDiv.innerHTML = buildLogTable(logs);
  } catch (error) {
    logDiv.innerHTML = `<div class="result error">Failed to get logs: ${
      (error as Error).message
    }</div>`;
  } finally {
    loading.classList.remove("active");
  }
}

(window as any).getRequestLog = getRequestLog;

function selectNode(nodeUrl: string): void {
  const currentSelection = client.getSelectedNode();

  if (currentSelection === nodeUrl) {
    // Deselect
    client.setSelectedNode(null);
    showResult(
      "operationResult",
      "info",
      "Node deselected. Requests will auto-route to leader."
    );
  } else {
    // Select
    client.setSelectedNode(nodeUrl);
    showResult("operationResult", "success", `Selected node: ${nodeUrl}`);
  }

  // Refresh status to show selection
  getClusterStatus();
}

(window as any).selectNode = selectNode;

async function removeNodeFromCluster(nodeUrl: string): Promise<void> {
  if (
    !confirm(`Are you sure you want to remove ${nodeUrl} from the cluster?`)
  ) {
    return;
  }

  try {
    // Extract node ID from URL (assuming format like http://localhost:3001)
    const match = nodeUrl.match(/:(\d+)/);
    const nodeId = match ? `node-${match[1]}` : nodeUrl;

    const result = await client.removePeer(nodeId);

    if (result.success !== false) {
      showResult(
        "operationResult",
        "success",
        `Successfully removed ${nodeUrl} from cluster`
      );
      // Refresh cluster status
      setTimeout(() => getClusterStatus(), 1000);
    } else {
      showResult(
        "operationResult",
        "error",
        result.error || "Failed to remove node"
      );
    }
  } catch (error) {
    showResult(
      "operationResult",
      "error",
      "Remove failed: " + (error as Error).message
    );
  }
}

(window as any).removeNodeFromCluster = removeNodeFromCluster;

async function addNodeToCluster(): Promise<void> {
  const nodeSelectElement = document.getElementById(
    "nodeSelect"
  ) as HTMLSelectElement;

  if (!nodeSelectElement) return;

  const selectedValue = nodeSelectElement.value;
  if (!selectedValue) {
    showResult("membershipResult", "error", "Please select a node to add");
    return;
  }

  // Parse the selected value (format: "id|address")
  const [nodeId, nodeAddress] = selectedValue.split("|");

  try {
    const result = await client.addVoter(nodeId, nodeAddress);

    if (result.success !== false) {
      showResult(
        "membershipResult",
        "success",
        `Successfully added ${nodeId} to cluster`
      );
      nodeSelectElement.value = "";
      // Refresh cluster status
      setTimeout(() => getClusterStatus(), 1000);
    } else {
      showResult(
        "membershipResult",
        "error",
        result.error || "Failed to add node"
      );
    }
  } catch (error) {
    showResult(
      "membershipResult",
      "error",
      "Add node failed: " + (error as Error).message
    );
  }
}

(window as any).addNodeToCluster = addNodeToCluster;

async function getClusterConfiguration(): Promise<void> {
  try {
    const result = await client.getConfiguration();
    showResult(
      "membershipResult",
      "success",
      "Current cluster configuration:",
      result.value
    );
  } catch (error) {
    showResult(
      "membershipResult",
      "error",
      "Get configuration failed: " + (error as Error).message
    );
  }
}

(window as any).getClusterConfiguration = getClusterConfiguration;

async function stopNode(): Promise<void> {
  const selectedNode = client.getSelectedNode();
  if (!selectedNode) {
    showResult("operationResult", "error", "Please select a node first");
    return;
  }

  if (
    !confirm(
      `Are you sure you want to stop ${selectedNode}? This will simulate a node crash.`
    )
  ) {
    return;
  }

  try {
    // Temporarily set the selected node to send request to that specific node
    const result = await client.stopNode();

    if (result.success !== false) {
      showResult(
        "operationResult",
        "success",
        `Successfully stopped node ${selectedNode}`
      );
      // Refresh cluster status
      setTimeout(() => getClusterStatus(), 1000);
    } else {
      showResult(
        "operationResult",
        "error",
        result.error || "Failed to stop node"
      );
    }
  } catch (error) {
    showResult(
      "operationResult",
      "error",
      "Stop failed: " + (error as Error).message
    );
  }
}

(window as any).stopNode = stopNode;

async function restartNode(resetState: boolean = false): Promise<void> {
  const selectedNode = client.getSelectedNode();
  if (!selectedNode) {
    showResult("operationResult", "error", "Please select a node first");
    return;
  }

  const resetMsg = resetState ? " and reset state" : " (preserving state)";
  if (
    !confirm(`Are you sure you want to restart ${selectedNode}${resetMsg}?`)
  ) {
    return;
  }

  try {
    const result = await client.restartNode(resetState);

    if (result.success !== false) {
      showResult(
        "operationResult",
        "success",
        `Successfully restarted node ${selectedNode}${resetMsg}`
      );
      // Refresh cluster status
      setTimeout(() => getClusterStatus(), 1000);
    } else {
      showResult(
        "operationResult",
        "error",
        result.error || "Failed to restart node"
      );
    }
  } catch (error) {
    showResult(
      "operationResult",
      "error",
      "Restart failed: " + (error as Error).message
    );
  }
}

(window as any).restartNode = restartNode;

// Load cluster status on page load
window.addEventListener("load", async () => {
  initializeNodeDropdown();
  getClusterStatus();
});
