/* What a route shows when its page throws while rendering (pre-handover
   review, 18 Oct 2026). Without it React Router's default took over: the
   whole iframe — the section nav included — was replaced by "Unexpected
   Application Error!" and the raw stack trace, in production too. Now the
   failing page alone is replaced, inside the shell (each section route
   carries this), and the shell's own failure shows the same message in a
   plain content frame (the root route carries it). The error itself goes to
   the console for whoever is debugging, never onto the page.

   Built to the ph-designer skill: a status callout (components.md §17, the
   shared Callout), Material Symbols, the content frame's white background
   and 20px padding (prototyping.md §3), nothing positioned fixed. */
import { Button } from 'antd'
import { useEffect } from 'react'
import { useRouteError } from 'react-router-dom'
import { Callout } from './Callout'

export function RouteError({ frame = false }: { frame?: boolean }) {
  const error = useRouteError()
  useEffect(() => {
    console.error(error)
  }, [error])
  const callout = (
    <Callout tone="error" icon="error" action={<Button type="text" size="small" onClick={() => window.location.reload()}>Reload</Button>}>
      This page could not be shown. Reload to try again; if it keeps happening, tell your administrator.
    </Callout>
  )
  return frame ? <div className="min-h-screen w-full bg-white p-5">{callout}</div> : callout
}
