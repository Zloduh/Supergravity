import { useMemo, useState } from 'react';
import { RotateCcw, Columns, AlignJustify, FileCode, Check } from 'lucide-react';
import type { FileChangeEntry } from '../types/agent';
import * as fsIpc from '../ipc/fs';
import { isTauri } from '../utils/tauri';
import { cn } from '../utils/cn';

interface DiffLine {
  type: 'context' | 'add' | 'del';
  oldLineNo: number | null;
  newLineNo: number | null;
  text: string;
}

export function computeLineDiff(oldText: string, newText: string): DiffLine[] {
  const oldLines = oldText ? oldText.split('\n') : [];
  const newLines = newText ? newText.split('\n') : [];
  const result: DiffLine[] = [];

  let i = 0;
  let j = 0;
  while (i < oldLines.length || j < newLines.length) {
    if (i < oldLines.length && j < newLines.length && oldLines[i] === newLines[j]) {
      result.push({
        type: 'context',
        oldLineNo: i + 1,
        newLineNo: j + 1,
        text: oldLines[i],
      });
      i += 1;
      j += 1;
    } else {
      // Look ahead up to 4 lines for resync
      let foundOld = -1;
      let foundNew = -1;
      for (let look = 1; look <= 4; look += 1) {
        if (i + look < oldLines.length && oldLines[i + look] === newLines[j]) {
          foundOld = i + look;
          break;
        }
        if (j + look < newLines.length && oldLines[i] === newLines[j + look]) {
          foundNew = j + look;
          break;
        }
      }
      if (foundOld !== -1) {
        while (i < foundOld) {
          result.push({
            type: 'del',
            oldLineNo: i + 1,
            newLineNo: null,
            text: oldLines[i],
          });
          i += 1;
        }
      } else if (foundNew !== -1) {
        while (j < foundNew) {
          result.push({
            type: 'add',
            oldLineNo: null,
            newLineNo: j + 1,
            text: newLines[j],
          });
          j += 1;
        }
      } else {
        if (i < oldLines.length) {
          result.push({
            type: 'del',
            oldLineNo: i + 1,
            newLineNo: null,
            text: oldLines[i],
          });
          i += 1;
        }
        if (j < newLines.length) {
          result.push({
            type: 'add',
            oldLineNo: null,
            newLineNo: j + 1,
            text: newLines[j],
          });
          j += 1;
        }
      }
    }
  }
  return result;
}

interface DiffViewerProps {
  change: FileChangeEntry;
  onReverted?: (path: string) => void;
}

export function DiffViewer({ change, onReverted }: DiffViewerProps) {
  const [mode, setMode] = useState<'unified' | 'split'>('unified');
  const [reverted, setReverted] = useState(false);

  const lines = useMemo(
    () => computeLineDiff(change.original_content || '', change.new_content || ''),
    [change.original_content, change.new_content]
  );

  const stats = useMemo(() => {
    let added = 0;
    let removed = 0;
    for (const l of lines) {
      if (l.type === 'add') added += 1;
      if (l.type === 'del') removed += 1;
    }
    return { added, removed };
  }, [lines]);

  const handleRevert = async () => {
    if (isTauri()) {
      try {
        if (change.original_content !== undefined && change.original_content !== null) {
          await fsIpc.writeFile({
            path: change.path,
            content: change.original_content,
            create_dirs: true,
          });
        } else {
          await fsIpc.deletePath({ path: change.path, recursive: false });
        }
      } catch {
        // ignore revert error in mock environments
      }
    }
    setReverted(true);
    onReverted?.(change.path);
  };

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-950/90 overflow-hidden text-xs">
      <div className="flex items-center justify-between px-3 py-2 bg-gray-900/90 border-b border-gray-800 gap-2 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <FileCode className="w-3.5 h-3.5 text-blue-400 flex-shrink-0" />
          <span className="font-mono text-gray-200 truncate" title={change.path}>
            {change.path.split('/').pop() || change.path}
          </span>
          <span className="px-1.5 py-0.5 text-[10px] rounded bg-emerald-950 text-emerald-300 border border-emerald-800/50 font-mono">
            +{stats.added}
          </span>
          <span className="px-1.5 py-0.5 text-[10px] rounded bg-red-950 text-red-300 border border-red-800/50 font-mono">
            -{stats.removed}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setMode(mode === 'unified' ? 'split' : 'unified')}
            className="flex items-center gap-1 px-2 py-1 rounded bg-gray-800 hover:bg-gray-700 text-gray-300 text-[11px]"
            title="Toggle Unified / Split Diff"
          >
            {mode === 'unified' ? (
              <>
                <Columns className="w-3 h-3" />
                <span>Split</span>
              </>
            ) : (
              <>
                <AlignJustify className="w-3 h-3" />
                <span>Unified</span>
              </>
            )}
          </button>
          <button
            type="button"
            onClick={handleRevert}
            disabled={reverted}
            className={cn(
              'flex items-center gap-1 px-2 py-1 rounded text-[11px] transition-colors',
              reverted
                ? 'bg-emerald-950/60 text-emerald-300 border border-emerald-800/50'
                : 'bg-gray-800 hover:bg-red-950/70 text-gray-300 hover:text-red-200'
            )}
            title="Revert file to original snapshot"
          >
            {reverted ? <Check className="w-3 h-3" /> : <RotateCcw className="w-3 h-3" />}
            <span>{reverted ? 'Reverted' : 'Revert'}</span>
          </button>
        </div>
      </div>

      {mode === 'unified' ? (
        <div className="max-h-80 overflow-auto font-mono text-[11px] leading-5 select-text">
          {lines.map((line, idx) => (
            <div
              key={idx}
              className={cn(
                'flex px-2',
                line.type === 'add'
                  ? 'bg-emerald-950/45 text-emerald-200'
                  : line.type === 'del'
                    ? 'bg-red-950/45 text-red-200'
                    : 'text-gray-400'
              )}
            >
              <span className="w-8 text-right pr-2 text-gray-600 select-none">
                {line.oldLineNo ?? ''}
              </span>
              <span className="w-8 text-right pr-2 text-gray-600 select-none">
                {line.newLineNo ?? ''}
              </span>
              <span className="w-4 select-none font-bold">
                {line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' '}
              </span>
              <span className="whitespace-pre-wrap break-all flex-1">{line.text}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 divide-x divide-gray-800 max-h-80 overflow-auto font-mono text-[11px] leading-5 select-text">
          <div className="p-2 space-y-0.5">
            <div className="text-[10px] uppercase text-gray-500 pb-1 border-b border-gray-800">
              Original
            </div>
            {(change.original_content || '').split('\n').map((l, i) => (
              <div key={i} className="flex text-gray-400">
                <span className="w-7 text-right pr-2 text-gray-600 select-none">{i + 1}</span>
                <span className="whitespace-pre-wrap break-all flex-1">{l}</span>
              </div>
            ))}
          </div>
          <div className="p-2 space-y-0.5">
            <div className="text-[10px] uppercase text-emerald-400 pb-1 border-b border-gray-800">
              Modified
            </div>
            {(change.new_content || '').split('\n').map((l, i) => (
              <div key={i} className="flex text-emerald-100">
                <span className="w-7 text-right pr-2 text-gray-600 select-none">{i + 1}</span>
                <span className="whitespace-pre-wrap break-all flex-1">{l}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
