import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../services/api'
import { saveAuth } from '../services/auth'
import { translate } from '../services/i18n'

function LoginPage() {
  const navigate = useNavigate()
  const t = translate
  const [formData, setFormData] = useState({ email: '', password: '' })
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleChange = (event) => {
    const { name, value } = event.target
    setFormData((current) => ({ ...current, [name]: value }))
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    setError('')
    setIsSubmitting(true)

    try {
      const response = await api.post('/auth/login', formData)
      const token =
        response.data?.token ||
        response.data?.accessToken ||
        response.data?.data?.token
      const user =
        response.data?.user ||
        response.data?.data?.user || {
          role: response.data?.role || response.data?.data?.role || 'employee',
        }

      if (!token) {
        throw new Error(t({
          en: 'Token missing from login response.',
          fr: 'Jeton manquant dans la reponse de connexion.',
          ar: 'رمز الدخول مفقود في استجابة تسجيل الدخول.',
        }))
      }

      saveAuth(token, user)
      navigate('/groups')
    } catch (requestError) {
      setError(
        requestError.response?.data?.message ||
          requestError.message ||
          t({
            en: 'Login failed.',
            fr: 'Echec de la connexion.',
            ar: 'فشل تسجيل الدخول.',
          }),
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="auth-layout">
      <div className="auth-card">
        <h1>{t({ en: 'Login', fr: 'Connexion', ar: 'تسجيل الدخول' })}</h1>
        <p className="subtitle">
          {t({
            en: 'Sign in to view your expenses.',
            fr: 'Connectez-vous pour voir vos depenses.',
            ar: 'سجل الدخول لعرض نفقاتك.',
          })}
        </p>

        <form onSubmit={handleSubmit} className="form">
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
              placeholder={t({ en: 'Enter your password', fr: 'Entrez votre mot de passe', ar: 'ادخل كلمة المرور' })}
              required
            />
          </label>

          {error ? <p className="message error">{error}</p> : null}

          <button type="submit" disabled={isSubmitting}>
            {isSubmitting
              ? t({ en: 'Logging in...', fr: 'Connexion...', ar: 'جاري تسجيل الدخول...' })
              : t({ en: 'Login', fr: 'Connexion', ar: 'تسجيل الدخول' })}
          </button>
        </form>

        <p className="form-link">
          {t({ en: 'Need an account?', fr: 'Besoin dun compte ?', ar: 'تحتاج الى حساب؟' })}{' '}
          <Link to="/register">{t({ en: 'Register', fr: 'Inscription', ar: 'انشاء حساب' })}</Link>
        </p>
      </div>
    </div>
  )
}

export default LoginPage
