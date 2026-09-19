/**
 * 轻量草稿暂存：基于 sessionStorage（标签页关闭自动清空）。
 * 用途：页面切换导致组件卸载时，保存"填了还没提交"的内容，回来自动恢复。
 */

export function loadDraft(key) {
  try {
    const raw = sessionStorage.getItem('draft:' + key)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function saveDraft(key, value) {
  try {
    if (value === null || value === undefined) {
      sessionStorage.removeItem('draft:' + key)
    } else {
      sessionStorage.setItem('draft:' + key, JSON.stringify(value))
    }
  } catch {
    /* 存储满或不可用时静默跳过，不影响主流程 */
  }
}
