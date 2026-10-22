import { describe, expect, it } from 'vitest'
import { positionSlotNumber, positionText, slotColumnText } from '../src/features/advertisers/slotLine'

describe('Position label convention (yqvzPj3o7hYTWLxF9P8A)', () => {
  it('named slot, single zone', () => {
    const r = { position: 'Hero slot', zoneName: null, zoneSlot: 1 }
    expect(positionText(r)).toBe('Hero slot')
    expect(positionSlotNumber(r)).toBe('Slot 1')
  })
  it('unnamed slot, multi-zone', () => {
    const r = { position: 'Slot 2', zoneName: 'Zone 1', zoneSlot: 2 }
    expect(positionText(r)).toBe('Zone 1 · Slot 2')
    expect(positionSlotNumber(r)).toBeNull()
  })
  it('unnamed slot, single zone', () => {
    const r = { position: 'Slot 3', zoneName: null, zoneSlot: 3 }
    expect(positionText(r)).toBe('Slot 3')
    expect(positionSlotNumber(r)).toBeNull()
  })
  it('named slot, multi-zone', () => {
    const r = { position: 'Aisle hero', zoneName: 'Zone 2', zoneSlot: 1 }
    expect(positionText(r)).toBe('Zone 2 · Aisle hero')
    expect(positionSlotNumber(r)).toBe('Slot 1')
  })
})

describe('Slot column (IkQ23uiIpN8dd6Wh9L27)', () => {
  it('slot with its name in brackets', () => {
    expect(slotColumnText({ position: 'Hero slot', zoneName: null, zoneSlot: 1 })).toBe('Slot 1 (Hero slot)')
    expect(slotColumnText({ position: 'Aisle hero', zoneName: 'Zone 2', zoneSlot: 1 })).toBe('Zone 2 · Slot 1 (Aisle hero)')
  })
  it('no brackets for an unnamed slot', () => {
    expect(slotColumnText({ position: 'Slot 3', zoneName: null, zoneSlot: 3 })).toBe('Slot 3')
    expect(slotColumnText({ position: 'Slot 2', zoneName: 'Zone 1', zoneSlot: 2 })).toBe('Zone 1 · Slot 2')
  })
})
