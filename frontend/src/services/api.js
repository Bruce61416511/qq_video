const BASE = 'http://localhost:8000/api'

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
  validate: (id) => request('/accounts/' + id + '/validate', { method: 'POST' }),
}

export const mediaApi = {
  list: () => request('/media'),
  delete: (id) => request('/media/' + id, { method: 'DELETE' }),
  generateShots: (topic, shotCount, shotDuration) => request('/media/generate-shots', {
    method: 'POST',
    body: JSON.stringify({ topic, shot_count: shotCount, shot_duration: shotDuration }),
  }),
  getShots: (mediaId) => request('/media/' + mediaId + '/shots'),
  generate: (prompt, size, resolution, shots) => request('/media/generate', {
    method: 'POST',
    body: JSON.stringify({ prompt, size, resolution, shots }),
  }),
  upload: async (file) => {
    const formData = new FormData()
    formData.append('file', file)
    const res = await fetch(`${BASE}/media/upload`, { method: 'POST', body: formData })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }))
      throw new Error(err.detail || 'Upload failed')
    }
    return res.json()
  },
}

export const publishApi = {
  create: (data) => request('/publish', { method: 'POST', body: JSON.stringify(data) }),
  tasks: () => request('/publish/tasks'),
  clearAll: () => request('/publish/tasks', { method: 'DELETE' }),
  cancel: (id) => request('/publish/tasks/' + id + '/cancel', { method: 'POST' }),
}

export const settingsApi = {
  list: () => request('/settings'),
  get: (key) => request('/settings/' + key),
  set: (key, value) => request('/settings/' + key, { method: 'PUT', body: JSON.stringify({ value }) }),
}

export const trendsApi = {
  getReport: () => `${BASE}/trends/report`,
  getMethod: () => request('/trends/config/method'),
  setMethod: (method) => request('/trends/config/method', { method: 'PUT', body: JSON.stringify({ method }) }),
  getTopicReport: () => `${BASE}/trends/topic-to-video/report`,
  getTopicData: () => request('/trends/topic-to-video/data'),
  generateTopics: () => request('/trends/topic-to-video/generate', { method: 'POST' }),
  topicStatus: () => request('/trends/topic-to-video/status'),
  listConfigFiles: () => request('/trends/config/files'),
  getConfigFile: (key) => request('/trends/config/files/' + key),
  saveConfigFile: (key, content) => request('/trends/config/files/' + key, { method: 'PUT', body: JSON.stringify({ content }) }),
  getReport: () => `${BASE}/trends/report`,
  getMethod: () => request('/trends/config/method'),
  setMethod: (method) => request('/trends/config/method', { method: 'PUT', body: JSON.stringify({ method }) }),
  getTopicReport: () => `${BASE}/trends/topic-to-video/report`,
  generateTopics: () => request('/trends/topic-to-video/generate', { method: 'POST' }),
  topicStatus: () => request('/trends/topic-to-video/status'),
  listConfigFiles: () => request('/trends/config/files'),
  getConfigFile: (key) => request('/trends/config/files/' + key),
  saveConfigFile: (key, content) => request('/trends/config/files/' + key, { method: 'PUT', body: JSON.stringify({ content }) }),
  getReport: () => `${BASE}/trends/report`,
  getMethod: () => request('/trends/config/method'),
  setMethod: (method) => request('/trends/config/method', { method: 'PUT', body: JSON.stringify({ method }) }),
  getTopicReport: () => `${BASE}/trends/topic-to-video/report`,
  generateTopics: () => request('/trends/topic-to-video/generate', { method: 'POST' }),
  topicStatus: () => request('/trends/topic-to-video/status'),
  getReport: () => `${BASE}/trends/report`,
  getMethod: () => request('/trends/config/method'),
  setMethod: (method) => request('/trends/config/method', { method: 'PUT', body: JSON.stringify({ method }) }),
  list: (status, limit, offset) => {
    const params = new URLSearchParams()
    if (status) params.append('status', status)
    if (limit) params.append('limit', limit)
    if (offset) params.append('offset', offset)
    return request('/trends?' + params.toString())
  },
  refresh: () => request('/trends/refresh', { method: 'POST' }),
  crawl: () => request('/trends/crawl', { method: 'POST' }),
  crawlStatus: () => request('/trends/crawl/status'),
  aiAnalysis: () => request('/trends/ai-analysis'),
  updateStatus: (id, status) => request('/trends/' + id + '/status', { method: 'PUT', body: JSON.stringify({ status }) }),
  getFrequency: () => request('/trends/config/frequency'),
  setFrequency: (content) => request('/trends/config/frequency', { method: 'PUT', body: JSON.stringify({ content }) }),
  getInterests: () => request('/trends/config/interests'),
  setInterests: (content) => request('/trends/config/interests', { method: 'PUT', body: JSON.stringify({ content }) }),
  getGroups: () => request('/trends/config/groups'),
  setGroups: (groups) => request('/trends/config/groups', { method: 'PUT', body: JSON.stringify(groups) }),
  getAiConfig: () => request('/trends/config/ai'),
  setAiConfig: (config) => request('/trends/config/ai', { method: 'PUT', body: JSON.stringify(config) }),
}