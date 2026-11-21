import type { MCPTransportConfig } from './config';

export type MCPServerStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | { error: string };

export interface MCPTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  server_id: string;
}

export interface MCPServer {
  id: string;
  name: string;
  transport: MCPTransportConfig;
  enabled: boolean;
  auto_start: boolean;
  status: MCPServerStatus;
  tools: MCPTool[];
}

export interface MCPToolCallRequest {
  server_id: string;
  tool_name: string;
  arguments: Record<string, unknown>;
}

export interface MCPToolCallResponse {
  success: boolean;
  result?: unknown;
  error?: string | null;
}
