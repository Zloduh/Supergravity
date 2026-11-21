import { safeInvoke } from '../utils/tauri';
import type {
  MCPServer,
  MCPServerConfig,
  MCPTool,
  MCPToolCallRequest,
  MCPToolCallResponse,
} from '../types';

export function listServers(): Promise<MCPServer[]> {
  return safeInvoke<MCPServer[]>('list_servers');
}

export function addServer(config: MCPServerConfig): Promise<MCPServer> {
  return safeInvoke<MCPServer>('add_server', { config });
}

export function removeServer(id: string): Promise<void> {
  return safeInvoke<void>('remove_server', { id });
}

export function connectServer(id: string): Promise<MCPServer> {
  return safeInvoke<MCPServer>('connect_server', { id });
}

export function disconnectServer(id: string): Promise<MCPServer> {
  return safeInvoke<MCPServer>('disconnect_server', { id });
}

export function listTools(serverId?: string | null): Promise<MCPTool[]> {
  return safeInvoke<MCPTool[]>('list_tools', {
    server_id: serverId ?? null,
  });
}

export function callTool(request: MCPToolCallRequest): Promise<MCPToolCallResponse> {
  return safeInvoke<MCPToolCallResponse>('call_tool', { request });
}
