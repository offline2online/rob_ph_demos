/* Shared Targeting Variables (spec §6): the default platform variables,
   read-only, in two groups, each a two-column table (Variable, DSPs that may
   target it). Example values are the variable's tooltip, never a column. */
import type { ColDef, ICellRendererParams } from 'ag-grid-community'
import type { Partner, SharedVariable, VariableAccess } from '@ph-dsp/types'
import { useMemo } from 'react'
import { Grid } from '../../shared/Grid'
import { Icon } from '../../shared/Icon'
import { WithTip } from '../../shared/InfoTip'
import { SectionLabel } from '../../shared/SectionLabel'
import { useSection } from './DspIntegrationLayout'
import { DspPicker } from './DspPicker'
import { SubPageHeader } from './SubPageHeader'

export const VARIABLES_TIP =
  "Variables shared through the API with connected DSPs. Once a variable is enabled for a DSP, that DSP's advertisers can use it in targeting conditions for more advanced campaign targeting; the platform evaluates the condition and never returns the value. They are the same variables as a campaign's Targeting tab. Choose which DSPs may use each one below; default platform variables only in this release."
const GROUPS = [
  { key: 'localisation', label: 'Localisation Variables', icon: 'storefront', tip: 'About the store and the moment; the same for everyone in front of the screen. Available to all connected DSPs by default.' },
  { key: 'personalisation', label: 'Personalisation Variables', icon: 'person', tip: 'About the identified visitor, from the Visitor API. Not available to any DSP by default.' },
] as const
const PICKER_TIP = 'All connected DSPs includes any DSP connected later. A DSP submits a condition; the platform answers matched or not matched and never returns the value.'

type Ctx = { current: { access: Record<string, VariableAccess>; dsps: Partner[]; set: (key: string, v: VariableAccess) => void } }
const VariableCell = ({ data }: ICellRendererParams<SharedVariable>) => (data ? <WithTip tip={data.exampleValues}>{data.label}</WithTip> : null)
const PickerCell = ({ data, context }: ICellRendererParams<SharedVariable, unknown, Ctx>) =>
  data ? <div className="w-full min-w-0 py-1.5"><DspPicker label={data.label} value={context.current.access[data.key]} dsps={context.current.dsps} onChange={(v) => context.current.set(data.key, v)} /></div> : null
const PickerHeader = () => <WithTip tip={PICKER_TIP}><span className="ag-header-cell-text">DSPs that may target it</span></WithTip>

export function SharedTargetingVariables() {
  const { draft, update, partners, variables } = useSection()
  const columns = useMemo<ColDef<SharedVariable>[]>(() => [
    { headerName: 'Variable', width: 300, cellRenderer: VariableCell },
    { headerName: 'DSPs that may target it', width: 320, cellRenderer: PickerCell, headerComponent: PickerHeader, autoHeight: true },
  ], [])
  const context = { access: draft.access, dsps: partners, set: (key: string, v: VariableAccess) => update('access', (a) => ({ ...a, [key]: v })) }
  return (
    <>
      <SubPageHeader icon="tune" title="Shared Targeting Variables" tip={VARIABLES_TIP} />
      {GROUPS.map((g) => (
        <div key={g.key}>
          <SectionLabel>
            <WithTip tip={g.tip}><span className="inline-flex items-center gap-1.5"><Icon name={g.icon} size={15} />{g.label}</span></WithTip>
          </SectionLabel>
          <Grid<SharedVariable> label={g.label} rows={variables.filter((v) => v.group === g.key)} columns={columns} context={context} getRowId={(v) => v.key} />
        </div>
      ))}
    </>
  )
}
