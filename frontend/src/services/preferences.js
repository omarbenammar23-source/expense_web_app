const PREFERENCES_KEY = 'ui_preferences'

const defaultPreferences = {
  theme: 'light',
  language: 'en',
  density: 'comfortable',
  reducedMotion: false,
}

export function getDefaultPreferences() {
  return { ...defaultPreferences }
}

export function loadPreferences() {
  const rawValue = localStorage.getItem(PREFERENCES_KEY)

  if (!rawValue) {
    return getDefaultPreferences()
  }

  try {
    return {
      ...defaultPreferences,
      ...JSON.parse(rawValue),
    }
  } catch {
    return getDefaultPreferences()
  }
}

export function savePreferences(preferences) {
  localStorage.setItem(PREFERENCES_KEY, JSON.stringify(preferences))
}

export function applyPreferences(preferences) {
  const safePreferences = {
    ...defaultPreferences,
    ...preferences,
  }

  const root = document.documentElement
  root.dataset.theme = safePreferences.theme
  root.dataset.density = safePreferences.density
  root.dataset.motion = safePreferences.reducedMotion ? 'reduced' : 'full'
  root.lang = safePreferences.language
  root.dir = safePreferences.language === 'ar' ? 'rtl' : 'ltr'
}
