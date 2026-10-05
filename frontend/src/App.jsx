import { useEffect, useState } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import SettingsPanel from './components/SettingsPanel'
import DashboardPage from './pages/DashboardPage'
import GroupHubPage from './pages/GroupHubPage'
import LoginPage from './pages/LoginPage'
import RegisterPage from './pages/RegisterPage'
import ScanReceiptPage from './pages/ScanReceiptPage'
import SupervisorDashboardPage from './pages/SupervisorDashboardPage'
import { getActiveGroup, getHomePath, getRole, getToken, getUser } from './services/auth'
import {
  applyPreferences,
  getDefaultPreferences,
  loadPreferences,
  savePreferences,
} from './services/preferences'

function ProtectedRoute({ children, allowedRoles, requireGroup = false }) {
  const token = getToken()
  const role = getRole()
  const user = getUser()
  const activeGroup = getActiveGroup()

  if (!token) {
    return <Navigate to="/login" replace />
  }

  if (requireGroup && !activeGroup) {
    return <Navigate to="/groups" replace />
  }

  if (allowedRoles && !allowedRoles.includes(role) && user?.role !== 'admin') {
    return <Navigate to={getHomePath()} replace />
  }

  return children
}

function App() {
  const [preferences, setPreferences] = useState(() => loadPreferences())

  useEffect(() => {
    applyPreferences(preferences)
    savePreferences(preferences)
  }, [preferences])

  return (
    <>
      <Routes>
        <Route path="/" element={<Navigate to={getHomePath()} replace />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route
          path="/groups"
          element={
            <ProtectedRoute>
              <GroupHubPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute allowedRoles={['employee', 'responsable', 'supervisor', 'owner']} requireGroup>
              <DashboardPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/scan-receipt"
          element={
            <ProtectedRoute allowedRoles={['employee', 'responsable', 'supervisor', 'owner']} requireGroup>
              <ScanReceiptPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/supervisor"
          element={
            <ProtectedRoute allowedRoles={['responsable', 'supervisor', 'owner']} requireGroup>
              <SupervisorDashboardPage />
            </ProtectedRoute>
          }
        />
      </Routes>

      <SettingsPanel
        preferences={preferences}
        onChange={setPreferences}
        onReset={() => setPreferences(getDefaultPreferences())}
      />
    </>
  )
}

export default App
