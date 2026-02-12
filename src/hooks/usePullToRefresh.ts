import { useState, useRef, useCallback, type TouchEvent as ReactTouchEvent } from "react";

const PULL_THRESHOLD = 60;

interface UsePullToRefreshOptions {
  onRefresh: () => Promise<void>;
}

export function usePullToRefresh({ onRefresh }: UsePullToRefreshOptions) {
  const [pullDistance, setPullDistance] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const touchStartY = useRef(0);
  const isPulling = useRef(false);

  const onTouchStart = useCallback(
    (e: ReactTouchEvent) => {
      if (window.scrollY === 0 && !isRefreshing) {
        touchStartY.current = e.touches[0].clientY;
        isPulling.current = true;
      }
    },
    [isRefreshing]
  );

  const onTouchMove = useCallback((e: ReactTouchEvent) => {
    if (!isPulling.current) return;
    const delta = e.touches[0].clientY - touchStartY.current;
    if (delta > 0) {
      setPullDistance(Math.min(delta * 0.4, 100));
    } else {
      isPulling.current = false;
      setPullDistance(0);
    }
  }, []);

  const onTouchEnd = useCallback(async () => {
    if (!isPulling.current) return;
    isPulling.current = false;
    if (pullDistance >= PULL_THRESHOLD) {
      setIsRefreshing(true);
      setPullDistance(PULL_THRESHOLD);
      try {
        await onRefresh();
      } finally {
        setIsRefreshing(false);
        setPullDistance(0);
      }
    } else {
      setPullDistance(0);
    }
  }, [pullDistance, onRefresh]);

  return {
    pullDistance,
    isRefreshing,
    PULL_THRESHOLD,
    onTouchStart,
    onTouchMove,
    onTouchEnd,
  };
}
