import { safeInvoke, safeListen, type UnlistenFn } from '../utils/tauri';
import type {
  CopyPathRequest,
  CreateDirRequest,
  DeletePathRequest,
  EditFileRequest,
  FsChangeEvent,
  ListDirRequest,
  ListDirResponse,
  MovePathRequest,
  ReadFileRangeRequest,
  ReadFileRangeResponse,
  ReadFileRequest,
  ReadFileResponse,
  SearchFilesRequest,
  SearchResult,
  WriteFileRequest,
} from '../types';

export function readFile(request: ReadFileRequest): Promise<ReadFileResponse> {
  return safeInvoke<ReadFileResponse>('read_file', { request });
}

export function writeFile(request: WriteFileRequest): Promise<void> {
  return safeInvoke<void>('write_file', { request });
}

export function editFile(request: EditFileRequest): Promise<void> {
  return safeInvoke<void>('edit_file', { request });
}

export function listDir(request: ListDirRequest): Promise<ListDirResponse> {
  return safeInvoke<ListDirResponse>('list_dir', { request });
}

export function createDir(request: CreateDirRequest): Promise<void> {
  return safeInvoke<void>('create_dir', { request });
}

export function deletePath(request: DeletePathRequest): Promise<void> {
  return safeInvoke<void>('delete_path', { request });
}

export function copyPath(request: CopyPathRequest): Promise<void> {
  return safeInvoke<void>('copy_path', { request });
}

export function movePath(request: MovePathRequest): Promise<void> {
  return safeInvoke<void>('move_path', { request });
}

export function searchFiles(request: SearchFilesRequest): Promise<SearchResult[]> {
  return safeInvoke<SearchResult[]>('search_files', { request });
}

export function readFileRange(request: ReadFileRangeRequest): Promise<ReadFileRangeResponse> {
  return safeInvoke<ReadFileRangeResponse>('read_file_range', { request });
}

export function watchPath(path: string): Promise<void> {
  return safeInvoke<void>('watch_path', { path });
}

export function unwatchPath(path: string): Promise<void> {
  return safeInvoke<void>('unwatch_path', { path });
}

export function onFsChange(handler: (payload: FsChangeEvent) => void): Promise<UnlistenFn> {
  return safeListen<FsChangeEvent>('fs-change', handler);
}
