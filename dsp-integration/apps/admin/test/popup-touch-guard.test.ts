// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { shouldBlockTouchMove } from '../src/shared/popupTouchGuard'

const scrollable = (el: HTMLElement, top: number, client: number, scroll: number) => {
  el.style.overflowY = 'auto'
  Object.defineProperty(el, 'clientHeight', { value: client, configurable: true })
  Object.defineProperty(el, 'scrollHeight', { value: scroll, configurable: true })
  el.scrollTop = top
}

afterEach(() => { document.body.innerHTML = '' })

describe('popup touch guard', () => {
  it('does nothing when no pop-up is open', () => {
    document.body.innerHTML = '<div id="page"></div>'
    expect(shouldBlockTouchMove(document.getElementById('page'), -10)).toBe(false)
  })
  it('locks the page and modal behind an open pop-up', () => {
    document.body.innerHTML = '<div class="ant-modal" id="m"></div><div class="ant-picker-dropdown"></div>'
    expect(shouldBlockTouchMove(document.getElementById('m'), -10)).toBe(true)
  })
  it('lets a time column scroll, and stops the chain at its ends', () => {
    document.body.innerHTML = '<div class="ant-picker-dropdown"><ul id="col"><li id="cell"></li></ul></div>'
    const col = document.getElementById('col')!
    scrollable(col, 50, 100, 400)
    const cell = document.getElementById('cell')
    expect(shouldBlockTouchMove(cell, -10)).toBe(false)
    expect(shouldBlockTouchMove(cell, 10)).toBe(false)
    col.scrollTop = 0
    expect(shouldBlockTouchMove(cell, 10)).toBe(true)
    col.scrollTop = 300
    expect(shouldBlockTouchMove(cell, -10)).toBe(true)
  })
  it('ignores a hidden pop-up', () => {
    document.body.innerHTML = '<div class="ant-select-dropdown ant-select-dropdown-hidden"></div><div id="p"></div>'
    expect(shouldBlockTouchMove(document.getElementById('p'), -10)).toBe(false)
  })
})
