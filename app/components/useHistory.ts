"use client";
import { useCallback, useRef, useState } from "react";

// 履歴スタックによる undo/redo（要件 §5.3 / §8）。
// doc は単一の信頼できる状態。commit で過去を積み、undo/redo で行き来する。
export function useHistory<T>(initial: T) {
  const [present, setPresent] = useState<T>(initial);
  const past = useRef<T[]>([]);
  const future = useRef<T[]>([]);
  const [, force] = useState(0);
  const rerender = () => force((n) => n + 1);

  const commit = useCallback((next: T) => {
    past.current.push(presentRef.current);
    if (past.current.length > 100) past.current.shift();
    future.current = [];
    presentRef.current = next;
    setPresent(next);
    rerender();
  }, []);

  // present を ref でも保持して commit のクロージャ問題を回避
  const presentRef = useRef<T>(initial);
  presentRef.current = present;

  const undo = useCallback(() => {
    if (past.current.length === 0) return;
    const prev = past.current.pop()!;
    future.current.unshift(presentRef.current);
    presentRef.current = prev;
    setPresent(prev);
    rerender();
  }, []);

  const redo = useCallback(() => {
    if (future.current.length === 0) return;
    const next = future.current.shift()!;
    past.current.push(presentRef.current);
    presentRef.current = next;
    setPresent(next);
    rerender();
  }, []);

  // 履歴を消さずに present を差し替える（読み込み・保存の初期化用）
  const reset = useCallback((value: T) => {
    past.current = [];
    future.current = [];
    presentRef.current = value;
    setPresent(value);
    rerender();
  }, []);

  return {
    present,
    commit,
    undo,
    redo,
    reset,
    canUndo: past.current.length > 0,
    canRedo: future.current.length > 0,
  };
}
