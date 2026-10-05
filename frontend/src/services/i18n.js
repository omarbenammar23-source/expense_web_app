export function getUiLanguage() {
  if (typeof document === 'undefined') {
    return 'en'
  }

  const lang = document.documentElement.lang || 'en'
  return ['en', 'fr', 'ar'].includes(lang) ? lang : 'en'
}

export function translate(copy) {
  const language = getUiLanguage()
  return copy?.[language] || copy?.en || ''
}
