/* STAND-IN — one campaign, laid out like the platform's own campaign page
   (demo.personalisationhub.com/hq-admin/campaigns/details/…): the name and
   status in the header, then Campaign Brief, Targeting, Scheduling,
   Storyboard & Copy and Creative. Read-only, because this build doesn't
   author campaigns: it shows what the advertiser submitted, and lets the
   retailer approve, reject or switch it on (Rob, 20 Sep). Goes with the
   rest of this folder on integration. */
import { useQuery } from '@tanstack/react-query'
import { Button, Spin, Switch, Tabs, Tag } from 'antd'
import { ApprovalActions, ApprovalReviewPanel, ApprovalStatusBadge } from '@ph-dsp/campaign-approval/ui'
import type { BookingSchedule, CampaignBrief } from '@ph-dsp/types'
import type { ReactNode } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { api } from '../../api/client'
import { Icon } from '../../shared/Icon'
import { SectionLabel } from '../../shared/SectionLabel'
import { T } from '../../theme/phTheme'
import { CAMPAIGN_STATUS_PATH, useCampaign, useCampaignActions } from './useCampaigns'

const Empty = ({ icon, children }: { icon: string; children: ReactNode }) => (
  <div className="flex items-center gap-2 py-6" style={{ fontSize: 12.5, color: T.muted }}>
    <Icon name={icon} size={20} />
    <span>{children}</span>
  </div>
)

/* A read-only brief field, as the platform's Campaign Brief tab lays them out. */
const BriefField = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="mb-4">
    <div className="mb-1.5" style={{ fontSize: 14, color: T.muted }}>{label}</div>
    <div style={{ fontSize: 14 }}>{children ?? <span style={{ color: T.micro }}>Not provided</span>}</div>
  </div>
)
const Tags = ({ items }: { items?: string[] }) =>
  items?.length ? <>{items.map((x) => <Tag key={x} style={{ marginBottom: 4 }}>{x}</Tag>)}</> : null

function Brief({ name, brief }: { name: string; brief?: CampaignBrief }) {
  return (
    <div className="max-w-[760px]">
      <BriefField label="Campaign Name">{name}</BriefField>
      <BriefField label="Campaign Details">{brief?.details}</BriefField>
      <BriefField label="Campaign Landing Page URL">{brief?.landingPageUrl}</BriefField>
      <BriefField label="Promoted Product(s)"><Tags items={brief?.promotedProducts} /></BriefField>
      <BriefField label="Product SKU(s)"><Tags items={brief?.skus} /></BriefField>
      <BriefField label="Target Audience(s)"><Tags items={brief?.targetAudiences} /></BriefField>
      <BriefField label="Campaign Objective">{brief?.objective}</BriefField>
      <SectionLabel>Enabled touch-point(s)</SectionLabel>
      <BriefField label="Booked for"><Tags items={brief?.touchPoints} /></BriefField>
      {!brief && <Empty icon="info">This advertiser sent no brief with its booking. The Partner API takes one on <code>POST /v1/campaigns</code>.</Empty>}
    </div>
  )
}

/* The targeting the advertiser submitted, as the approval module summarises
   it. This build validates and stores rules; the platform evaluates them. */
function Targeting({ summary }: { summary?: string }) {
  const lines = (summary ?? '').split('\n').filter(Boolean)
  if (!lines.length) return <Empty icon="tune">No targeting rules: this campaign plays as the baseline everywhere it is booked.</Empty>
  return (
    <ul className="m-0 list-none overflow-hidden rounded-md border p-0" style={{ borderColor: T.borderSubtle }}>
      {lines.map((line, i) => (
        <li key={line} className="px-3 py-2.5" style={{ fontSize: 13, borderBottom: i < lines.length - 1 ? `1px solid ${T.borderSubtle}` : 'none' }}>{line}</li>
      ))}
    </ul>
  )
}

/* When and where it plays: the windows this campaign has won or reserved. */
function Scheduling({ campaignId, currency }: { campaignId: string; currency: string }) {
  const schedule = useQuery({ queryKey: ['booking-schedule', campaignId], queryFn: () => api<BookingSchedule>('GET', `/admin/v1/booking-schedule?campaignId=${encodeURIComponent(campaignId)}`) })
  if (!schedule.data) return <Spin />
  const rows = schedule.data.positions.flatMap((p) => p.windows.filter((w) => w.booking).map((w) => ({ p, w })))
  if (!rows.length) return <Empty icon="event_busy">No play windows booked yet. A window is booked when the advertiser reserves it or wins the auction.</Empty>
  const money = new Intl.NumberFormat('en-AU', { style: 'currency', currency })
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
      <thead>
        <tr style={{ textAlign: 'left', color: '#181d1f' }}>
          {['Play window', 'Display type', 'Slot', 'How', 'CPM', 'Booked revenue'].map((h) => (
            <th key={h} style={{ fontSize: 13, fontWeight: 700, padding: '8px 12px 8px 0', borderBottom: `1px solid ${T.border}` }}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map(({ p, w }) => (
          <tr key={`${p.positionId}-${w.start}`}>
            <td style={{ padding: '8px 12px 8px 0', borderBottom: `1px solid ${T.borderSubtle}` }}>
              {new Date(w.start).toLocaleString('en-GB', { timeZone: 'UTC', dateStyle: 'medium', timeStyle: 'short' })} UTC
            </td>
            <td style={{ padding: '8px 12px 8px 0', borderBottom: `1px solid ${T.borderSubtle}` }}>{p.displayTypeName}</td>
            <td style={{ padding: '8px 12px 8px 0', borderBottom: `1px solid ${T.borderSubtle}`, color: T.muted }}>{p.slot} · {p.slotLabel}</td>
            <td style={{ padding: '8px 12px 8px 0', borderBottom: `1px solid ${T.borderSubtle}` }}>{w.booking!.type === 'reserve' ? 'Reserved' : 'Won at auction'}</td>
            <td style={{ padding: '8px 12px 8px 0', borderBottom: `1px solid ${T.borderSubtle}` }}>{w.booking!.cpm}</td>
            <td style={{ padding: '8px 12px 8px 0', borderBottom: `1px solid ${T.borderSubtle}` }}>{money.format(w.booking!.bookedRevenue)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export function CampaignDetail() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const campaign = useCampaign(id)
  const { approvals, canApprove, busy, approve, reject, unreject, activate } = useCampaignActions(id ? [id] : [])
  const approval = approvals[id]
  const c = campaign.data
  if (!c) return campaign.isLoading ? <Spin /> : <Empty icon="search_off">That campaign is not one an advertiser or DSP submitted.</Empty>

  return (
    <div>
      <Button color="primary" variant="text" className="mb-2 px-0" icon={<Icon name="arrow_back" size={16} />} onClick={() => navigate(CAMPAIGN_STATUS_PATH)}>Campaign Status</Button>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h2 className="m-0 flex-1" style={{ fontSize: 20, fontWeight: 700 }}>{c.name}</h2>
        <span style={{ fontSize: 12.5, color: T.muted }}>Status</span>
        {approval ? <ApprovalStatusBadge status={approval.status} mode={approval.mode} /> : <Spin size="small" />}
        {approval && (
          <ApprovalActions status={approval.status} canApprove={canApprove} busy={busy === id} onApprove={() => approve(approval)} onReject={(r) => reject(approval, r)}>
            <span className="inline-flex items-center gap-2" style={{ fontSize: 12.5, color: T.muted }}>
              Activated
              <Switch aria-label={`${c.name}: activation`} checked={c.activation.enabled} loading={busy === id} onChange={(v) => activate(c, v)} />
            </span>
          </ApprovalActions>
        )}
      </div>
      <div className="mb-3" style={{ fontSize: 12.5, color: T.muted }}>
        {c.advertiserName ?? 'Unknown advertiser'} · via {c.partnerName ?? 'Unknown DSP'} · {c.source === 'dsp' ? 'Submitted through the DSP' : 'Submitted through the Partner API'}
      </div>

      <Tabs
        items={[
          { key: 'brief', label: 'Campaign Brief', children: <Brief name={c.name} brief={c.brief} /> },
          { key: 'targeting', label: 'Targeting', children: <Targeting summary={approval?.targetingSummary} /> },
          { key: 'scheduling', label: 'Scheduling', children: <Scheduling campaignId={id} currency="AUD" /> },
          { key: 'storyboard', label: 'Storyboard & Copy', children: <Empty icon="dashboard">Storyboards are authored in HQ. An advertiser-submitted campaign arrives with finished creative instead.</Empty> },
          {
            key: 'creative',
            label: 'Creative',
            children: approval
              ? <ApprovalReviewPanel approval={approval} canApprove={canApprove} busy={busy === id} onApprove={() => approve(approval)} onReject={(r) => reject(approval, r)} onUnreject={() => unreject(approval)} />
              : <Spin />,
          },
        ]}
      />
    </div>
  )
}
