const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

function getTokens() {
  if (typeof window === 'undefined') return { access: null, refresh: null }
  return {
    access: localStorage.getItem('access_token'),
    refresh: localStorage.getItem('refresh_token'),
  }
}

function setTokens(access: string, refresh: string) {
  localStorage.setItem('access_token', access)
  localStorage.setItem('refresh_token', refresh)
}

export function clearTokens() {
  localStorage.removeItem('access_token')
  localStorage.removeItem('refresh_token')
}

async function refreshAccessToken(): Promise<string | null> {
  const { refresh } = getTokens()
  if (!refresh) return null
  try {
    const res = await fetch(`${BASE}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: refresh }),
    })
    if (!res.ok) return null
    const json = await res.json() as { data: { accessToken: string; refreshToken: string } }
    setTokens(json.data.accessToken, json.data.refreshToken)
    return json.data.accessToken
  } catch {
    return null
  }
}

export async function apiFetch<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  let { access } = getTokens()

  const makeRequest = async (token: string | null) => {
    const headers: Record<string, string> = {
      ...(options.headers as Record<string, string>),
    }
    if (!(options.body instanceof FormData)) {
      headers['Content-Type'] = 'application/json'
    }
    if (token) headers['Authorization'] = `Bearer ${token}`

    return fetch(`${BASE}${path}`, { ...options, headers })
  }

  let res = await makeRequest(access)

  if (res.status === 401 && access) {
    access = await refreshAccessToken()
    if (access) {
      res = await makeRequest(access)
    }
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText })) as { error: string }
    throw new Error(err.error ?? `HTTP ${res.status}`)
  }

  return res.json() as Promise<T>
}

export async function login(email: string, password: string) {
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  if (!res.ok) {
    const err = await res.json() as { error: string }
    throw new Error(err.error)
  }
  const json = await res.json() as { data: { accessToken: string; refreshToken: string; user: { id: string; email: string; name: string } } }
  setTokens(json.data.accessToken, json.data.refreshToken)
  return json.data
}

export async function register(email: string, password: string, name: string) {
  const res = await fetch(`${BASE}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, name }),
  })
  if (!res.ok) {
    const err = await res.json() as { error: string }
    throw new Error(err.error)
  }
  const json = await res.json() as { data: { accessToken: string; refreshToken: string; user: { id: string; email: string; name: string } } }
  setTokens(json.data.accessToken, json.data.refreshToken)
  return json.data
}

export async function logout() {
  const { refresh } = getTokens()
  clearTokens()
  if (refresh) {
    await fetch(`${BASE}/auth/logout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: refresh }),
    }).catch(() => {})
  }
}
