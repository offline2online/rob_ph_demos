import { fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import type { DisplayType } from '@ph-dsp/types'
import { EnabledFeaturesPanel } from '../src/features/display-types/panels/EnabledFeaturesPanel'
import { VISION_MODES, newDisplayType, withFeature } from '../src/features/display-types/model'
import { VISION_SECTIONS } from '../src/features/display-types/visionSettings'

function Harness() {
  const [d, setD] = useState<DisplayType>(() => withFeature(newDisplayType('landscape'), 'vision_ai', { enabled: true }))
  return <EnabledFeaturesPanel d={d} update={(fn) => setD(fn)} open onToggle={() => {}} />
}
const pickOption = (id: string, label: string) => {
  fireEvent.mouseDown(document.getElementById(id) as HTMLElement)
  fireEvent.click(screen.getAllByText(label).pop() as HTMLElement)
}

describe('Vision/AI Detection Preset visibility', () => {
  it('shows the preset only for Monitor Passerby, and every setting only for Custom', () => {
    render(<Harness />)
    const group = () => screen.queryByRole('group', { name: 'Custom detection settings' })
    // Monitor Passerby is the default mode: preset shown, settings hidden.
    expect(document.getElementById('visionPreset')).toBeInTheDocument()
    expect(group()).not.toBeInTheDocument()

    pickOption('visionPreset', 'Custom')
    const g = within(group() as HTMLElement)
    for (const s of VISION_SECTIONS) {
      expect(g.getByRole('button', { name: s.title })).toBeInTheDocument()
      for (const f of s.fields) expect(g.getByText(f.label)).toBeInTheDocument()
    }
    // Tooltips only: no body copy rendered as text.
    expect(screen.queryByText(VISION_SECTIONS[0].fields[0].tip)).not.toBeInTheDocument()

    pickOption('visionMode', VISION_MODES[1])
    expect(document.getElementById('visionPreset')).not.toBeInTheDocument()
    expect(group()).not.toBeInTheDocument()

    pickOption('visionMode', VISION_MODES[0])
    expect(document.getElementById('visionPreset')).toBeInTheDocument()
  })
})
