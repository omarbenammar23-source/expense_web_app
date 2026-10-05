import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../services/api'
import { clearAuth, getActiveGroup } from '../services/auth'
import { translate } from '../services/i18n'

function DashboardPage() {
  const navigate = useNavigate()
  const activeGroup = getActiveGroup()
  const t = translate
  const [expenses, setExpenses] = useState([])
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const fetchExpenses = async () => {
      try {
        const response = await api.get('/expenses/my-expenses')
        const expenseList =
          response.data?.expenses || response.data?.data || response.data || []

        setExpenses(Array.isArray(expenseList) ? expenseList : [])
      } catch (requestError) {
        const status = requestError.response?.status

        if (status === 401) {
          clearAuth()
          navigate('/login')
          return
        }

        setError(
          requestError.response?.data?.message ||
            requestError.message ||
            t({
              en: 'Unable to load expenses.',
              fr: 'Impossible de charger les depenses.',
              ar: 'تعذر تحميل المصاريف.',
            }),
        )
      } finally {
        setIsLoading(false)
      }
    }

    fetchExpenses()
  }, [navigate, t])

  const handleLogout = () => {
    clearAuth()
    navigate('/login')
  }

  return (
    <div className="page-shell">
      <div className="page-header">
        <div>
          <h1>{t({ en: 'Dashboard', fr: 'Tableau de bord', ar: 'لوحة التحكم' })}</h1>
          <p className="subtitle">
            {activeGroup
              ? t({
                  en: `${activeGroup.name}: your recent expenses are listed below.`,
                  fr: `${activeGroup.name} : vos depenses recentes sont listees ci-dessous.`,
                  ar: `${activeGroup.name}: masarifuk alakhira mawjouda adnah.`,
                })
              : t({
                  en: 'Your recent expenses are listed below.',
                  fr: 'Vos depenses recentes sont listees ci-dessous.',
                  ar: 'مصاريفك الأخيرة موجودة أدناه.',
                })}
          </p>
        </div>
        <div className="header-actions">
          <Link to="/groups" className="secondary-link-button">
            {t({ en: 'Workspaces', fr: 'Espaces de travail', ar: 'مساحات العمل' })}
          </Link>
          <Link to="/scan-receipt" className="primary-link-button">
            {t({ en: 'Scan Receipt', fr: 'Scanner le recu', ar: 'فحص الوصل' })}
          </Link>
          <button type="button" className="secondary-button" onClick={handleLogout}>
            {t({ en: 'Logout', fr: 'Deconnexion', ar: 'تسجيل الخروج' })}
          </button>
        </div>
      </div>

      <div className="card">
        {isLoading ? <p>{t({ en: 'Loading expenses...', fr: 'Chargement des depenses...', ar: 'جار تحميل المصاريف...' })}</p> : null}
        {error ? <p className="message error">{error}</p> : null}

        {!isLoading && !error && expenses.length === 0 ? (
          <p>{t({ en: 'No expenses found.', fr: 'Aucune depense trouvee.', ar: 'لا توجد مصاريف.' })}</p>
        ) : null}

        {!isLoading && !error && expenses.length > 0 ? (
          <div className="table-wrapper">
            <table className="expense-table">
              <thead>
                <tr>
                  <th>{t({ en: 'Title', fr: 'Titre', ar: 'العنوان' })}</th>
                  <th>{t({ en: 'Bill Amount', fr: 'Montant facture', ar: 'المبلغ' })}</th>
                  <th>{t({ en: 'Refunded Amount', fr: 'Montant rembourse', ar: 'مبلغ الاسترداد' })}</th>
                  <th>{t({ en: 'Category', fr: 'Categorie', ar: 'الفئة' })}</th>
                  <th>{t({ en: 'Status', fr: 'Statut', ar: 'الحالة' })}</th>
                  <th>{t({ en: 'Warning', fr: 'Alerte', ar: 'تحذير' })}</th>
                  <th>{t({ en: 'Receipt', fr: 'Recu', ar: 'الوصل' })}</th>
                  <th>{t({ en: 'Expense Date', fr: 'Date de depense', ar: 'تاريخ المصروف' })}</th>
                </tr>
              </thead>
              <tbody>
                {expenses.map((expense) => (
                  <tr key={expense._id || expense.id || `${expense.title}-${expense.amount}`}>
                    <td>
                      <div className="expense-title-cell">
                        <span>{expense.title || '-'}</span>
                        {expense.note ? <span className="expense-note-text">{expense.note}</span> : null}
                        {expense.note_attachment_url ? (
                          <UploadLink
                            fileUrl={expense.note_attachment_url}
                            label={t({ en: 'Note attachment', fr: 'Piece jointe', ar: 'مرفق الملاحظة' })}
                          />
                        ) : null}
                      </div>
                    </td>
                    <td>{formatExpenseAmount(expense.amount, expense.currency)}</td>
                    <td>{formatExpenseAmount(expense.refunded_amount, expense.refund_currency)}</td>
                    <td>{expense.category ? translateCategory(expense.category) : '-'}</td>
                    <td>
                      <StatusBadge status={expense.status} />
                    </td>
                    <td>
                      <SuspiciousBadge
                        isSuspicious={expense.is_suspicious}
                        reason={expense.suspicious_reason}
                      />
                    </td>
                    <td>{expense.receipt_url ? <ReceiptLink receiptUrl={expense.receipt_url} label={t({ en: 'View', fr: 'Voir', ar: 'عرض' })} /> : '-'}</td>
                    <td>{expense.expense_date ? formatDate(expense.expense_date) : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </div>
  )
}

function formatDate(dateValue) {
  return new Date(dateValue).toLocaleDateString()
}

function formatExpenseAmount(amount, currency) {
  if (amount == null || amount === '') {
    return '-'
  }

  return currency ? `${currency} ${amount}` : String(amount)
}

function StatusBadge({ status }) {
  const safeStatus = status || 'pending'
  const labels = {
    pending: translate({ en: 'Pending', fr: 'En attente', ar: 'معلق' }),
    approved: translate({ en: 'Approved', fr: 'Approuve', ar: 'موافق عليه' }),
    rejected: translate({ en: 'Rejected', fr: 'Refuse', ar: 'مرفوض' }),
    reimbursed: translate({ en: 'Reimbursed', fr: 'Rembourse', ar: 'تم التعويض' }),
  }

  return <span className={`status-badge status-${safeStatus}`}>{labels[safeStatus] || safeStatus}</span>
}

function SuspiciousBadge({ isSuspicious, reason }) {
  if (!isSuspicious) {
    return <span className="subtle-text">-</span>
  }

  return (
    <div className="suspicious-cell">
      <span className="warning-badge">{translate({ en: 'Warning', fr: 'Alerte', ar: 'تحذير' })}</span>
      {reason ? <span className="suspicious-reason">{reason}</span> : null}
    </div>
  )
}

function ReceiptLink({ receiptUrl, label = 'View' }) {
  const baseUrl = api.defaults.baseURL?.replace(/\/api$/, '') || 'http://localhost:5000'

  return (
    <a href={`${baseUrl}/uploads/${receiptUrl}`} target="_blank" rel="noreferrer" className="table-link">
      {label}
    </a>
  )
}

function UploadLink({ fileUrl, label }) {
  const baseUrl = api.defaults.baseURL?.replace(/\/api$/, '') || 'http://localhost:5000'

  return (
    <a href={`${baseUrl}/uploads/${fileUrl}`} target="_blank" rel="noreferrer" className="table-link note-attachment-link">
      {label}
    </a>
  )
}

function translateCategory(category) {
  return translate({
    en: category,
    fr:
      {
        Food: 'Repas',
        Travel: 'Voyage',
        Hotel: 'Hotel',
        Transport: 'Transport',
        Office: 'Bureau',
        Other: 'Autre',
      }[category] || category,
    ar:
      {
        Food: 'طعام',
        Travel: 'سفر',
        Hotel: 'فندق',
        Transport: 'نقل',
        Office: 'مكتب',
        Other: 'أخرى',
      }[category] || category,
  })
}

export default DashboardPage
