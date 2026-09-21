// @vitest-environment jsdom
/* Component contract tests: props in, behaviour out. Run them unchanged
   after placing the components in the real campaign table. */
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import { Switch } from 'antd'
import { describe, expect, it, vi } from 'vitest'
import { ApprovalActions, ApprovalReviewPanel, ApprovalStatusBadge, ApprovalStatusFilter, useCampaignApprovals, type Approval } from '../src/ui'

const approval = (over: Partial<Approval> = {}): Approval => ({
  campaignId: 'c1', campaignName: 'Swisse spring', advertiserName: 'Swisse', partnerName: 'Google DSP', status: 'awaiting_approval', mode: 'manual',
  assetVersion: 'v1', submittedAt: '2026-09-19T00:00:00.000Z', reviewedBy: null, reviewedAt: null, reason: null,
  checks: [{ name: 'dimensions', passed: true, detail: '1920×1080 matches the canvas' }, { name: 'duration', passed: false, detail: '20s is longer than the 15s slot' }],
  targetingSummary: 'Targeted (priority 10): Fixed Store Segments includes selected Metro',
  creative: { assetUrl: '/assets/c1.png', mimeType: 'image/png', width: 1920, height: 1080 }, canvas: { width: 1920, height: 1080 }, ...over,
})

describe('ApprovalStatusBadge', () => {
  it.each([['draft', 'Draft'], ['awaiting_approval', 'Awaiting approval'], ['approved', 'Approved'], ['rejected', 'Rejected']] as const)('shows %s as "%s"', (status, label) => {
    render(<ApprovalStatusBadge status={status} />)
    expect(screen.getByText(label)).toBeInTheDocument()
  })
  it('marks automatic approvals', () => {
    render(<ApprovalStatusBadge status="approved" mode="auto" />)
    expect(screen.getByText('Approved automatically')).toBeInTheDocument()
  })
})

describe('ApprovalActions', () => {
  const toggle = <Switch aria-label="Activation" checked={false} />
  it('Awaiting approval: Approve and Reject replace the activation toggle', () => {
    const onApprove = vi.fn()
    render(<ApprovalActions status="awaiting_approval" onApprove={onApprove} onReject={() => {}}>{toggle}</ApprovalActions>)
    expect(screen.queryByLabelText('Activation')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))
    expect(onApprove).toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Reject' })).toBeInTheDocument()
  })
  it('Approved: renders the host toggle untouched', () => {
    render(<ApprovalActions status="approved" onApprove={() => {}} onReject={() => {}}>{toggle}</ApprovalActions>)
    expect(screen.getByLabelText('Activation')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument()
  })
  it.each(['draft', 'rejected'] as const)('%s: no activation at all', (status) => {
    const { container } = render(<ApprovalActions status={status} onApprove={() => {}} onReject={() => {}}>{toggle}</ApprovalActions>)
    expect(container).toBeEmptyDOMElement()
  })
  it('Reject requires a reason', async () => {
    const onReject = vi.fn()
    render(<ApprovalActions status="awaiting_approval" onApprove={() => {}} onReject={onReject}>{toggle}</ApprovalActions>)
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }))
    const box = await screen.findByLabelText('Reason for rejection')
    const confirm = screen.getAllByRole('button', { name: 'Reject' }).pop()!
    expect(confirm).toBeDisabled()
    fireEvent.change(box, { target: { value: 'Price in artwork' } })
    await act(async () => fireEvent.click(confirm))
    expect(onReject).toHaveBeenCalledWith('Price in artwork')
  })
  it('a non-approver sees the actions disabled', () => {
    render(<ApprovalActions status="awaiting_approval" canApprove={false} onApprove={() => {}} onReject={() => {}}>{toggle}</ApprovalActions>)
    expect(screen.getByRole('button', { name: 'Approve' })).toBeDisabled()
  })
})

describe('ApprovalStatusFilter', () => {
  it('offers the four statuses with counts, and clears on a second click', () => {
    const onChange = vi.fn()
    const { rerender } = render(<ApprovalStatusFilter counts={{ draft: 1, awaiting_approval: 3, approved: 5, rejected: 0 }} value={null} onChange={onChange} />)
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Draft 1', 'Awaiting approval 3', 'Approved 5', 'Rejected 0'])
    fireEvent.click(screen.getByRole('button', { name: /Awaiting approval/ }))
    expect(onChange).toHaveBeenLastCalledWith('awaiting_approval')
    rerender(<ApprovalStatusFilter counts={{ draft: 1, awaiting_approval: 3, approved: 5, rejected: 0 }} value="awaiting_approval" onChange={onChange} />)
    expect(screen.getByRole('button', { name: /Awaiting approval/ })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: /Awaiting approval/ }))
    expect(onChange).toHaveBeenLastCalledWith(null)
  })
})

describe('ApprovalReviewPanel', () => {
  it('shows the creative on the canvas, advertiser and DSP, targeting and check results, with Approve / Reject', () => {
    render(<ApprovalReviewPanel approval={approval()} onApprove={() => {}} onReject={() => {}} />)
    expect(screen.getByTestId('review-canvas').querySelector('img')).toHaveAttribute('src', '/assets/c1.png')
    expect(screen.getAllByText(/Swisse · Google DSP/).length).toBeGreaterThan(0)
    expect(screen.getByText(/Fixed Store Segments includes selected Metro/)).toBeInTheDocument()
    expect(screen.getByRole('list', { name: 'Automated checks' }).textContent).toContain('20s is longer than the 15s slot')
    expect(screen.getByRole('button', { name: /Approve/ })).toBeInTheDocument()
  })
  it('no Approve / Reject once decided', () => {
    render(<ApprovalReviewPanel approval={approval({ status: 'rejected', reason: 'Price in artwork' })} onApprove={() => {}} onReject={() => {}} />)
    expect(screen.queryByRole('button', { name: /Approve/ })).not.toBeInTheDocument()
    expect(screen.getByText('Price in artwork')).toBeInTheDocument()
  })
})

describe('useCampaignApprovals', () => {
  it('loads approval state for the rows on screen', async () => {
    const client = { getApproval: vi.fn(async (id: string) => approval({ campaignId: id })) }
    const { result } = renderHook(() => useCampaignApprovals(['c1', 'c2'], client))
    await waitFor(() => expect(Object.keys(result.current.approvals)).toEqual(['c1', 'c2']))
    expect(client.getApproval).toHaveBeenCalledTimes(2)
  })
})
