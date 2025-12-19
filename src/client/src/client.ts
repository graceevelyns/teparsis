export interface RaftClientOptions {
    nodeUrls?: string[];
}

export interface StatusResponse {
    nodeUrl: string;
    state: string;
    term?: number;
    isLeader?: boolean;
    leaderId?: string;
    votedFor?: string;
    error?: string;
}

export interface ApiResponse {
    value?: any;
    leaderId?: string;
    error?: string;
}

export class RaftClient {
    private currentLeaderIndex: number = 0;

    constructor(private options?: RaftClientOptions) {}

    getNodes(): string[] {
        if (this.options?.nodeUrls) {
            return this.options.nodeUrls;
        }
        const nodeUrlsElement = document.getElementById('nodeUrls') as HTMLTextAreaElement;
        if (!nodeUrlsElement) {
            return [];
        }
        return nodeUrlsElement.value.split('\n').map(url => url.trim()).filter(url => url);
    }

    async executeRequest(method: string, path: string, data: any = null): Promise<ApiResponse> {
        const nodes = this.getNodes();
        if (nodes.length === 0) {
            throw new Error('No nodes configured');
        }

        // Try current leader first, then others
        const tryOrder = [
            ...nodes.slice(this.currentLeaderIndex),
            ...nodes.slice(0, this.currentLeaderIndex)
        ];

        let lastError: Error | null = null;

        for (const node of tryOrder) {
            try {
                const url = `${node}${path}`;
                const options: RequestInit = {
                    method: method,
                    headers: {
                        'Content-Type': 'application/json'
                    }
                };

                if (data) {
                    options.body = JSON.stringify(data);
                }

                const response = await fetch(url, options);
                
                if (response.status === 302) {
                    // Not leader, try next node
                    const responseData = await response.json();
                    if (responseData.leaderId) {
                        const leaderIndex = nodes.findIndex(n => 
                            n.includes(responseData.leaderId) || responseData.leaderId.includes(n)
                        );
                        if (leaderIndex !== -1) {
                            this.currentLeaderIndex = leaderIndex;
                        }
                    }
                    continue;
                }

                if (!response.ok) {
                    const error = await response.json();
                    throw new Error(error.error || 'Request failed');
                }

                // Success! Update leader index
                this.currentLeaderIndex = nodes.indexOf(node);
                return await response.json();

            } catch (error) {
                lastError = error as Error;
                continue;
            }
        }

        throw lastError || new Error('All nodes failed');
    }

    async ping(): Promise<ApiResponse> {
        return await this.executeRequest('GET', '/api/ping');
    }

    async get(key: string): Promise<ApiResponse> {
        return await this.executeRequest('GET', `/api/kv/${encodeURIComponent(key)}`);
    }

    async set(key: string, value: string): Promise<ApiResponse> {
        return await this.executeRequest('POST', `/api/kv/${encodeURIComponent(key)}`, { value });
    }

    async del(key: string): Promise<ApiResponse> {
        return await this.executeRequest('DELETE', `/api/kv/${encodeURIComponent(key)}`);
    }

    async append(key: string, value: string): Promise<ApiResponse> {
        return await this.executeRequest('PUT', `/api/kv/${encodeURIComponent(key)}/append`, { value });
    }

    async strlen(key: string): Promise<ApiResponse> {
        return await this.executeRequest('GET', `/api/kv/${encodeURIComponent(key)}/length`);
    }

    async status(): Promise<StatusResponse[]> {
        const nodes = this.getNodes();
        const statuses: StatusResponse[] = [];

        for (const node of nodes) {
            try {
                const response = await fetch(`${node}/api/raft/status`);
                const data = await response.json();
                statuses.push({
                    ...data,
                    nodeUrl: node
                });
            } catch (error) {
                statuses.push({
                    nodeUrl: node,
                    state: 'unreachable',
                    error: (error as Error).message
                });
            }
        }

        return statuses;
    }

    async requestLog(): Promise<ApiResponse> {
        return await this.executeRequest('GET', '/api/request_log');
    }

    async getSnapshotInfo(): Promise<ApiResponse> {
        return await this.executeRequest('GET', '/api/snapshot-info');
    }

    async triggerSnapshot(): Promise<ApiResponse> {
        return await this.executeRequest('POST', '/api/snapshot');
    }
}
