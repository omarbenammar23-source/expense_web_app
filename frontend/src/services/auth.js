const TOKEN_KEY = 'token'
const USER_KEY = 'user'
const ACTIVE_GROUP_KEY = 'active_group'

export function saveAuth(token, user = null) {
  localStorage.setItem(TOKEN_KEY, token)
  localStorage.removeItem(ACTIVE_GROUP_KEY)

  if (user) {
    localStorage.setItem(USER_KEY, JSON.stringify(user))
  }
}

export function saveActiveGroup(group) {
  if (!group) {
    localStorage.removeItem(ACTIVE_GROUP_KEY)
    return
  }

  localStorage.setItem(ACTIVE_GROUP_KEY, JSON.stringify(group))
}

export function clearActiveGroup() {
  localStorage.removeItem(ACTIVE_GROUP_KEY)
}

export function clearAuth() {
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(USER_KEY)
  localStorage.removeItem(ACTIVE_GROUP_KEY)
}

export function getToken() {
  return localStorage.getItem(TOKEN_KEY)
}

export function getUser() {
  const rawValue = localStorage.getItem(USER_KEY)

  if (!rawValue) {
    return null
  }

  try {
    return JSON.parse(rawValue)
  } catch {
    return null
  }
}

export function getActiveGroup() {
  const rawValue = localStorage.getItem(ACTIVE_GROUP_KEY)

  if (!rawValue) {
    return null
  }

  try {
    return JSON.parse(rawValue)
  } catch {
    return null
  }
}

export function getRole() {
  return getActiveGroup()?.role || null
}

export function getHomePath() {
  const token = getToken()
  if (!token) {
    return '/login'
  }

  const role = getRole()
  if (!role) {
    return '/groups'
  }

  return role === 'owner' || role === 'responsable' || role === 'supervisor' ? '/supervisor' : '/dashboard'
}
