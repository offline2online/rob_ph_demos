/* Stand-in for the existing HQ Admin session (POC only). The role comes
   from the POC_ROLE env var — no switcher, no cookie. Engineering replaces
   this with the platform's own session and roles on integration.

   Who sees what (spec, "Who sees each section"; Rob, 20 Sep):
     hq_admin     everything, including DSP Integration, saving advertiser
                  settings, and approving or rejecting campaigns
     hq_marketing Display Types, Playlist Management, Advertisers /
                  Inventory (read-only on the per-advertiser settings) and
                  Campaign Status
     hq_helpdesk  none of it */
import type { Role, Session } from '@ph-dsp/types'

export type Scope = 'admin' | 'approver' | 'sections'

export interface SessionSource {
  current(): Session
}

const USERS: Record<Role, Session> = {
  hq_admin: { userId: 'u_hq_admin', name: 'HQ Admin (POC)', role: 'hq_admin' },
  hq_marketing: { userId: 'u_hq_marketing', name: 'HQ Marketing (POC)', role: 'hq_marketing' },
  hq_helpdesk: { userId: 'u_hq_helpdesk', name: 'HQ Help Desk (POC)', role: 'hq_helpdesk' },
}
const ROLES = Object.keys(USERS) as Role[]

const SCOPES: Record<Role, Scope[]> = {
  hq_admin: ['admin', 'approver', 'sections'],
  hq_marketing: ['sections'],
  hq_helpdesk: [],
}

export const envSession = (env: NodeJS.ProcessEnv = process.env): SessionSource => {
  const role = ROLES.includes(env.POC_ROLE as Role) ? (env.POC_ROLE as Role) : 'hq_admin'
  return { current: () => USERS[role] }
}
export const staticSession = (role: Role): SessionSource => ({ current: () => USERS[role] })

export const hasScope = (s: Session, scope: Scope) => SCOPES[s.role].includes(scope)
