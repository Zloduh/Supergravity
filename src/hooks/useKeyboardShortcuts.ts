import { useEffect, useRef } from 'react';

export interface KeyboardShortcut {
  key: string;
  mod?: boolean;
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
  alt?: boolean;
  allowInInput?: boolean;
  enabled?: boolean;
  preventDefault?: boolean;
  handler: (event: KeyboardEvent) => void;
}

export interface UseKeyboardShortcutsOptions {
  enabled?: boolean;
  target?: Window | Document | HTMLElement | null;
}

function isEditableElement(target: EventTarget | null): boolean {
  if (!target || typeof target !== 'object') return false;
  const el = target as { tagName?: string; isContentEditable?: boolean };
  const tag = el.tagName?.toUpperCase();
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
    return true;
  }
  return Boolean(el.isContentEditable);
}

export function matchesShortcut(event: KeyboardEvent, shortcut: KeyboardShortcut): boolean {
  if (shortcut.enabled === false) return false;
  if (event.isComposing) return false;
  if (typeof event.key !== 'string') return false;

  const eventKey = event.key.toLowerCase();
  const targetKey = shortcut.key.toLowerCase();
  if (eventKey !== targetKey) return false;

  if (shortcut.mod) {
    if (!event.metaKey && !event.ctrlKey) return false;
  } else {
    if (shortcut.ctrl !== undefined && event.ctrlKey !== shortcut.ctrl) return false;
    if (shortcut.meta !== undefined && event.metaKey !== shortcut.meta) return false;
  }

  if (shortcut.shift !== undefined && event.shiftKey !== shortcut.shift) return false;
  if (shortcut.alt !== undefined && event.altKey !== shortcut.alt) return false;

  const hasModifier = Boolean(
    shortcut.mod || shortcut.ctrl || shortcut.meta || shortcut.alt
  );
  if (
    !hasModifier &&
    !shortcut.allowInInput &&
    targetKey !== 'escape' &&
    isEditableElement(event.target)
  ) {
    return false;
  }

  return true;
}

export function useKeyboardShortcuts(
  shortcuts: KeyboardShortcut[],
  options: UseKeyboardShortcutsOptions = {}
): void {
  const { enabled = true, target } = options;
  const shortcutsRef = useRef<KeyboardShortcut[]>(shortcuts);
  shortcutsRef.current = shortcuts;

  useEffect(() => {
    if (!enabled) return;
    const listenTarget: Window | Document | HTMLElement | null =
      target !== undefined ? target : typeof window !== 'undefined' ? window : null;
    if (!listenTarget || typeof listenTarget.addEventListener !== 'function') return;

    const onKeyDown = (event: Event) => {
      const kbEvent = event as KeyboardEvent;
      for (const shortcut of shortcutsRef.current) {
        if (matchesShortcut(kbEvent, shortcut)) {
          if (shortcut.preventDefault !== false) {
            kbEvent.preventDefault();
          }
          shortcut.handler(kbEvent);
          break;
        }
      }
    };

    listenTarget.addEventListener('keydown', onKeyDown);
    return () => {
      listenTarget.removeEventListener('keydown', onKeyDown);
    };
  }, [enabled, target]);
}
