/* Stand-in for the existing HQ Admin session (POC only). The role comes
   from the POC_ROLE env var — no switcher, no cookie. Engineering replaces
   this with the platform's own session on integration. */
import type { Role, Session } from '@ph-dsp/types'

export type Scope = 'admin' | 'approver'

export interface SessionSource {
  current(): Session
}

const USERS: Record<Role, Session> = {
  hq_admin: { userId: 'u_hq_admin', name: 'HQ Admin (POC)', role: 'hq_admin' },
  hq_user: { userId: 'u_hq_user', name: 'HQ User (POC)', role: 'hq_user' },
}

export const envSession = (env: NodeJS.ProcessEnv = process.env): SessionSource => {
  const role: Role = env.POC_ROLE === 'hq_user' ? 'hq_user' : 'hq_admin'
  return { current: () => USERS[role] }
}
export const staticSession = (role: Role): SessionSource => ({ current: () => USERS[role] })

/* hq_admin = admin + approver; hq_user = neither. */
export const hasScope = (s: Session, scope: Scope) => s.role === 'hq_admin' && (scope === 'admin' || scope === 'approver')
