// 一意な ID 生成（ノード単位の選択・部分編集・undo の対象単位）
export function uid(prefix = "n"): string {
  const rand = Math.random().toString(36).slice(2, 8);
  const time = Date.now().toString(36).slice(-4);
  return `${prefix}_${time}${rand}`;
}
