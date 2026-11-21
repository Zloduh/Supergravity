export interface ReadFileRequest {
  path: string;
}

export interface ReadFileResponse {
  path: string;
  content: string;
  size: number;
  is_binary: boolean;
}

export interface WriteFileRequest {
  path: string;
  content: string;
  create_dirs?: boolean | null;
}

export interface EditFileRequest {
  path: string;
  old_text: string;
  new_text: string;
  replace_all?: boolean | null;
}

export interface ListDirRequest {
  path: string;
  recursive?: boolean | null;
  ignore_patterns?: string[] | null;
}

export interface DirEntry {
  name: string;
  path: string;
  is_dir: boolean;
  size?: number | null;
  modified?: string | null;
}

export type FileEntry = DirEntry;

export interface ListDirResponse {
  path: string;
  entries: DirEntry[];
}

export interface CreateDirRequest {
  path: string;
  recursive?: boolean | null;
}

export interface DeletePathRequest {
  path: string;
  recursive?: boolean | null;
}

export interface CopyPathRequest {
  source: string;
  destination: string;
}

export interface MovePathRequest {
  source: string;
  destination: string;
}

export interface SearchFilesRequest {
  path: string;
  pattern: string;
  ignore_patterns?: string[] | null;
  file_pattern?: string | null;
}

export interface SearchMatch {
  line_number: number;
  line: string;
  column: number;
}

export interface SearchResult {
  path: string;
  matches: SearchMatch[];
}

export interface ReadFileRangeRequest {
  path: string;
  start_line: number;
  end_line: number;
}

export interface ReadFileRangeResponse {
  path: string;
  lines: string[];
  start_line: number;
  end_line: number;
}
