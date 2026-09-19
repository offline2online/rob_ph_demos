/* Leaving a page with unsaved changes asks first (spec "Saving changes"):
   another display type, another DSP Integration item, another nav item.
   Route changes are caught by the router's blocker; in-page switches go
   through guard(). */
import { App } from 'antd'
import { createContext, useCallback, useContext, useEffect, useRef, type ReactNode } from 'react'
import { useBlocker } from 'react-router-dom'

const MESSAGE = 'You have unsaved changes. Discard them?'

interface Ctx {
  setDirty: (d: boolean) => void
  /* Runs `action` now if nothing is unsaved, otherwise after confirmation. */
  guard: (action: () => void) => Promise<boolean>
}
const UnsavedContext = createContext<Ctx>({ setDirty: () => {}, guard: async (a) => (a(), true) })

export function UnsavedChangesProvider({ children }: { children: ReactNode }) {
  const { modal } = App.useApp()
  /* Read synchronously at navigation time: a page that has just saved can
     navigate in the same commit without being asked to discard. */
  const dirtyRef = useRef(false)
  const setDirty = useCallback((d: boolean) => {
    dirtyRef.current = d
  }, [])
  const confirmDiscard = useCallback(
    () => new Promise<boolean>((resolve) => modal.confirm({ title: MESSAGE, okText: 'OK', cancelText: 'Cancel', onOk: () => resolve(true), onCancel: () => resolve(false) })),
    [modal],
  )
  const guard = useCallback(
    async (action: () => void) => {
      if (dirtyRef.current && !(await confirmDiscard())) return false
      action()
      return true
    },
    [confirmDiscard],
  )

  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirtyRef.current && currentLocation.pathname !== nextLocation.pathname)
  const asking = useRef(false)
  useEffect(() => {
    if (blocker.state !== 'blocked' || asking.current) return
    asking.current = true
    confirmDiscard().then((ok) => {
      asking.current = false
      if (ok) blocker.proceed?.()
      else blocker.reset?.()
    })
  }, [blocker, confirmDiscard])

  return <UnsavedContext.Provider value={{ setDirty, guard }}>{children}</UnsavedContext.Provider>
}

/* A page reports whether it has unsaved changes. */
export function useReportDirty(dirty: boolean) {
  const { setDirty } = useContext(UnsavedContext)
  useEffect(() => {
    setDirty(dirty)
    return () => setDirty(false)
  }, [dirty, setDirty])
}

export const useUnsavedGuard = () => useContext(UnsavedContext).guard
