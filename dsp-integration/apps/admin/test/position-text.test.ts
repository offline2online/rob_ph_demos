import { describe, expect, it } from 'vitest'
import { positionSlotNumber, positionText } from '../src/features/advertisers/slotLine'

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
