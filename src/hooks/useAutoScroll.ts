import { useCallback, useEffect, useRef, useState } from 'react';
import type { DependencyList, RefObject } from 'react';

export interface UseAutoScrollOptions {
  threshold?: number;
  behavior?: ScrollBehavior;
  enabled?: boolean;
}

export interface UseAutoScrollResult {
  containerRef: RefObject<HTMLDivElement>;
  bottomRef: RefObject<HTMLDivElement>;
  isAtBottom: boolean;
  showScrollButton: boolean;
  scrollToBottom: (behavior?: ScrollBehavior) => void;
  handleScroll: () => void;
}

export function isNearBottom(
  metrics: { scrollHeight: number; scrollTop: number; clientHeight: number },
  threshold = 64
): boolean {
  const distanceFromBottom =
    metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight;
  return distanceFromBottom <= threshold;
}

export function useAutoScroll(
  deps: DependencyList,
  options: UseAutoScrollOptions = {}
): UseAutoScrollResult {
  const { threshold = 64, behavior = 'smooth', enabled = true } = options;
  const containerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const shouldAutoScrollRef = useRef<boolean>(true);
  const [isAtBottom, setIsAtBottom] = useState<boolean>(true);

  const scrollToBottom = useCallback(
    (overrideBehavior?: ScrollBehavior) => {
      shouldAutoScrollRef.current = true;
      setIsAtBottom(true);
      const scrollBehavior = overrideBehavior ?? behavior;
      const container = containerRef.current;
      if (container && typeof container.scrollTo === 'function') {
        container.scrollTo({
          top: container.scrollHeight,
          behavior: scrollBehavior,
        });
        return;
      }
      const bottom = bottomRef.current;
      if (bottom && typeof bottom.scrollIntoView === 'function') {
        bottom.scrollIntoView({ behavior: scrollBehavior });
      }
    },
    [behavior]
  );

  const handleScroll = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const near = isNearBottom(container, threshold);
    shouldAutoScrollRef.current = near;
    setIsAtBottom(near);
  }, [threshold]);

  useEffect(() => {
    if (!enabled || !shouldAutoScrollRef.current) return;
    const container = containerRef.current;
    if (container && typeof container.scrollTo === 'function') {
      container.scrollTo({
        top: container.scrollHeight,
        behavior,
      });
      return;
    }
    const bottom = bottomRef.current;
    if (bottom && typeof bottom.scrollIntoView === 'function') {
      bottom.scrollIntoView({ behavior });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, behavior, ...deps]);

  return {
    containerRef,
    bottomRef,
    isAtBottom,
    showScrollButton: !isAtBottom,
    scrollToBottom,
    handleScroll,
  };
}
