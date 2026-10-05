import axios from 'axios'
import { getActiveGroup } from './auth'

export const api = axios.create({
  baseURL: 'http://localhost:5000/api',
})

// Attach the saved token to every request after login.
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token')
  const activeGroup = getActiveGroup()

  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }

  if (activeGroup?.id) {
    config.headers['x-group-id'] = activeGroup.id
  }

  return config
})
