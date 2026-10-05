import { useEffect, useMemo, useState } from 'react'

const copyByLanguage = {
  en: {
    settings: 'Settings',
    open: 'Settings',
    close: 'Close',
    subtitle: 'Personalize the app and keep your setup saved on this device.',
    appearance: 'Appearance',
    nightMode: 'Night mode',
    language: 'Language',
    layout: 'Layout',
    density: 'Density',
    reset: 'Reset',
    comfortable: 'Comfortable',
    compact: 'Compact',
    english: 'English',
    french: 'French',
    arabic: 'Arabic',
  },
  fr: {
    settings: 'Parametres',
    open: 'Parametres',
    close: 'Fermer',
    subtitle: 'Personnalisez l application et gardez vos reglages sur cet appareil.',
    appearance: 'Apparence',
    nightMode: 'Mode nuit',
    language: 'Langue',
    layout: 'Disposition',
    density: 'Densite',
    reset: 'Reinitialiser',
    comfortable: 'Confortable',
    compact: 'Compact',
    english: 'Anglais',
    french: 'Francais',
    arabic: 'Arabe',
  },
  ar: {
    settings: 'الإعدادات',
    open: 'الإعدادات',
    close: 'إغلاق',
    subtitle: 'خصص التطبيق واحتفظ بإعداداتك محفوظة على هذا الجهاز.',
    appearance: 'المظهر',
    nightMode: 'الوضع الليلي',
    language: 'اللغة',
    layout: 'التخطيط',
    density: 'الكثافة',
    reset: 'إعادة ضبط',
    comfortable: 'مريح',
    compact: 'مضغوط',
    english: 'الإنجليزية',
    french: 'الفرنسية',
    arabic: 'العربية',
  },
}

function SettingsPanel({ preferences, onChange, onReset }) {
  const [isOpen, setIsOpen] = useState(false)
  const copy = useMemo(
    () => copyByLanguage[preferences.language] || copyByLanguage.en,
    [preferences.language],
  )

  useEffect(() => {
    if (!isOpen) {
      return undefined
    }

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setIsOpen(false)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen])

  const updatePreference = (key, value) => {
    onChange((current) => ({
      ...current,
      [key]: value,
    }))
  }

  return (
    <>
      <button
        type="button"
        className="settings-trigger"
        onClick={() => setIsOpen(true)}
        aria-label={copy.open}
      >
        <span className="settings-trigger-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" role="presentation" focusable="false">
            <path
              d="M12 8.75A3.25 3.25 0 1 0 12 15.25A3.25 3.25 0 1 0 12 8.75Z"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M19.1 15.13L20.22 17.07L18.07 19.22L16.13 18.1C15.55 18.42 14.93 18.68 14.28 18.85L13.75 21H10.25L9.72 18.85C9.07 18.68 8.45 18.42 7.87 18.1L5.93 19.22L3.78 17.07L4.9 15.13C4.58 14.55 4.32 13.93 4.15 13.28L2 12.75V11.25L4.15 10.72C4.32 10.07 4.58 9.45 4.9 8.87L3.78 6.93L5.93 4.78L7.87 5.9C8.45 5.58 9.07 5.32 9.72 5.15L10.25 3H13.75L14.28 5.15C14.93 5.32 15.55 5.58 16.13 5.9L18.07 4.78L20.22 6.93L19.1 8.87C19.42 9.45 19.68 10.07 19.85 10.72L22 11.25V12.75L19.85 13.28C19.68 13.93 19.42 14.55 19.1 15.13Z"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
        <span>{copy.settings}</span>
      </button>

      {isOpen ? <button type="button" className="settings-backdrop" onClick={() => setIsOpen(false)} /> : null}

      <aside className={`settings-panel ${isOpen ? 'settings-panel-open' : ''}`} aria-hidden={!isOpen}>
        <div className="settings-panel-header">
          <div>
            <h2>{copy.settings}</h2>
            <p className="subtitle">{copy.subtitle}</p>
          </div>
          <button type="button" className="secondary-button" onClick={() => setIsOpen(false)}>
            {copy.close}
          </button>
        </div>

        <div className="settings-section">
          <span className="settings-section-title">{copy.appearance}</span>
          <label className="settings-toggle">
            <span>{copy.nightMode}</span>
            <input
              type="checkbox"
              checked={preferences.theme === 'dark'}
              onChange={(event) => updatePreference('theme', event.target.checked ? 'dark' : 'light')}
            />
          </label>
        </div>

        <div className="settings-section">
          <span className="settings-section-title">{copy.language}</span>
          <select
            value={preferences.language}
            onChange={(event) => updatePreference('language', event.target.value)}
            className="settings-select"
          >
            <option value="en">{copy.english}</option>
            <option value="fr">{copy.french}</option>
            <option value="ar">{copy.arabic}</option>
          </select>
        </div>

        <div className="settings-section">
          <span className="settings-section-title">{copy.layout}</span>
          <div className="settings-pill-row">
            <button
              type="button"
              className={preferences.density === 'comfortable' ? 'settings-pill settings-pill-active' : 'settings-pill'}
              onClick={() => updatePreference('density', 'comfortable')}
            >
              {copy.comfortable}
            </button>
            <button
              type="button"
              className={preferences.density === 'compact' ? 'settings-pill settings-pill-active' : 'settings-pill'}
              onClick={() => updatePreference('density', 'compact')}
            >
              {copy.compact}
            </button>
          </div>
        </div>

        <button type="button" className="secondary-button settings-reset" onClick={onReset}>
          {copy.reset}
        </button>
      </aside>
    </>
  )
}

export default SettingsPanel
