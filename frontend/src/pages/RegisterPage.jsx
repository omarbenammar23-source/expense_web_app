import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../services/api'
import { translate } from '../services/i18n'

function RegisterPage() {
  const navigate = useNavigate()
  const t = translate
  const [formData, setFormData] = useState({
    full_name: '',
    email: '',
    password: '',
  })
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleChange = (event) => {
    const { name, value } = event.target
    setFormData((current) => ({ ...current, [name]: value }))
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    setMessage('')
    setError('')
    setIsSubmitting(true)

    try {
      await api.post('/auth/register', {
        ...formData,
        role: 'employee',
      })
      setMessage(t({
        en: 'Registration successful. You can now log in.',
        fr: 'Inscription reussie. Vous pouvez maintenant vous connecter.',
        ar: 'تم التسجيل بنجاح. يمكنك الان تسجيل الدخول.',
      }))
      setTimeout(() => navigate('/login'), 1200)
    } catch (requestError) {
      setError(
        requestError.response?.data?.message ||
          requestError.message ||
          t({
            en: 'Registration failed.',
            fr: "Echec de l'inscription.",
            ar: 'فشل التسجيل.',
          }),
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="auth-layout">
      <div className="auth-card">
        <h1>{t({ en: 'Register', fr: 'Inscription', ar: 'انشاء حساب' })}</h1>
        <p className="subtitle">
          {t({
            en: 'Create an account to manage your expenses.',
            fr: 'Creez un compte pour gerer vos depenses.',
            ar: 'انشئ حسابا لادارة نفقاتك.',
          })}
        </p>

        <form onSubmit={handleSubmit} className="form">
          <label>
            {t({ en: 'Full Name', fr: 'Nom complet', ar: 'الاسم الكامل' })}
            <input
              type="text"
              name="full_name"
              value={formData.full_name}
              onChange={handleChange}
              placeholder={t({ en: 'Your full name', fr: 'Votre nom complet', ar: 'اسمك الكامل' })}
              required
            />
          </label>

          <label>
            {t({ en: 'Email', fr: 'Email', ar: 'البريد الالكتروني' })}
            <input
              type="email"
              name="email"
              value={formData.email}
              onChange={handleChange}
              placeholder={t({ en: 'you@example.com', fr: 'vous@example.com', ar: 'you@example.com' })}
              required
            />
          </label>

          <label>
            {t({ en: 'Password', fr: 'Mot de passe', ar: 'كلمة المرور' })}
            <input
              type="password"
              name="password"
              value={formData.password}
              onChange={handleChange}
              placeholder={t({ en: 'Create a password', fr: 'Creez un mot de passe', ar: 'انشئ كلمة مرور' })}
              required
            />
          </label>

          {message ? <p className="message success">{message}</p> : null}
          {error ? <p className="message error">{error}</p> : null}

          <button type="submit" disabled={isSubmitting}>
            {isSubmitting
              ? t({ en: 'Creating account...', fr: 'Creation du compte...', ar: 'جاري انشاء الحساب...' })
              : t({ en: 'Register', fr: 'Inscription', ar: 'انشاء حساب' })}
          </button>
        </form>

        <p className="form-link">
          {t({ en: 'Already registered?', fr: 'Deja inscrit ?', ar: 'لديك حساب بالفعل؟' })}{' '}
          <Link to="/login">{t({ en: 'Login', fr: 'Connexion', ar: 'تسجيل الدخول' })}</Link>
        </p>
      </div>
    </div>
  )
}

export default RegisterPage
