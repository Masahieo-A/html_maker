"use client";
import { useCallback, useRef, useState } from "react";

// 履歴スタックによる undo/redo（要件 §5.3 / §8）。
// doc は単一の信頼できる状態。commit で過去を積み、undo/redo で行き来する。
export function useHistory<T>(initial: T) {
  const [present, setPresent] = useState<T>(initial);
  const past = useRef<T[]>([]);
  const future = useRef<T[]>([]);

  // present を ref でも保持して commit のクロージャ問題を回避
  const presentRef = useRef<T>(initial);
  presentRef.current = present;

  const commit = useCallback((next: T) => {
    // 変化のない commit（境界での移動など）は履歴に積まない
    if (next === presentRef.current) return;
    past.current.push(presentRef.current);
    if (past.current.length > 100) past.current.shift();
    future.current = [];
    presentRef.current = next;
    setPresent(next);
  }, []);

  const undo = useCallback(() => {
    if (past.current.length === 0) return;
    const prev = past.current.pop()!;
    future.current.unshift(presentRef.current);
    presentRef.current = prev;
    setPresent(prev);
  }, []);

  const redo = useCallback(() => {
    if (future.current.length === 0) return;
    const next = future.current.shift()!;
    past.current.push(presentRef.current);
    presentRef.current = next;
    setPresent(next);
  }, []);

  // 履歴を破棄して present を差し替える（教材の読み込み・復元の初期化用）
  const reset = useCallback((value: T) => {
    past.current = [];
    future.current = [];
    presentRef.current = value;
    setPresent(value);
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
