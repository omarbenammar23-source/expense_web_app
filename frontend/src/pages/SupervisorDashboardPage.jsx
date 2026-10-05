import { useCallback, useDeferredValue, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../services/api'
import { clearAuth, getActiveGroup, getUser } from '../services/auth'
import { translate } from '../services/i18n'

const REFUND_CURRENCY_OPTIONS = [
  { code: 'TND', label: 'Tunisian Dinar' },
  { code: 'USD', label: 'US Dollar' },
  { code: 'EUR', label: 'Euro' },
  { code: 'GBP', label: 'British Pound' },
]

function isManagerRole(role) {
  return role === 'owner' || role === 'responsable' || role === 'supervisor'
}

function canManageMemberRoles(activeGroup, currentUser) {
  return activeGroup?.role === 'owner' || currentUser?.role === 'admin'
}

function SupervisorDashboardPage() {
  const navigate = useNavigate()
  const activeGroup = getActiveGroup()
  const currentUser = getUser()
  const t = translate
  const [expenses, setExpenses] = useState([])
  const [employees, setEmployees] = useState([])
  const [selectedEmployee, setSelectedEmployee] = useState(null)
  const [employeeHistory, setEmployeeHistory] = useState([])
  const [employeeSearch, setEmployeeSearch] = useState('')
  const [isEmployeePanelOpen, setIsEmployeePanelOpen] = useState(false)
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isEmployeeLoading, setIsEmployeeLoading] = useState(true)
  const [isHistoryLoading, setIsHistoryLoading] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const [activeExpenseId, setActiveExpenseId] = useState('')
  const [checkingExpenseId, setCheckingExpenseId] = useState('')
  const [noteViewerExpense, setNoteViewerExpense] = useState(null)
  const [isExportFormOpen, setIsExportFormOpen] = useState(false)
  const [historyStartDate, setHistoryStartDate] = useState('')
  const [historyEndDate, setHistoryEndDate] = useState('')
  const [isGroupExportFormOpen, setIsGroupExportFormOpen] = useState(false)
  const [groupExportStartDate, setGroupExportStartDate] = useState('')
  const [groupExportEndDate, setGroupExportEndDate] = useState('')
  const [isGroupExporting, setIsGroupExporting] = useState(false)
  const [activeRefundSaveId, setActiveRefundSaveId] = useState('')
  const [joinRequests, setJoinRequests] = useState([])
  const [isJoinRequestsLoading, setIsJoinRequestsLoading] = useState(true)
  const [activeJoinRequestReviewId, setActiveJoinRequestReviewId] = useState('')

  const deferredEmployeeSearch = useDeferredValue(employeeSearch)
  const filteredEmployees = employees.filter((employee) => {
    const query = deferredEmployeeSearch.trim().toLowerCase()
    if (!query) {
      return true
    }

    return (
      String(employee.full_name || '').toLowerCase().includes(query) ||
      String(employee.email || '').toLowerCase().includes(query)
    )
  })

  const fetchPendingExpenses = useCallback(async () => {
    try {
      setError('')
      const response = await api.get('/expenses/pending')
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
          t({ en: 'Unable to load pending expenses.', fr: 'Impossible de charger les depenses en attente.', ar: 'تعذر تحميل المصاريف المعلقة.' }),
      )
    } finally {
      setIsLoading(false)
    }
  }, [navigate, t])

  const fetchEmployees = useCallback(async () => {
    try {
      const response = await api.get('/groups/employees')
      const nextEmployees = Array.isArray(response.data?.employees) ? response.data.employees : []

      setEmployees(nextEmployees)

      if (!nextEmployees.length) {
        setSelectedEmployee(null)
        setEmployeeHistory([])
        return
      }

      setSelectedEmployee((current) => {
        if (!current) {
          return null
        }

        return (
          nextEmployees.find((employee) => Number(employee.id) === Number(current.id)) ||
          null
        )
      })
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
          t({ en: 'Unable to load workspace employees.', fr: "Impossible de charger les employes de l'espace de travail.", ar: 'تعذر تحميل موظفي مساحة العمل.' }),
      )
    } finally {
      setIsEmployeeLoading(false)
    }
  }, [navigate, t])

  const fetchJoinRequests = useCallback(async () => {
    if (!activeGroup?.id || !canManageMemberRoles(activeGroup, currentUser)) {
      setJoinRequests([])
      setIsJoinRequestsLoading(false)
      return
    }

    try {
      const response = await api.get('/groups/join-requests', {
        headers: {
          'x-group-id': activeGroup.id,
        },
      })

      setJoinRequests(Array.isArray(response.data?.requests) ? response.data.requests : [])
    } catch (requestError) {
      const status = requestError.response?.status

      if (status === 401) {
        clearAuth()
        navigate('/login')
        return
      }

      if (status === 403) {
        setJoinRequests([])
        return
      }

      setError(
        requestError.response?.data?.message ||
          requestError.message ||
          t({
            en: 'Unable to load join requests.',
            fr: 'Impossible de charger les demandes dadhesion.',
            ar: 'Taadhara tahmil talabaat alindimam.',
          }),
      )
    } finally {
      setIsJoinRequestsLoading(false)
    }
  }, [activeGroup, currentUser, navigate, t])

  const fetchEmployeeHistory = async (employeeInput) => {
    const employeeId =
      typeof employeeInput === 'object' ? Number(employeeInput?.id) : Number(employeeInput)
    const previewEmployee = typeof employeeInput === 'object' ? employeeInput : null

    if (!employeeId) {
      setEmployeeHistory([])
      return
    }

    try {
      if (previewEmployee) {
        setSelectedEmployee(previewEmployee)
      }

      setIsHistoryLoading(true)
      setEmployeeHistory([])
      const response = await api.get(`/groups/employees/${employeeId}/history`)
      const employee = response.data?.employee || null
      const history = Array.isArray(response.data?.expenses) ? response.data.expenses : []

      if (employee) {
        setSelectedEmployee(employee)
      }

      setEmployeeHistory(history)
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
          t({ en: 'Unable to load this employee history.', fr: 'Impossible de charger cet historique employe.', ar: 'تعذر تحميل سجل هذا الموظف.' }),
      )
    } finally {
      setIsHistoryLoading(false)
    }
  }

  useEffect(() => {
    fetchPendingExpenses()
    fetchEmployees()
  }, [fetchEmployees, fetchPendingExpenses])

  useEffect(() => {
    setIsJoinRequestsLoading(true)
    fetchJoinRequests()
  }, [fetchJoinRequests])

  useEffect(() => {
    const refreshJoinRequests = () => {
      fetchJoinRequests()
    }

    const intervalId = window.setInterval(refreshJoinRequests, 10000)
    window.addEventListener('focus', refreshJoinRequests)

    return () => {
      window.clearInterval(intervalId)
      window.removeEventListener('focus', refreshJoinRequests)
    }
  }, [fetchJoinRequests])

  const handleStatusChange = async (expenseId, status, expense = null) => {
    try {
      setActiveExpenseId(expenseId)
      await api.put(`/expenses/${expenseId}/status`, {
        status,
        refunded_amount: normalizeRefundAmount(expense?.refunded_amount),
        refund_currency: normalizeRefundCurrency(expense?.refund_currency),
      })
      await Promise.all([
        fetchPendingExpenses(),
        selectedEmployee?.id ? fetchEmployeeHistory(selectedEmployee.id) : Promise.resolve(),
        fetchEmployees(),
      ])
    } catch (requestError) {
      setError(
          requestError.response?.data?.message ||
          requestError.message ||
          t({
            en: `Unable to mark the expense as ${status}.`,
            fr: `Impossible de marquer la depense comme ${status}.`,
            ar: `Taadhara taalim almasrouf bihalat ${status}.`,
          }),
      )
    } finally {
      setActiveExpenseId('')
    }
  }

  const handleWebMatchCheck = async (expenseId) => {
    try {
      setCheckingExpenseId(expenseId)
      setError('')
      const response = await api.put(`/expenses/${expenseId}/web-match-check`)
      const updatedExpense = response.data?.expense

      if (updatedExpense) {
        setExpenses((current) =>
          current.map((expense) =>
            (expense._id || expense.id) === expenseId ? updatedExpense : expense,
          ),
        )
        setEmployeeHistory((current) =>
          current.map((expense) =>
            (expense._id || expense.id) === expenseId ? updatedExpense : expense,
          ),
        )
      } else {
        await Promise.all([
          fetchPendingExpenses(),
          selectedEmployee?.id ? fetchEmployeeHistory(selectedEmployee.id) : Promise.resolve(),
        ])
      }
    } catch (requestError) {
      const status = requestError.response?.status

      if (status === 401) {
        clearAuth()
        navigate('/login')
        return
      }

      setError(
          requestError.response?.data?.message ||
          requestError.response?.data?.error ||
          requestError.message ||
          t({ en: 'Unable to run the web fraud check.', fr: 'Impossible dexecuter la verification web.', ar: 'تعذر تشغيل التحقق عبر الويب.' }),
      )
    } finally {
      setCheckingExpenseId('')
    }
  }

  const handleRefundFieldChange = (expenseId, field, value) => {
    setExpenses((current) =>
      current.map((expense) =>
        String(expense._id || expense.id) === String(expenseId)
          ? { ...expense, [field]: value }
          : expense,
      ),
    )

    setEmployeeHistory((current) =>
      current.map((expense) =>
        String(expense._id || expense.id) === String(expenseId)
          ? { ...expense, [field]: value }
          : expense,
      ),
    )
  }

  const handleSaveRefund = async (expense) => {
    const expenseId = expense._id || expense.id

    try {
      setActiveRefundSaveId(String(expenseId))
      setError('')

      const response = await api.put(`/expenses/${expenseId}`, {
        refunded_amount: normalizeRefundAmount(expense.refunded_amount),
        refund_currency: normalizeRefundCurrency(expense.refund_currency),
      })

      const updatedExpense = response.data?.expense

      if (updatedExpense) {
        setExpenses((current) =>
          current.map((entry) =>
            String(entry._id || entry.id) === String(expenseId) ? updatedExpense : entry,
          ),
        )
        setEmployeeHistory((current) =>
          current.map((entry) =>
            String(entry._id || entry.id) === String(expenseId) ? updatedExpense : entry,
          ),
        )
      } else {
        await Promise.all([
          fetchPendingExpenses(),
          selectedEmployee?.id ? fetchEmployeeHistory(selectedEmployee.id) : Promise.resolve(),
        ])
      }
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
            en: 'Unable to save refund values.',
            fr: 'Impossible denregistrer les valeurs de remboursement.',
            ar: 'ØªØ¹Ø°Ø± Ø­ÙØ¸ Ù‚ÙŠÙ… Ø§Ù„Ø§Ø³ØªØ±Ø¯Ø§Ø¯.',
          }),
      )
    } finally {
      setActiveRefundSaveId('')
    }
  }

  const handleReviewJoinRequest = async (requestId, status, role = 'employee') => {
    try {
      setActiveJoinRequestReviewId(String(requestId))
      setError('')

      await api.put(`/groups/join-requests/${requestId}`, { status, role })
      await Promise.all([fetchJoinRequests(), fetchEmployees()])
    } catch (requestError) {
      const statusCode = requestError.response?.status

      if (statusCode === 401) {
        clearAuth()
        navigate('/login')
        return
      }

      setError(
        requestError.response?.data?.message ||
          requestError.message ||
          t({
            en: 'Unable to review the join request.',
            fr: 'Impossible dexaminer la demande dadhesion.',
            ar: 'Taadhara murajaat talab alindimam.',
          }),
      )
    } finally {
      setActiveJoinRequestReviewId('')
    }
  }

  const handleSelectEmployee = (employee) => {
    setIsEmployeePanelOpen(false)
    setIsExportFormOpen(false)
    setHistoryStartDate('')
    setHistoryEndDate('')
    fetchEmployeeHistory(employee)
  }

  const handleToggleEmployeePanel = () => {
    setIsEmployeePanelOpen((current) => !current)
  }

  const handleLogout = () => {
    clearAuth()
    navigate('/login')
  }

  const openNoteViewer = (expense) => {
    setNoteViewerExpense(expense)
  }

  const closeNoteViewer = () => {
    setNoteViewerExpense(null)
  }

  const handleToggleExportForm = () => {
    setIsExportFormOpen((current) => !current)
  }

  const handleToggleGroupExportForm = () => {
    setIsGroupExportFormOpen((current) => !current)
  }

  const handleExportHistory = async () => {
    if (!selectedEmployee?.id) {
      return
    }

    if (!historyStartDate || !historyEndDate || historyEndDate < historyStartDate) {
      setError(
        t({
          en: 'Please choose a valid date range before exporting.',
          fr: 'Choisissez une plage de dates valide avant lexport.',
          ar: 'Ø­Ø¯Ø¯ ÙØªØ±Ø© Ø²Ù…Ù†ÙŠØ© ØµØ­ÙŠØ­Ø© Ù‚Ø¨Ù„ Ø§Ù„ØªØµØ¯ÙŠØ±.',
        }),
      )
      return
    }

    try {
      setIsExporting(true)
      setError('')

      const response = await api.get(`/groups/employees/${selectedEmployee.id}/history/export`, {
        params: buildHistoryQuery({
          startDate: historyStartDate,
          endDate: historyEndDate,
        }),
        responseType: 'blob',
      })

      const headerValue = response.headers['content-disposition'] || ''
      const matchedFileName = headerValue.match(/filename="([^"]+)"/i)?.[1]
      const downloadName =
        matchedFileName ||
        `${sanitizeExportFileName(selectedEmployee.full_name)}_operations_${historyEndDate.replaceAll('-', '_')}.xlsx`
      const downloadUrl = window.URL.createObjectURL(response.data)
      const link = document.createElement('a')

      link.href = downloadUrl
      link.download = downloadName
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.URL.revokeObjectURL(downloadUrl)
    } catch (requestError) {
      const status = requestError.response?.status

      if (status === 401) {
        clearAuth()
        navigate('/login')
        return
      }

      setError(
        requestError.message ||
          t({
            en: 'Unable to export this employee history.',
            fr: 'Impossible dexporter lhistorique de cet employe.',
            ar: 'ØªØ¹Ø°Ø± ØªØµØ¯ÙŠØ± Ø³Ø¬Ù„ Ù‡Ø°Ø§ Ø§Ù„Ù…ÙˆØ¸Ù.',
          }),
      )
    } finally {
      setIsExporting(false)
    }
  }

  const handleExportGroupHistory = async () => {
    if (!groupExportStartDate || !groupExportEndDate) {
      setError(
        t({
          en: 'Start date and end date are required before exporting.',
          fr: 'La date de debut et la date de fin sont requises avant lexport.',
          ar: 'ØªØ§Ø±ÙŠØ® Ø§Ù„Ø¨Ø¯Ø§ÙŠØ© ÙˆØªØ§Ø±ÙŠØ® Ø§Ù„Ù†Ù‡Ø§ÙŠØ© Ù…Ø·Ù„ÙˆØ¨Ø§Ù† Ù‚Ø¨Ù„ Ø§Ù„ØªØµØ¯ÙŠØ±.',
        }),
      )
      return
    }

    if (groupExportEndDate < groupExportStartDate) {
      setError(
        t({
          en: 'End date cannot be before start date.',
          fr: 'La date de fin ne peut pas etre avant la date de debut.',
          ar: 'Ù„Ø§ ÙŠÙ…ÙƒÙ† Ø£Ù† ÙŠÙƒÙˆÙ† ØªØ§Ø±ÙŠØ® Ø§Ù„Ù†Ù‡Ø§ÙŠØ© Ù‚Ø¨Ù„ ØªØ§Ø±ÙŠØ® Ø§Ù„Ø¨Ø¯Ø§ÙŠØ©.',
        }),
      )
      return
    }

    try {
      setIsGroupExporting(true)
      setError('')

      const response = await api.get('/groups/history/export', {
        params: buildHistoryQuery({
          startDate: groupExportStartDate,
          endDate: groupExportEndDate,
        }),
        responseType: 'blob',
      })

      const headerValue = response.headers['content-disposition'] || ''
      const matchedFileName = headerValue.match(/filename="?([^";]+)"?/i)?.[1]
      const downloadName =
        matchedFileName ||
        `${sanitizeExportFileName(activeGroup?.name || 'group')}_operations_${groupExportEndDate.replaceAll('-', '_')}.xlsx`
      const downloadUrl = window.URL.createObjectURL(response.data)
      const link = document.createElement('a')

      link.href = downloadUrl
      link.download = downloadName
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.URL.revokeObjectURL(downloadUrl)
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
            en: 'Unable to export this workspace history.',
            fr: "Impossible dexporter lhistorique de l'espace de travail.",
            ar: 'ØªØ¹Ø°Ø± ØªØµØ¯ÙŠØ± Ø³Ø¬Ù„ Ø§Ù„Ù…Ø¬Ù…ÙˆØ¹Ø©.',
          }),
      )
    } finally {
      setIsGroupExporting(false)
    }
  }

  const showEmployeeHistory = !isEmployeePanelOpen && Boolean(selectedEmployee)
  const showPendingExpenses = !isEmployeePanelOpen && !selectedEmployee
  const canExportEmployeeHistory = isManagerRole(activeGroup?.role) || currentUser?.role === 'admin'
  const canExportGroupHistory = isManagerRole(activeGroup?.role) || currentUser?.role === 'admin'
  const canUpdateMemberRoles = canManageMemberRoles(activeGroup, currentUser)

  return (
    <div className="page-shell">
      <div className="page-header">
        <div>
          <h1>{t({ en: 'Supervisor Dashboard', fr: 'Tableau superviseur', ar: 'لوحة المشرف' })}</h1>
          <p className="subtitle">
            {activeGroup
              ? t({
                  en: `${activeGroup.name}: review expenses, open the employee list, and inspect history from one place.`,
                  fr: `${activeGroup.name} : revisez les depenses, ouvrez la liste des employes et consultez lhistorique.`,
                  ar: `${activeGroup.name}: raje almasarif, iftah qaimat almuwazzafin, waftah altarikh min makan wahid.`,
                })
              : t({
                  en: 'Review expenses, open the employee list, and inspect history from one place.',
                  fr: 'Revisez les depenses, ouvrez la liste des employes et consultez lhistorique.',
                  ar: 'راجع المصاريف، افتح قائمة الموظفين، وتفقد السجل من مكان واحد.',
                })}
          </p>
        </div>
        <div className="header-actions supervisor-header-actions">
          <button
            type="button"
            className="secondary-button"
            onClick={handleToggleEmployeePanel}
          >
            {isEmployeePanelOpen
              ? t({ en: 'Hide Employee List', fr: 'Masquer la liste', ar: 'إخفاء قائمة الموظفين' })
              : t({ en: 'Employee List', fr: 'Liste des employes', ar: 'قائمة الموظفين' })}
          </button>
          <Link to="/groups" className="secondary-link-button">
            {t({ en: 'Workspaces', fr: 'Espaces de travail', ar: 'مساحات العمل' })}
          </Link>
          <button type="button" className="secondary-button" onClick={handleLogout}>
            {t({ en: 'Logout', fr: 'Deconnexion', ar: 'تسجيل الخروج' })}
          </button>
        </div>
      </div>

      {activeGroup?.invite_code ? (
        <div className="card workspace-summary-card">
          <div>
            <h2>{t({ en: 'Workspace Invite Code', fr: 'Code dinvitation', ar: 'رمز دعوة مساحة العمل' })}</h2>
            <p className="subtitle">
              {t({
                en: `Share this code only when you want someone to request access to ${activeGroup.name}.`,
                fr: `Partagez ce code seulement pour donner acces a ${activeGroup.name}.`,
                ar: `شارِك هذا الرمز فقط عندما تريد من شخص طلب الوصول إلى ${activeGroup.name}.`,
              }).replace('شارِك هذا الرمز فقط عندما تريد من شخص طلب الوصول إلى','Sharik hatha alramz faqat lindama turid min shakhs talab alwusul ila')}
            </p>
          </div>
          <div className="workspace-meta">
            <span className="status-badge status-approved">
              {formatGroupRole(activeGroup.role)}
            </span>
            <span className="subtle-text">{t({ en: 'Invite code', fr: 'Code dinvitation', ar: 'رمز الدعوة' })}: {activeGroup.invite_code}</span>
          </div>
        </div>
      ) : null}

      {canUpdateMemberRoles ? (
      <div className="card">
        <div className="section-heading">
          <h2>{t({ en: 'Pending Join Requests', fr: 'Demandes dadhesion en attente', ar: 'Talabaat alindimam almuaalaqa' })}</h2>
          <p className="subtitle">
            {activeGroup
              ? t({
                  en: `New access requests for ${activeGroup.name} appear here automatically.`,
                  fr: `Les nouvelles demandes dacces pour ${activeGroup.name} apparaissent ici automatiquement.`,
                  ar: `Tatheer huna talabaat alwusul aljadida likul ${activeGroup.name} تلقائيا.`,
                })
              : t({
                  en: 'Select a workspace to review access requests.',
                  fr: 'Selectionnez un espace de travail pour examiner les demandes dacces.',
                  ar: 'Ikhtar workspace limurajaat talabaat alwusul.',
                })}
          </p>
        </div>

        {isJoinRequestsLoading ? (
          <p>{t({ en: 'Loading join requests...', fr: 'Chargement des demandes...', ar: 'Jari tahmil talabaat alindimam...' })}</p>
        ) : null}

        {!isJoinRequestsLoading && joinRequests.length === 0 ? (
          <p>{t({ en: 'No pending join requests for this workspace right now.', fr: 'Aucune demande dadhesion en attente pour cet espace de travail.', ar: 'La توجد talabaat indimam muaalaqa lihatha workspace حاليا.' })}</p>
        ) : null}

        {!isJoinRequestsLoading && joinRequests.length > 0 ? (
          <div className="group-list">
            {joinRequests.map((request) => (
              <div key={request.id} className="group-card">
                <div className="group-card-header">
                  <div>
                    <strong>{request.user.full_name}</strong>
                    <p className="subtitle">{request.user.email}</p>
                  </div>
                  <span className="status-badge status-pending">{request.requested_role}</span>
                </div>

                <div className="group-card-actions">
                  <button
                    type="button"
                    className="approve-button"
                    disabled={activeJoinRequestReviewId === String(request.id)}
                      onClick={() => handleReviewJoinRequest(request.id, 'approved', 'employee')}
                  >
                    {activeJoinRequestReviewId === String(request.id)
                      ? t({ en: 'Saving...', fr: 'Enregistrement...', ar: 'Jari alhifz...' })
                        : t({ en: 'Approve Employee', fr: 'Approuver employe', ar: 'Mouafaqa' })}
                  </button>
                  <button
                    type="button"
                    className="approve-button"
                    disabled={activeJoinRequestReviewId === String(request.id)}
                    onClick={() => handleReviewJoinRequest(request.id, 'approved', 'responsable')}
                  >
                    {t({ en: 'Approve Responsable', fr: 'Approuver responsable', ar: 'Mouafaqa' })}
                  </button>
                  <button
                    type="button"
                    className="reject-button"
                    disabled={activeJoinRequestReviewId === String(request.id)}
                    onClick={() => handleReviewJoinRequest(request.id, 'rejected')}
                  >
                    {t({ en: 'Reject', fr: 'Refuser', ar: 'Rafd' })}
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </div>
      ) : null}

      {canExportGroupHistory ? (
        <div className="card export-panel">
          <div className="export-panel-header">
            <div className="export-panel-copy">
              <span className="section-kicker">
                {t({ en: 'Workspace Export', fr: "Export de l'espace de travail", ar: 'تصدير مساحة العمل' })}
              </span>
              <h2>{t({ en: 'Workspace Export', fr: "Export de l'espace de travail", ar: 'ØªØµØ¯ÙŠØ± Ø§Ù„Ù…Ø¬Ù…ÙˆØ¹Ø©' })}</h2>
              <p className="subtitle">
                {t({
                  en: 'Export one Excel file for the whole workspace using employee upload dates only.',
                  fr: "Exportez un seul fichier Excel pour l'espace de travail avec les dates denvoi des employes seulement.",
                  ar: 'ØµØ¯Ù‘Ø± Ù…Ù„Ù Ø¥ÙƒØ³Ù„ ÙˆØ§Ø­Ø¯ Ù„Ù„Ù…Ø¬Ù…ÙˆØ¹Ø© Ø¨Ø§Ø¹ØªÙ…Ø§Ø¯ ØªÙˆØ§Ø±ÙŠØ® Ø±ÙØ¹ Ø§Ù„Ù…ÙˆØ¸ÙÙŠÙ† ÙÙ‚Ø·.',
                })}
              </p>
            </div>
            <button type="button" className="secondary-button export-toggle-button" onClick={handleToggleGroupExportForm}>
              {t({ en: 'Extract Excel File', fr: 'Extraire le fichier Excel', ar: 'Ø§Ø³ØªØ®Ø±Ø§Ø¬ Ù…Ù„Ù Ø¥ÙƒØ³Ù„' })}
            </button>
          </div>

          {isGroupExportFormOpen ? (
            <div className="group-card-meta export-form-shell">
              <label className="export-field">
                {t({ en: 'Start date', fr: 'Date de debut', ar: 'ØªØ§Ø±ÙŠØ® Ø§Ù„Ø¨Ø¯Ø§ÙŠØ©' })}
                <input
                  className="export-date-input"
                  type="date"
                  value={groupExportStartDate}
                  onChange={(event) => setGroupExportStartDate(event.target.value)}
                />
              </label>
              <label className="export-field">
                {t({ en: 'End date', fr: 'Date de fin', ar: 'ØªØ§Ø±ÙŠØ® Ø§Ù„Ù†Ù‡Ø§ÙŠØ©' })}
                <input
                  className="export-date-input"
                  type="date"
                  value={groupExportEndDate}
                  onChange={(event) => setGroupExportEndDate(event.target.value)}
                />
              </label>
              <button
                type="button"
                className="approve-button export-submit-button"
                disabled={isGroupExporting}
                onClick={handleExportGroupHistory}
              >
                {isGroupExporting
                  ? t({ en: 'Exporting...', fr: 'Export...', ar: 'Ø¬Ø§Ø±ÙŠ Ø§Ù„ØªØµØ¯ÙŠØ±...' })
                  : t({ en: 'Export', fr: 'Exporter', ar: 'ØªØµØ¯ÙŠØ±' })}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {error ? <p className="message error">{error}</p> : null}

      {isEmployeePanelOpen ? (
        <div className="card employee-list-card">
          <div className="employee-sidebar-top">
            <div>
              <h2>{t({ en: 'Employees', fr: 'Employes', ar: 'الموظفون' })}</h2>
              <p className="subtitle">
                {employees.length} {t({ en: employees.length === 1 ? 'team member' : 'team members', fr: employees.length === 1 ? 'membre' : 'membres', ar: employees.length === 1 ? 'موظف' : 'موظفون' })}
              </p>
            </div>
          </div>

          <label className="employee-search-shell">
            <span className="employee-search-icon" aria-hidden="true">
              {t({ en: 'Search', fr: 'Recherche', ar: 'بحث' })}
            </span>
            <input
              type="text"
              className="employee-search-input"
              value={employeeSearch}
              onChange={(event) => setEmployeeSearch(event.target.value)}
              placeholder={t({ en: 'Search employee', fr: 'Rechercher un employe', ar: 'ابحث عن موظف' })}
            />
          </label>

          {isEmployeeLoading ? <p>{t({ en: 'Loading employees...', fr: 'Chargement des employes...', ar: 'جار تحميل الموظفين...' })}</p> : null}
          {!isEmployeeLoading && filteredEmployees.length === 0 ? (
            <p className="subtle-text">{t({ en: 'No employees matched your search.', fr: 'Aucun employe ne correspond.', ar: 'لا يوجد موظف مطابق لبحثك.' })}</p>
          ) : null}

          {!isEmployeeLoading && filteredEmployees.length > 0 ? (
            <div className="employee-sidebar-list">
              {filteredEmployees.map((employee) => {
                const isSelected = Number(selectedEmployee?.id) === Number(employee.id)

                return (
                  <button
                    key={employee.id}
                    type="button"
                    className={`employee-sidebar-item ${isSelected ? 'employee-sidebar-item-active' : ''}`}
                    onClick={() => handleSelectEmployee(employee)}
                  >
                    <span className="employee-avatar" aria-hidden="true">
                      {getInitials(employee.full_name)}
                    </span>
                    <span className="employee-sidebar-copy">
                      <strong>{employee.full_name}</strong>
                      <span>{employee.email}</span>
                      <span className="status-badge status-approved">{formatGroupRole(employee.role)}</span>
                    </span>
                  </button>
                )
              })}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="supervisor-main-column">
        {!isEmployeePanelOpen ? (
          <>
            <div className="card details-panel">
              <div className="section-heading">
                <h2>{t({ en: 'Employee History', fr: 'Historique employe', ar: 'سجل الموظف' })}</h2>
                <p className="subtitle">
                  {selectedEmployee
                    ? `${selectedEmployee.full_name} - ${selectedEmployee.email}`
                    : t({
                        en: 'Click Employee List, then choose one employee to see the history.',
                        fr: 'Cliquez sur la liste des employes puis choisissez un employe pour voir lhistorique.',
                        ar: 'اضغط على قائمة الموظفين ثم اختر موظفا لرؤية السجل.',
                      })}
                </p>
              </div>

              {showEmployeeHistory ? (
                <>
                  <div className="employee-history-summary">
                    <span className="subtle-text">
                      {t({ en: 'Joined', fr: 'Arrive le', ar: 'انضم' })}: {selectedEmployee.joined_at ? formatDate(selectedEmployee.joined_at) : '-'}
                    </span>
                    <span className="subtle-text">
                      {t({ en: 'Expenses', fr: 'Depenses', ar: 'المصاريف' })}: {selectedEmployee.expense_count || 0}
                    </span>
                    <span className="subtle-text">
                      {t({ en: 'Total spent', fr: 'Total depense', ar: 'إجمالي المصروف' })}: {formatExpenseAmount(selectedEmployee.total_amount, null)}
                    </span>
                  </div>

                  {canExportEmployeeHistory ? (
                    <div className="group-card-actions">
                      <button type="button" className="secondary-button export-toggle-button" onClick={handleToggleExportForm}>
                        {t({ en: 'Extract Excel File', fr: 'Extraire le fichier Excel', ar: 'استخراج ملف إكسل' })}
                      </button>
                    </div>
                  ) : null}

                  {canExportEmployeeHistory && isExportFormOpen ? (
                    <div className="card export-form-shell export-form-shell-inline">
                      <div className="export-field-grid export-inline-grid">
                        <label>
                          {t({ en: 'Start date', fr: 'Date de debut', ar: 'تاريخ البداية' })}
                          <input
                            className="export-date-input"
                            type="date"
                            value={historyStartDate}
                            onChange={(event) => setHistoryStartDate(event.target.value)}
                          />
                        </label>
                        <label>
                          {t({ en: 'End date', fr: 'Date de fin', ar: 'تاريخ النهاية' })}
                          <input
                            className="export-date-input"
                            type="date"
                            value={historyEndDate}
                            onChange={(event) => setHistoryEndDate(event.target.value)}
                          />
                        </label>
                        <button type="button" className="approve-button export-submit-button" disabled={isExporting} onClick={handleExportHistory}>
                          {isExporting
                            ? t({ en: 'Exporting...', fr: 'Export...', ar: 'جار التصدير...' })
                            : t({ en: 'Export', fr: 'Exporter', ar: 'تصدير' })}
                        </button>
                      </div>
                    </div>
                  ) : null}
                </>
              ) : null}

              {isHistoryLoading ? <p>{t({ en: 'Loading employee history...', fr: 'Chargement de lhistorique...', ar: 'جار تحميل سجل الموظف...' })}</p> : null}
              {!isHistoryLoading && !selectedEmployee ? (
                <p className="subtle-text">
                  {t({ en: 'No employee selected yet.', fr: 'Aucun employe selectionne.', ar: 'لم يتم اختيار أي موظف بعد.' })}
                </p>
              ) : null}
              {!isHistoryLoading && showEmployeeHistory && employeeHistory.length === 0 ? (
                <p>{t({ en: 'This employee has no expenses in this workspace yet.', fr: 'Cet employe na encore aucune depense dans cet espace de travail.', ar: 'ليس لدى هذا الموظف أي مصاريف في مساحة العمل هذه بعد.' })}</p>
              ) : null}

              {!isHistoryLoading && showEmployeeHistory && employeeHistory.length > 0 ? (
                <div className="table-wrapper">
                  <table className="expense-table compact-expense-table">
                    <thead>
                      <tr>
                        <th>{t({ en: 'Submission Date', fr: 'Date de soumission', ar: 'تاريخ الإرسال' })}</th>
                        <th>{t({ en: 'Operation Type', fr: 'Type operation', ar: 'نوع العملية' })}</th>
                        <th>{t({ en: 'Title', fr: 'Titre', ar: 'العنوان' })}</th>
                        <th>{t({ en: 'Note', fr: 'Note', ar: 'ملاحظة' })}</th>
                        <th>{t({ en: 'Bill Amount', fr: 'Montant facture', ar: 'المبلغ' })}</th>
                        <th>{t({ en: 'Refunded Amount', fr: 'Montant rembourse', ar: 'مبلغ الاسترداد' })}</th>
                        <th>{t({ en: 'Refund Currency', fr: 'Devise remboursement', ar: 'عملة الاسترداد' })}</th>
                        <th>{t({ en: 'Category', fr: 'Categorie', ar: 'الفئة' })}</th>
                        <th>{t({ en: 'Status', fr: 'Statut', ar: 'الحالة' })}</th>
                        <th>{t({ en: 'Receipt', fr: 'Recu', ar: 'الوصل' })}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {employeeHistory.map((expense) => (
                        <tr
                          key={expense.id}
                          className={expense.is_suspicious ? 'expense-row-suspicious' : ''}
                        >
                          <td>{expense.created_at ? formatDate(expense.created_at) : '-'}</td>
                          <td>{expense.category ? translateCategory(expense.category) : t({ en: 'Bill', fr: 'Facture', ar: 'فاتورة' })}</td>
                          <td>
                            <span>{expense.title || '-'}</span>
                          </td>
                          <td>
                            <NotePreview expense={expense} onOpen={openNoteViewer} />
                          </td>
                          <td>{formatExpenseAmount(expense.amount, expense.currency)}</td>
                          <td>{formatExpenseAmount(expense.refunded_amount, expense.refund_currency)}</td>
                          <td>{expense.refund_currency || '-'}</td>
                          <td>{expense.category ? translateCategory(expense.category) : '-'}</td>
                          <td>
                            <StatusBadge status={expense.status || 'pending'} />
                          </td>
                          <td>{expense.receipt_url ? <ReceiptLink receiptUrl={expense.receipt_url} /> : '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </div>

            {showPendingExpenses ? (
              <div className="card">
                {isLoading ? <p>{t({ en: 'Loading pending expenses...', fr: 'Chargement des depenses en attente...', ar: 'جار تحميل المصاريف المعلقة...' })}</p> : null}

                {!isLoading && !error && expenses.length === 0 ? (
                  <p>{t({ en: 'No pending expenses right now.', fr: 'Aucune depense en attente pour le moment.', ar: 'لا توجد مصاريف معلقة حاليا.' })}</p>
                ) : null}

                {!isLoading && !error && expenses.length > 0 ? (
                  <div className="supervisor-expense-list">
                    {expenses.map((expense) => {
                      const expenseId = expense._id || expense.id

                      return (
                        <div
                          key={expenseId}
                          className={`supervisor-expense-card ${expense.is_suspicious ? 'supervisor-expense-card-suspicious' : ''}`}
                        >
                          <div className="supervisor-expense-main">
                            <div className="supervisor-expense-grid">
                              <div className="supervisor-expense-field">
                                <span className="supervisor-expense-label">{t({ en: 'Title', fr: 'Titre', ar: 'العنوان' })}</span>
                                <span>{expense.title || '-'}</span>
                              </div>
                              <div className="supervisor-expense-field">
                                <span className="supervisor-expense-label">{t({ en: 'Note', fr: 'Note', ar: 'ملاحظة' })}</span>
                                <NotePreview expense={expense} onOpen={openNoteViewer} />
                              </div>
                              <div className="supervisor-expense-field">
                                <span className="supervisor-expense-label">{t({ en: 'Employee', fr: 'Employe', ar: 'الموظف' })}</span>
                                <button
                                  type="button"
                                  className="table-link employee-link-button"
                                  onClick={() =>
                                    handleSelectEmployee({
                                      id: expense.user_id,
                                      full_name: expense.full_name,
                                      email: expense.email,
                                      expense_count:
                                        selectedEmployee?.id === expense.user_id
                                          ? selectedEmployee.expense_count
                                          : 0,
                                      total_amount:
                                        selectedEmployee?.id === expense.user_id
                                          ? selectedEmployee.total_amount
                                          : 0,
                                      joined_at:
                                        selectedEmployee?.id === expense.user_id
                                          ? selectedEmployee.joined_at
                                          : null,
                                    })
                                  }
                                >
                                  {expense.full_name || expense.email || t({ en: 'Employee', fr: 'Employe', ar: 'موظف' })}
                                </button>
                              </div>
                              <div className="supervisor-expense-field">
                                <span className="supervisor-expense-label">{t({ en: 'Bill Amount', fr: 'Montant facture', ar: 'المبلغ' })}</span>
                                <span>{formatExpenseAmount(expense.amount, expense.currency)}</span>
                              </div>
                              <div className="supervisor-expense-field">
                                <span className="supervisor-expense-label">{t({ en: 'Refund Amount', fr: 'Montant remboursement', ar: 'مبلغ الاسترداد' })}</span>
                                <input
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  className="field-input supervisor-refund-input"
                                  value={expense.refunded_amount ?? ''}
                                  onChange={(event) =>
                                    handleRefundFieldChange(expenseId, 'refunded_amount', event.target.value)
                                  }
                                  placeholder={t({ en: 'Enter refund amount', fr: 'Saisir le montant', ar: 'أدخل مبلغ الاسترداد' })}
                                />
                              </div>
                              <div className="supervisor-expense-field">
                                <span className="supervisor-expense-label">{t({ en: 'Refund Currency', fr: 'Devise remboursement', ar: 'عملة الاسترداد' })}</span>
                                <select
                                  className="field-input supervisor-refund-input"
                                  value={expense.refund_currency || ''}
                                  onChange={(event) =>
                                    handleRefundFieldChange(expenseId, 'refund_currency', event.target.value)
                                  }
                                >
                                  <option value="">{t({ en: 'Select currency', fr: 'Choisir une devise', ar: 'اختر العملة' })}</option>
                                  {REFUND_CURRENCY_OPTIONS.map((option) => (
                                    <option key={option.code} value={option.code}>
                                      {option.code} - {option.label}
                                    </option>
                                  ))}
                                </select>
                              </div>
                              <div className="supervisor-expense-field">
                                <span className="supervisor-expense-label">{t({ en: 'Refund Summary', fr: 'Resume remboursement', ar: 'ملخص الاسترداد' })}</span>
                                <span>{formatExpenseAmount(expense.refunded_amount, expense.refund_currency)}</span>
                              </div>
                              <div className="supervisor-expense-field">
                                <span className="supervisor-expense-label">{t({ en: 'Category', fr: 'Categorie', ar: 'الفئة' })}</span>
                                <span>{expense.category ? translateCategory(expense.category) : '-'}</span>
                              </div>
                              <div className="supervisor-expense-field">
                                <span className="supervisor-expense-label">{t({ en: 'Status', fr: 'Statut', ar: 'الحالة' })}</span>
                                <StatusBadge status={expense.status || 'pending'} />
                              </div>
                              <div className="supervisor-expense-field">
                                <span className="supervisor-expense-label">{t({ en: 'Expense Date', fr: 'Date de depense', ar: 'تاريخ المصروف' })}</span>
                                <span>{expense.expense_date ? formatDate(expense.expense_date) : '-'}</span>
                              </div>
                              <div className="supervisor-expense-field">
                                <span className="supervisor-expense-label">{t({ en: 'Receipt', fr: 'Recu', ar: 'الوصل' })}</span>
                                <span>{expense.receipt_url ? <ReceiptLink receiptUrl={expense.receipt_url} /> : '-'}</span>
                              </div>
                            </div>

                            <div className="supervisor-expense-fraud">
                              <span className="supervisor-expense-label">{t({ en: 'Fraud Signal', fr: 'Signal fraude', ar: 'إشارة الاحتيال' })}</span>
                              <FraudSignalCell expense={expense} />
                            </div>
                          </div>

                          <div className="supervisor-expense-actions">
                            <button
                              type="button"
                              className="secondary-button refund-save-button"
                              disabled={activeRefundSaveId === String(expenseId) || activeExpenseId === expenseId}
                              onClick={() => handleSaveRefund(expense)}
                            >
                              {activeRefundSaveId === String(expenseId)
                                ? t({ en: 'Saving...', fr: 'Enregistrement...', ar: 'جار الحفظ...' })
                                : t({ en: 'Save Refund', fr: 'Sauver remboursement', ar: 'حفظ الاسترداد' })}
                            </button>
                            <button
                              type="button"
                              className="fraud-check-button"
                              disabled={checkingExpenseId === expenseId || activeRefundSaveId === String(expenseId)}
                              onClick={() => handleWebMatchCheck(expenseId)}
                            >
                              {checkingExpenseId === expenseId
                                ? t({ en: 'Checking...', fr: 'Verification...', ar: 'جار التحقق...' })
                                : t({ en: 'Fraud Check', fr: 'Verifier fraude', ar: 'فحص الاحتيال' })}
                            </button>

                            <div className="action-group">
                              <button
                                type="button"
                                className="approve-button"
                                disabled={activeExpenseId === expenseId || activeRefundSaveId === String(expenseId)}
                                onClick={() => handleStatusChange(expenseId, 'approved', expense)}
                              >
                                {t({ en: 'Approve', fr: 'Approuver', ar: 'موافقة' })}
                              </button>
                              <button
                                type="button"
                                className="reject-button"
                                disabled={activeExpenseId === expenseId || activeRefundSaveId === String(expenseId)}
                                onClick={() => handleStatusChange(expenseId, 'rejected', expense)}
                              >
                                {t({ en: 'Reject', fr: 'Refuser', ar: 'رفض' })}
                              </button>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                ) : null}
              </div>
            ) : null}
          </>
        ) : null}
      </div>
      {noteViewerExpense ? (
        <>
          <button
            type="button"
            className="note-viewer-backdrop"
            onClick={closeNoteViewer}
            aria-label={t({ en: 'Close note viewer', fr: 'Fermer la note', ar: 'إغلاق الملاحظة' })}
          />
          <div
            className="note-viewer-modal card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="note-viewer-title"
          >
            <div className="note-viewer-header">
              <div>
                <h2 id="note-viewer-title">{t({ en: 'Expense Note', fr: 'Note de depense', ar: 'ملاحظة المصروف' })}</h2>
                <p className="subtitle">{noteViewerExpense.title || t({ en: 'Untitled expense', fr: 'Depense sans titre', ar: 'مصروف بدون عنوان' })}</p>
              </div>
              <button type="button" className="secondary-button" onClick={closeNoteViewer}>
                {t({ en: 'Close', fr: 'Fermer', ar: 'إغلاق' })}
              </button>
            </div>

            <div className="note-viewer-meta">
              <span>{noteViewerExpense.full_name || noteViewerExpense.email || t({ en: 'Employee', fr: 'Employe', ar: 'موظف' })}</span>
              <span>{formatExpenseAmount(noteViewerExpense.amount, noteViewerExpense.currency)}</span>
              <span>{noteViewerExpense.expense_date ? formatDate(noteViewerExpense.expense_date) : '-'}</span>
            </div>

            <div className="note-viewer-body">
              {getExpenseNote(noteViewerExpense) || t({ en: 'No note was added to this expense.', fr: 'Aucune note na ete ajoutee a cette depense.', ar: 'لم تتم إضافة ملاحظة إلى هذا المصروف.' })}
            </div>
            {noteViewerExpense.note_attachment_url ? (
              <div className="note-viewer-attachment">
                <UploadLink fileUrl={noteViewerExpense.note_attachment_url} label={t({ en: 'Open attachment', fr: 'Ouvrir la piece jointe', ar: 'فتح المرفق' })} />
              </div>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  )
}

function getExpenseNote(expense) {
  return String(expense?.note || '').trim()
}

function NotePreview({ expense, onOpen }) {
  const note = getExpenseNote(expense)
  const hasAttachment = Boolean(expense?.note_attachment_url)

  if (!note && !hasAttachment) {
    return <span className="subtle-text">{translate({ en: 'No note', fr: 'Aucune note', ar: 'لا توجد ملاحظة' })}</span>
  }

  return (
    <button type="button" className="note-preview-button" onClick={() => onOpen(expense)}>
      {translate({ en: 'Open Note', fr: 'Ouvrir la note', ar: 'فتح الملاحظة' })}
    </button>
  )
}

function getInitials(fullName) {
  const parts = String(fullName || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)

  if (!parts.length) {
    return '?'
  }

  return parts.map((part) => part[0]?.toUpperCase() || '').join('')
}

function formatGroupRole(role) {
  if (!role) {
    return translate({ en: 'Supervisor', fr: 'Superviseur', ar: 'مشرف' })
  }

  const labels = {
    responsable: translate({ en: 'Responsable', fr: 'Responsable', ar: 'Responsable' }),
    owner: translate({ en: 'Owner', fr: 'Proprietaire', ar: 'مالك' }),
    supervisor: translate({ en: 'Supervisor', fr: 'Superviseur', ar: 'مشرف' }),
    employee: translate({ en: 'Employee', fr: 'Employe', ar: 'موظف' }),
  }

  return labels[String(role).toLowerCase()] || String(role).charAt(0).toUpperCase() + String(role).slice(1)
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

function normalizeRefundAmount(value) {
  if (value == null || value === '') {
    return null
  }

  const parsedValue = Number(value)
  return Number.isFinite(parsedValue) ? parsedValue : value
}

function normalizeRefundCurrency(value) {
  const normalizedValue = String(value || '')
    .trim()
    .toUpperCase()

  return normalizedValue || null
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

function FraudSignalCell({ expense }) {
  const webSources = Array.isArray(expense.web_match_sources) ? expense.web_match_sources : []
  const rankedSources = [...webSources].sort(
    (left, right) => Number(right?.score || 0) - Number(left?.score || 0),
  )
  const topSource = rankedSources[0] || null
  const topReasons = Array.isArray(topSource?.reasons) ? topSource.reasons.slice(0, 3) : []
  const hasAnySources = rankedSources.length > 0

  return (
    <div className="suspicious-cell">
      {expense.is_suspicious ? (
        <span className="warning-badge">{translate({ en: 'Suspicious', fr: 'Suspect', ar: 'مشبوه' })}</span>
      ) : (
        <span className="subtle-text">{translate({ en: 'Clear', fr: 'Clair', ar: 'سليم' })}</span>
      )}

      {expense.suspicious_reason ? (
        <span className="suspicious-reason">{expense.suspicious_reason}</span>
      ) : null}

      {topSource ? (
        <span className="match-score">
          {translate({ en: 'Best web match score', fr: 'Meilleur score web', ar: 'أفضل نتيجة تطابق على الويب' })}: {Math.round(Number(topSource.score || 0))}/100
        </span>
      ) : null}

      {topReasons.length > 0 ? (
        <div className="match-reasons">
          {topReasons.map((reason) => (
            <span key={reason} className="subtle-text">
              {reason}
            </span>
          ))}
        </div>
      ) : null}

      {hasAnySources ? (
        <div className="match-links">
          {rankedSources.slice(0, 3).map((source, index) => (
            <a
              key={`${source.url || index}-${source.score || 0}`}
              href={source.url}
              target="_blank"
              rel="noreferrer"
              className="table-link"
            >
              {translate({ en: 'Open Match', fr: 'Ouvrir le resultat', ar: 'فتح النتيجة' })} {index + 1}
              {source.score ? ` (${Math.round(source.score)}/100)` : ''}
            </a>
          ))}
        </div>
      ) : null}

      {expense.web_match_checked_at && !expense.web_match_found && !hasAnySources ? (
        <span className="subtle-text">{translate({ en: 'Checked: no strong public web match found', fr: 'Verification faite : aucun resultat public solide trouve', ar: 'تم التحقق: لم يتم العثور على تطابق ويب قوي' })}</span>
      ) : null}
    </div>
  )
}

function ReceiptLink({ receiptUrl }) {
  const baseUrl = api.defaults.baseURL?.replace(/\/api$/, '') || 'http://localhost:5000'

  return (
    <a href={`${baseUrl}/uploads/${receiptUrl}`} target="_blank" rel="noreferrer" className="table-link">
      {translate({ en: 'View', fr: 'Voir', ar: 'عرض' })}
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

function buildHistoryQuery({ startDate, endDate }) {
  return {
    start_date: startDate || undefined,
    end_date: endDate || undefined,
  }
}

function sanitizeExportFileName(fullName) {
  return (
    String(fullName || 'employee')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'employee'
  )
}

export default SupervisorDashboardPage
