const BASE = 'http://localhost:8001/api'

async function request(url, options = {}) {
  const res = await fetch(`${BASE}${url}`, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail || 'Request failed')
  }
  return res.json()
}

export const accountsApi = {
  list: () => request('/accounts'),
  create: (name) => request('/accounts?name=' + encodeURIComponent(name), { method: 'POST' }),
  delete: (id) => request('/accounts/' + id, { method: 'DELETE' }),
  qrcode: (id) => request('/accounts/' + id + '/qrcode'),
  qrcodeStatus: (id) => request('/accounts/' + id + '/qrcode/status'),
  bind: (id) => request('/accounts/' + id + '/bind', { method: 'POST' }),
  checkAll: () => request('/accounts/check-all', { method: 'POST' }),
}

export const mediaApi = {
  list: () => request('/media'),
  delete: (id) => request('/media/' + id, { method: 'DELETE' }),
  generate: (prompt) => request('/media/generate', { method: 'POST', body: JSON.stringify({ prompt }) }),
}

export const publishApi = {
  create: (data) => request('/publish', { method: 'POST', body: JSON.stringify(data) }),
  tasks: () => request('/publish/tasks'),
}
