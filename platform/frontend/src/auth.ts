import { computed, ref } from 'vue'
import type { AuthSession, AuthUser, UserRole } from './api/types'


export const SESSION_STORAGE_KEY = 'ai-requirement-hub-session'
export const TEST_ROLE_STORAGE_KEY = 'ai-requirement-hub-test-role'
const testSwitchMode =
  import.meta.env.VITE_AUTH_MODE === 'test_switch' ||
  (import.meta.env.DEV && import.meta.env.VITE_AUTH_MODE !== 'accounts')

function readSession(): AuthSession | null {
  try {
    const raw = window.localStorage.getItem(SESSION_STORAGE_KEY)
    if (!raw) return null
    const value = JSON.parse(raw) as AuthSession
    return value.accessToken && value.user ? value : null
  } catch {
    return null
  }
}

const session = ref<AuthSession | null>(readSession())
const testRole = ref<UserRole>(readTestRole())

function readTestRole(): UserRole {
  const value = window.localStorage.getItem(TEST_ROLE_STORAGE_KEY)
  return value === 'reviewer' ? 'reviewer' : 'requester'
}

function testUser(role: UserRole): AuthUser {
  return {
    id: role === 'reviewer' ? 'test-reviewer' : 'test-requester',
    displayName: role === 'reviewer' ? '测试评审人' : '测试需求人',
    username: role === 'reviewer' ? 'test-reviewer' : 'test-requester',
    role,
  }
}

export function currentAccessToken() {
  if (testSwitchMode) return ''
  return session.value?.accessToken ?? ''
}

export function currentTestRole(): UserRole | null {
  return testSwitchMode ? testRole.value : null
}

export function getSession() {
  if (testSwitchMode) {
    return {
      accessToken: '',
      user: testUser(testRole.value),
    }
  }
  return session.value
}

export function setSession(value: AuthSession) {
  if (testSwitchMode) return
  session.value = value
  window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(value))
}

export function clearSession() {
  if (testSwitchMode) return
  session.value = null
  window.localStorage.removeItem(SESSION_STORAGE_KEY)
}

export function switchTestRole(role: UserRole) {
  if (!testSwitchMode) return
  testRole.value = role
  window.localStorage.setItem(TEST_ROLE_STORAGE_KEY, role)
}

export function useAuth() {
  const user = computed(() => (testSwitchMode ? testUser(testRole.value) : session.value?.user ?? null))
  return {
    session,
    user,
    isTestSwitchMode: testSwitchMode,
    testRole,
    isReviewer: computed(() => user.value?.role === 'reviewer'),
    isRequester: computed(() => user.value?.role === 'requester'),
  }
}
