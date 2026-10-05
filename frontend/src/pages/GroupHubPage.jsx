import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../services/api'
import {
  clearActiveGroup,
  clearAuth,
  getActiveGroup,
  getUser,
  saveActiveGroup,
} from '../services/auth'
import { translate } from '../services/i18n'

function GroupHubPage() {
  const navigate = useNavigate()
  const t = translate
  const currentUserRole = getUser()?.role
  const [groups, setWorkspaces] = useState([])
  const [membershipRequests, setMembershipRequests] = useState([])
  const [joinRequests, setJoinRequests] = useState([])
  const [activeGroup, setActiveGroupState] = useState(getActiveGroup())
  const [createGroupName, setCreateGroupName] = useState('')
  const [inviteCode, setInviteCode] = useState('')
  const [error, setError] = useState('')
  const [successMessage, setSuccessMessage] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isCreating, setIsCreating] = useState(false)
  const [isRequesting, setIsRequesting] = useState(false)
  const [activeReviewId, setActiveReviewId] = useState('')

  const fetchWorkspaces = useCallback(async () => {
    try {
      setError('')
      const response = await api.get('/groups')
      setWorkspaces(Array.isArray(response.data?.groups) ? response.data.groups : [])
      setMembershipRequests(
        Array.isArray(response.data?.membership_requests) ? response.data.membership_requests : [],
      )
    } catch (requestError) {
      if (requestError.response?.status === 401) {
        clearAuth()
        navigate('/login')
        return
      }

      setError(
        requestError.response?.data?.message ||
          requestError.message ||
          'Unable to load your workspaces.',
      )
    } finally {
      setIsLoading(false)
    }
  }, [navigate])

  const fetchJoinRequests = useCallback(async (group) => {
    if (!group || !canReviewJoinRequests(group, currentUserRole)) {
      setJoinRequests([])
      return
    }

    try {
      const response = await api.get('/groups/join-requests', {
        headers: {
          'x-group-id': group.id,
        },
      })

      setJoinRequests(Array.isArray(response.data?.requests) ? response.data.requests : [])
    } catch (requestError) {
      if (requestError.response?.status === 401) {
        clearAuth()
        navigate('/login')
        return
      }

      setError(
        requestError.response?.data?.message ||
          requestError.message ||
          'Unable to load join requests.',
      )
    }
  }, [currentUserRole, navigate])

  useEffect(() => {
    fetchWorkspaces()
  }, [fetchWorkspaces])

  useEffect(() => {
    if (!groups.length) {
      clearActiveGroup()
      setActiveGroupState(null)
      setJoinRequests([])
      return
    }

    const storedGroup = getActiveGroup()
    const matchingGroup = storedGroup
      ? groups.find((group) => Number(group.id) === Number(storedGroup.id))
      : null
    const nextGroup = matchingGroup || groups[0]

    saveActiveGroup(nextGroup)
    setActiveGroupState(nextGroup)
    fetchJoinRequests(nextGroup)
  }, [fetchJoinRequests, groups])

  useEffect(() => {
    const refreshRequests = () => {
      fetchWorkspaces()

      if (activeGroup && canReviewJoinRequests(activeGroup, currentUserRole)) {
        fetchJoinRequests(activeGroup)
      }
    }

    const intervalId = window.setInterval(refreshRequests, 10000)
    window.addEventListener('focus', refreshRequests)

    return () => {
      window.clearInterval(intervalId)
      window.removeEventListener('focus', refreshRequests)
    }
  }, [activeGroup, currentUserRole, fetchWorkspaces, fetchJoinRequests])

  const handleCreateGroup = async (event) => {
    event.preventDefault()
    if (!createGroupName.trim()) {
      setError(t({
        en: 'Please enter a workspace name.',
        fr: "Veuillez saisir un nom d'espace de travail.",
        ar: 'يرجى ادخال اسم مساحة العمل.',
      }))
      return
    }

    setIsCreating(true)
    setError('')
    setSuccessMessage('')

    try {
      const response = await api.post('/groups', {
        name: createGroupName.trim(),
      })

      const createdGroup = response.data?.group
      if (createdGroup) {
        saveActiveGroup(createdGroup)
        setActiveGroupState(createdGroup)
      }

      setCreateGroupName('')
      setSuccessMessage(t({
        en: 'Workspace created successfully.',
        fr: 'Espace de travail cree avec succes.',
        ar: 'تم انشاء مساحة العمل بنجاح.',
      }))
      await fetchWorkspaces()
    } catch (requestError) {
      setError(
        requestError.response?.data?.message ||
          requestError.message ||
          'Unable to create the workspace.',
      )
    } finally {
      setIsCreating(false)
    }
  }

  const handleJoinGroup = async (event) => {
    event.preventDefault()
    if (!inviteCode.trim()) {
      setError(t({
        en: 'Please enter the workspace invite code.',
        fr: "Veuillez saisir le code d'invitation de l'espace de travail.",
        ar: 'يرجى ادخال رمز دعوة مساحة العمل.',
      }))
      return
    }

    setIsRequesting(true)
    setError('')
    setSuccessMessage('')

    try {
      await api.post('/groups/join-requests', {
        invite_code: inviteCode.trim().toUpperCase(),
      })
      setInviteCode('')
      setSuccessMessage(t({
        en: 'Join request sent. Wait for the workspace owner to approve it.',
        fr: "Demande envoyee. Attendez l'approbation du proprietaire.",
        ar: 'تم ارسال طلب الانضمام. انتظر موافقة المشرف.',
      }))
      await fetchWorkspaces()
    } catch (requestError) {
      setError(
        requestError.response?.data?.message ||
          requestError.message ||
          'Unable to request access to that workspace.',
      )
    } finally {
      setIsRequesting(false)
    }
  }

  const handleSelectGroup = (group) => {
    saveActiveGroup(group)
    setActiveGroupState(group)
    fetchJoinRequests(group)
    navigate(getPathForGroup(group))
  }

  const handleReviewRequest = async (requestId, status, role = 'employee') => {
    if (!activeGroup) {
      return
    }

    try {
      setActiveReviewId(String(requestId))
      setError('')
      setSuccessMessage('')

      await api.put(`/groups/join-requests/${requestId}`, { status, role })
      setSuccessMessage(
        status === 'approved'
          ? t({
              en: 'Employee added to the workspace.',
              fr: "Employe ajoute a l'espace de travail.",
              ar: 'تمت اضافة الموظف الى مساحة العمل.',
            })
          : t({
              en: 'Join request rejected.',
              fr: 'Demande refusee.',
              ar: 'تم رفض طلب الانضمام.',
            }),
      )
      await Promise.all([fetchWorkspaces(), fetchJoinRequests(activeGroup)])
    } catch (requestError) {
      setError(
        requestError.response?.data?.message ||
          requestError.message ||
          'Unable to review the join request.',
      )
    } finally {
      setActiveReviewId('')
    }
  }

  const handleLogout = () => {
    clearAuth()
    navigate('/login')
  }

  return (
    <div className="page-shell">
      <div className="page-header">
        <div>
          <h1>{t({ en: 'Workspaces', fr: 'Espaces de travail', ar: 'مساحات العمل' })}</h1>
          <p className="subtitle">
            {t({
              en: 'Create a private workspace, join one with an invite code, and open your dashboard.',
              fr: "Creez un espace prive, rejoignez-en un avec un code d'invitation et ouvrez votre tableau de bord.",
              ar: 'انشئ مساحة عمل خاصة، وانضم باستخدام رمز الدعوة، ثم افتح لوحة التحكم الخاصة بك.',
            })}
          </p>
        </div>
        <div className="header-actions">
          <button type="button" className="secondary-button" onClick={handleLogout}>
            {t({ en: 'Logout', fr: 'Deconnexion', ar: 'تسجيل الخروج' })}
          </button>
        </div>
      </div>

      <div className="card workspace-summary-card">
        <div>
          <h2>{t({ en: 'Active Workspace', fr: 'Espace de travail actif', ar: 'مساحة العمل النشطة' })}</h2>
          <p className="subtitle">
            {activeGroup
              ? `${activeGroup.name} (${formatRole(activeGroup.role)})`
              : t({
                  en: 'Pick a workspace or create a new one to continue.',
                  fr: 'Choisissez un espace de travail ou creez-en un nouveau pour continuer.',
                  ar: 'اختر مساحة عمل او انشئ مساحة عمل جديدة للمتابعة.',
                })}
          </p>
        </div>
        {activeGroup ? (
          <div className="workspace-meta">
            <span className="status-badge status-approved">{formatRole(activeGroup.role)}</span>
          </div>
        ) : null}
      </div>

      {error ? <p className="message error">{error}</p> : null}
      {successMessage ? <p className="message success">{successMessage}</p> : null}

      <div className="group-layout">
        <div className="card">
          <h2>{t({ en: 'Your Workspaces', fr: 'Vos espaces', ar: 'مساحات العمل الخاصة بك' })}</h2>
          <p className="subtitle">
            {t({
              en: 'Switch between workspaces you belong to.',
              fr: 'Passez dun espace de travail a un autre.',
              ar: 'تنقل بين مساحات العمل التي تنتمي اليها.',
            })}
          </p>

          {isLoading ? <p>{t({ en: 'Loading your workspaces...', fr: 'Chargement des espaces de travail...', ar: 'جاري تحميل مساحات العمل الخاصة بك...' })}</p> : null}
          {!isLoading && groups.length === 0 ? (
            <p>{t({ en: 'You are not a member of any workspace yet.', fr: "Vous n'etes membre d'aucun espace de travail pour le moment.", ar: 'لست عضوا في اي مساحة عمل حتى الان.' })}</p>
          ) : null}

          <div className="group-list">
            {groups.map((group) => {
              const isActive = Number(activeGroup?.id) === Number(group.id)

              return (
                <div key={group.id} className={`group-card ${isActive ? 'group-card-active' : ''}`}>
                  <div className="group-card-header">
                    <div>
                      <strong>{group.name}</strong>
                      <p className="subtitle">/{group.slug}</p>
                    </div>
                    <span className="status-badge status-approved">{formatRole(group.role)}</span>
                  </div>

                  <div className="group-card-meta">
                    <span>{group.member_count} {t({ en: 'members', fr: 'membres', ar: 'اعضاء' })}</span>
                    <span>{group.pending_request_count} {t({ en: 'pending requests', fr: 'demandes en attente', ar: 'طلبات معلقة' })}</span>
                  </div>

                  <div className="group-card-actions">
                    <button
                      type="button"
                      className="primary-link-button"
                      onClick={() => handleSelectGroup(group)}
                    >
                      {t({ en: 'Open', fr: 'Ouvrir', ar: 'فتح' })}
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        <div className="group-side-column">
          <div className="card">
            <h2>{t({ en: 'Create Workspace', fr: 'Creer un espace de travail', ar: 'انشاء مساحة عمل' })}</h2>
            <p className="subtitle">
              {t({
                en: 'Start a private workspace and become its owner.',
                fr: 'Demarrez un espace prive et devenez son proprietaire.',
                ar: 'ابدأ مساحة عمل خاصة وكن مالكها.',
              })}
            </p>

            <form onSubmit={handleCreateGroup} className="form">
              <label>
                {t({ en: 'Workspace Name', fr: "Nom de l'espace de travail", ar: 'اسم مساحة العمل' })}
                <input
                  type="text"
                  value={createGroupName}
                  onChange={(event) => setCreateGroupName(event.target.value)}
                  placeholder={t({ en: 'Acme Finance Team', fr: 'Equipe Finance Acme', ar: 'فريق اكما المالي' })}
                  required
                />
              </label>

              <button type="submit" disabled={isCreating}>
                {isCreating
                  ? t({ en: 'Creating...', fr: 'Creation...', ar: 'جاري الانشاء...' })
                  : t({ en: 'Create Workspace', fr: 'Creer un espace de travail', ar: 'انشاء مساحة عمل' })}
              </button>
            </form>
          </div>

          <div className="card">
            <h2>{t({ en: 'Join Workspace', fr: 'Rejoindre un espace de travail', ar: 'الانضمام الى مساحة عمل' })}</h2>
            <p className="subtitle">
              {t({
                en: 'Ask to join an existing workspace as an employee.',
                fr: 'Demandez a rejoindre un espace existant en tant qu employe.',
                ar: 'اطلب الانضمام الى مساحة عمل موجودة كموظف.',
              })}
            </p>

            <form onSubmit={handleJoinGroup} className="form">
              <label>
                {t({ en: 'Invite Code', fr: "Code d'invitation", ar: 'رمز الدعوة' })}
                <input
                  type="text"
                  value={inviteCode}
                  onChange={(event) => setInviteCode(event.target.value.toUpperCase())}
                  placeholder="AB12CD34"
                  required
                />
              </label>

              <button type="submit" disabled={isRequesting}>
                {isRequesting
                  ? t({ en: 'Sending...', fr: 'Envoi...', ar: 'جاري الارسال...' })
                  : t({ en: 'Request Access', fr: "Demander l'acces", ar: 'طلب الوصول' })}
              </button>
            </form>
          </div>
        </div>
      </div>

      <div className="group-layout">
        <div className="card">
          <h2>{t({ en: 'Your Membership Requests', fr: 'Vos demandes d adhesion', ar: 'طلبات الانضمام الخاصة بك' })}</h2>
          <p className="subtitle">
            {t({
              en: 'Track the workspaces you asked to join.',
              fr: 'Suivez les espaces de travail que vous avez demandes.',
              ar: 'تابع مساحات العمل التي طلبت الانضمام اليها.',
            })}
          </p>

          {membershipRequests.length === 0 ? (
            <p>{t({ en: 'No membership requests yet.', fr: "Aucune demande d adhesion pour le moment.", ar: 'لا توجد طلبات انضمام حتى الان.' })}</p>
          ) : (
            <div className="group-list">
              {membershipRequests.map((request) => (
                <div key={request.id} className="group-card">
                  <div className="group-card-header">
                    <strong>{request.group_name}</strong>
                    <span className={`status-badge status-${request.status}`}>
                      {request.status}
                    </span>
                  </div>
                  <div className="group-card-meta">
                    <span>{t({ en: 'Invite', fr: 'Invitation', ar: 'الدعوة' })}: {request.invite_code}</span>
                    <span>{t({ en: 'Requested role', fr: 'Role demande', ar: 'الدور المطلوب' })}: {formatRole(request.requested_role)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card">
          <h2>{t({ en: 'Pending Employee Requests', fr: 'Demandes employees en attente', ar: 'طلبات الموظفين المعلقة' })}</h2>
          <p className="subtitle">
            {activeGroup && canReviewJoinRequests(activeGroup, currentUserRole)
              ? t({
                  en: `Review pending requests for ${activeGroup.name}.`,
                  fr: `Examinez les demandes en attente pour ${activeGroup.name}.`,
                  ar: `راجع الطلبات المعلقة الخاصة بمساحة العمل ${activeGroup.name}.`,
                })
              : t({
                  en: 'Select a workspace where you are the owner to manage requests.',
                  fr: 'Selectionnez un espace de travail dont vous etes proprietaire.',
                  ar: 'اختر مساحة عمل تكون فيها مالكا او مشرفا لادارة الطلبات.',
                })}
          </p>

          {!activeGroup || !canReviewJoinRequests(activeGroup, currentUserRole) ? (
            <p>{t({ en: 'Only the workspace owner can review join requests.', fr: "Seul le proprietaire de l'espace de travail peut examiner les demandes.", ar: 'تحتاج الى دور مالك او مشرف في مساحة العمل النشطة لمراجعة الطلبات.' })}</p>
          ) : joinRequests.length === 0 ? (
            <p>{t({ en: 'No pending employee requests for this workspace.', fr: "Aucune demande employee en attente pour cet espace de travail.", ar: 'لا توجد طلبات موظفين معلقة لمساحة العمل هذه.' })}</p>
          ) : (
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
                      disabled={activeReviewId === String(request.id)}
                      onClick={() => handleReviewRequest(request.id, 'approved')}
                    >
                      {activeReviewId === String(request.id)
                        ? t({ en: 'Saving...', fr: 'Enregistrement...', ar: 'جاري الحفظ...' })
                        : t({ en: 'Approve Employee', fr: 'Approuver employe', ar: 'موافقة' })}
                    </button>
                    <button
                      type="button"
                      className="approve-button"
                      disabled={activeReviewId === String(request.id)}
                      onClick={() => handleReviewRequest(request.id, 'approved', 'responsable')}
                    >
                      {t({ en: 'Approve Responsable', fr: 'Approuver responsable', ar: 'موافقة' })}
                    </button>
                    <button
                      type="button"
                      className="reject-button"
                      disabled={activeReviewId === String(request.id)}
                      onClick={() => handleReviewRequest(request.id, 'rejected')}
                    >
                      {t({ en: 'Reject', fr: 'Refuser', ar: 'رفض' })}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function isManagerRole(role) {
  return role === 'owner' || role === 'responsable' || role === 'supervisor'
}

function canReviewJoinRequests(group, userRole) {
  return group?.role === 'owner' || userRole === 'admin'
}

function getPathForGroup(group) {
  return isManagerRole(group?.role) ? '/supervisor' : '/dashboard'
}

function formatRole(role) {
  if (!role) {
    return translate({ en: 'Member', fr: 'Membre', ar: 'عضو' })
  }

  const roleLabels = {
    responsable: { en: 'Responsable', fr: 'Responsable', ar: 'Responsable' },
    owner: { en: 'Owner', fr: 'Proprietaire', ar: 'مالك' },
    supervisor: { en: 'Supervisor', fr: 'Superviseur', ar: 'مشرف' },
    employee: { en: 'Employee', fr: 'Employe', ar: 'موظف' },
    pending: { en: 'Pending', fr: 'En attente', ar: 'قيد الانتظار' },
    rejected: { en: 'Rejected', fr: 'Refuse', ar: 'مرفوض' },
    approved: { en: 'Approved', fr: 'Approuve', ar: 'تمت الموافقة' },
  }

  return translate(roleLabels[role] || { en: role, fr: role, ar: role })
}

export default GroupHubPage
