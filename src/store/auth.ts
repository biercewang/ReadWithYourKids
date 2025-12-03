import { create } from 'zustand'
import { supabase, isSupabaseConfigured } from '../lib/supabase'
import { User } from '../types/database'
import { newId } from '../utils/id'

interface AuthState {
  user: User | null
  isAuthenticated: boolean
  isLoading: boolean
  signIn: (email: string, password: string) => Promise<void>
  signUp: (email: string, password: string, name: string, inviteCode: string) => Promise<void>
  signOut: () => Promise<void>
  checkAuth: () => Promise<void>
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>
}

const loadDemoUser = (): User => {
  try {
    const raw = localStorage.getItem('demo_user')
    if (raw) return JSON.parse(raw)
  } catch {}
  const demo: User = {
    id: newId(),
    email: 'demo@example.com',
    name: '演示用户',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
  try { localStorage.setItem('demo_user', JSON.stringify(demo)) } catch {}
  return demo
}

export const useAuthStore = create<AuthState>((set) => ({
  user: isSupabaseConfigured ? null : loadDemoUser(),
  isAuthenticated: isSupabaseConfigured ? false : true,
  isLoading: isSupabaseConfigured ? true : false,

  signIn: async (email: string, password: string) => {
    try {
      if (!isSupabaseConfigured || !supabase) {
        const demoRaw = localStorage.getItem('demo_user')
        if (demoRaw) {
          const demoUser = JSON.parse(demoRaw)
          set({ user: demoUser, isAuthenticated: true, isLoading: false })
          return
        }
        const demoUser = {
          id: crypto.randomUUID(),
          email,
          name: '演示用户',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }
        localStorage.setItem('demo_user', JSON.stringify(demoUser))
        set({ user: demoUser, isAuthenticated: true, isLoading: false })
        return
      }
      let loginEmail = email
      const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(loginEmail)
      if (!isEmail) {
        const { data: found } = await supabase
          .from('users')
          .select('email')
          .eq('name', loginEmail)
          .order('created_at', { ascending: false })
          .maybeSingle()
        if (!found?.email) {
          throw new Error('未找到该用户名，请使用注册邮箱或正确的用户名登录')
        }
        loginEmail = found.email as string
      }
      const { data, error } = await supabase.auth.signInWithPassword({
        email: loginEmail,
        password,
      })
      
      if (error) {
        const m = (error as { message?: string }).message || String(error)
        if (typeof m === 'string' && /confirm/i.test(m)) {
          throw new Error('邮箱未验证，请先在邮箱中点击确认链接')
        }
        throw error
      }
      
      if (data.user) {
        const { data: userData } = await supabase
          .from('users')
          .select('*')
          .eq('id', data.user.id)
          .single()
        
        if (userData) {
          set({ user: userData, isAuthenticated: true, isLoading: false })
        }
      }
    } catch (error) {
      console.error('Sign in error:', error)
      throw error
    }
  },

  signUp: async (email: string, password: string, name: string, inviteCode: string) => {
    try {
      const inviteExpected = ((import.meta as any).env?.VITE_INVITE_CODE as string) || ''
      if (inviteExpected && (inviteCode || '').trim() !== inviteExpected) {
        throw new Error('邀请码错误')
      }
      if (!isSupabaseConfigured || !supabase) {
        const demoUser = {
          id: crypto.randomUUID(),
          email,
          name,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }
        localStorage.setItem('demo_user', JSON.stringify(demoUser))
        set({ user: demoUser, isAuthenticated: true, isLoading: false })
        return
      }
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { invited: true, invite_code: inviteExpected || (inviteCode || '').trim() } }
      })
      
      if (error) throw error
      
      if (data.user) {
        const metaInvited = (data.user as any)?.user_metadata?.invited === true
        if (!metaInvited) {
          throw new Error('未通过邀请码注册')
        }
        const { data: userData, error: insertError } = await supabase
          .from('users')
          .insert([
            {
              id: data.user.id,
              email,
              name,
              password_hash: 'placeholder', // Will be handled by Supabase Auth
            }
          ])
          .select()
          .single()
        
        if (insertError) throw insertError
        
        set({ user: userData, isAuthenticated: true, isLoading: false })
      }
    } catch (error) {
      console.error('Sign up error:', error)
      throw error
    }
  },

  signOut: async () => {
    try {
      if (isSupabaseConfigured && supabase) {
        await supabase.auth.signOut()
        set({ user: null, isAuthenticated: false, isLoading: false })
        return
      }
      set({ user: loadDemoUser(), isAuthenticated: true, isLoading: false })
    } catch (error) {
      console.error('Sign out error:', error)
      throw error
    }
  },

  checkAuth: async () => {
    try {
      if (!isSupabaseConfigured || !supabase) {
        const demo = loadDemoUser()
        set({ user: demo, isAuthenticated: true, isLoading: false })
        return
      }
      const { data } = await supabase.auth.getSession()
      const sessionUserId = data.session?.user?.id || ''
      if (sessionUserId) {
        const { data: userData } = await supabase
          .from('users')
          .select('*')
          .eq('id', sessionUserId)
          .maybeSingle()
        if (!userData) {
          const { data: inserted } = await supabase
            .from('users')
            .insert([{ id: sessionUserId, email: data.session?.user?.email || '', name: data.session?.user?.user_metadata?.name || '用户' }])
            .select()
            .single()
          set({ user: inserted as User, isAuthenticated: true, isLoading: false })
          return
        }
        set({ user: userData as User, isAuthenticated: true, isLoading: false })
        return
      }
      set({ user: null, isAuthenticated: false, isLoading: false })
    } catch (error) {
      console.error('Auth check error:', error)
      set({ user: null, isAuthenticated: false, isLoading: false })
    }
  },

  changePassword: async (currentPassword: string, newPassword: string) => {
    try {
      if (!isSupabaseConfigured || !supabase) {
        return
      }
      const { data: sessionData } = await supabase.auth.getSession()
      const email = sessionData?.session?.user?.email || ''
      if (!email) {
        throw new Error('未登录或会话已过期')
      }
      const { error: verifyError } = await supabase.auth.signInWithPassword({ email, password: currentPassword })
      if (verifyError) {
        throw new Error('当前密码不正确')
      }
      const { error: updateError } = await supabase.auth.updateUser({ password: newPassword })
      if (updateError) {
        throw new Error(updateError.message || '修改密码失败')
      }
    } catch (error) {
      console.error('Change password error:', error)
      throw error
    }
  },
}))
