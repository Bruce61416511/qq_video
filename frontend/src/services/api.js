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
  generateShotsFromTopic: (topicData) => request('/media/generate-shots-from-topic', { method: 'POST', body: JSON.stringify(topicData) }),
  generateShots: (topic, shotCount, shotDuration, competitorFramework) => request('/media/generate-shots', {
    method: 'POST',
    body: JSON.stringify({ topic, shot_count: shotCount, shot_duration: shotDuration, competitor_framework: competitorFramework || '' }),
  }),
  getShots: (mediaId) => request('/media/' + mediaId + '/shots'),
  generate: (prompt, size, resolution, shots) => request('/media/generate', {
    method: 'POST',
    body: JSON.stringify({ prompt, size, resolution, shots }),
  }),
  saveShots: (data) => request('/media/save-shots', { method: 'POST', body: JSON.stringify(data) }),
  generateShot: (mediaId, shotIndex) => request('/media/' + mediaId + '/shots/' + shotIndex + '/generate', { method: 'POST' }),
  regenerateShotVideo: (mediaId, data) => request('/media/' + mediaId + '/regenerate-shot-video', { method: 'POST', body: JSON.stringify(data) }),
  regenerateShotAudio: (mediaId, data) => request('/media/' + mediaId + '/regenerate-shot-audio', { method: 'POST', body: JSON.stringify(data) }),
  compose: (mediaId) => request('/media/' + mediaId + '/compose', { method: 'POST' }),
  // Script-First 流水线
  scriptCreateOutline: (text, competitorFramework) => request('/media/script-create-outline', {
    method: 'POST',
    body: JSON.stringify({ text, competitor_framework: competitorFramework || '' }),
  }),
  scriptNarration: (outline, competitorFramework, totalDuration, hook) => request('/media/script-narration', {
    method: 'POST',
    body: JSON.stringify({ outline, competitor_framework: competitorFramework || '', total_duration: totalDuration || 60, hook: hook || '' }),
  }),
  scriptTts: (narrations, voice) => request('/media/script-tts', {
    method: 'POST',
    body: JSON.stringify({ narrations, voice }),
  }),
  scriptScenes: (outline, narrations, durations, competitorFramework) => request('/media/script-scenes', {
    method: 'POST',
    body: JSON.stringify({ outline, narrations, durations, competitor_framework: competitorFramework || '' }),
  }),
  scriptGenerate: (data) => request('/media/script-generate', {
    method: 'POST',
    body: JSON.stringify(data),
  }),
  scriptRegenerate: (text, voice, index) => request('/media/script-regenerate', {
    method: 'POST',
    body: JSON.stringify({ text, voice, index }),
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

export const imageApi = {
  generate: (prompt, size = '9:16', count = 1) => request('/image/generate', {
    method: 'POST',
    body: JSON.stringify({ prompt, size, count }),
  }),
  toVideo: (prompt, imageUrl, duration = '5', size = '9:16', resolution = '1080P') => request('/image/to-video', {
    method: 'POST',
    body: JSON.stringify({ prompt, image_url: imageUrl, duration, size, resolution }),
  }),
  polishPrompt: (prompt, mode = 'image') => request('/image/polish-prompt', {
    method: 'POST',
    body: JSON.stringify({ prompt, mode }),
  }),
  getPolishConfig: (mode) => request('/image/polish-prompt-config/' + mode),
  savePolishConfig: (mode, prompt) => request('/image/polish-prompt-config/' + mode, {
    method: 'PUT',
    body: JSON.stringify({ prompt }),
  }),
}

export const avatarApi = {
  list: () => request('/avatars'),
  create: (name, prompt, imageUrl) => request('/avatars', {
    method: 'POST',
    body: JSON.stringify({ name, prompt, image_url: imageUrl }),
  }),
  upload: async (file, name, prompt = '') => {
    const formData = new FormData()
    formData.append('file', file)
    formData.append('name', name)
    formData.append('prompt', prompt)
    const res = await fetch(`${BASE}/avatars/upload`, { method: 'POST', body: formData })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }))
      throw new Error(err.detail || 'Upload failed')
    }
    return res.json()
  },
  update: (id, data) => request('/avatars/' + id, { method: 'PUT', body: JSON.stringify(data) }),
  delete: (id) => request('/avatars/' + id, { method: 'DELETE' }),
}

export const factoryApi = {
  list: () => request('/factory/tasks'),
  get: (id) => request('/factory/tasks/' + id),
  create: (data) => request('/factory/tasks', { method: 'POST', body: JSON.stringify(data) }),
  delete: (id) => request('/factory/tasks/' + id, { method: 'DELETE' }),
  generate: (id) => request('/factory/tasks/' + id + '/generate', { method: 'POST' }),
  regenerateShot: (id, shotIndex) => request('/factory/tasks/' + id + '/shots/' + shotIndex + '/generate', { method: 'POST' }),
  compose: (id) => request('/factory/tasks/' + id + '/compose', { method: 'POST' }),
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
  refresh: () => request("/trends/refresh", { method: "POST" }),
  refreshWechat: () => request("/trends/wechat/refresh", { method: "POST" }),
  refreshRmwHealth: () => request("/trends/rmw-health/refresh", { method: "POST" }),
  refreshCifst: () => request("/trends/cifst/refresh", { method: "POST" }),
  refreshCfsn: () => request("/trends/cfsn/refresh", { method: "POST" }),
  refreshKepu: () => request("/trends/kepu/refresh", { method: "POST" }),
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