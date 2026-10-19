/* What a route shows when its page throws while rendering (pre-handover
   review, 18 Oct 2026). Without it React Router's default took over: the
   whole iframe — the section nav included — was replaced by "Unexpected
   Application Error!" and the raw stack trace, in production too. Now the
   failing page alone is replaced, inside the shell (each section route
   carries this), and the shell's own failure shows the same message in a
   plain content frame (the root route carries it). The error itself goes to
   the console for whoever is debugging, never onto the page. An address no
   route matches (a stale bookmark, a section whose flag is off) reaches the
   root's element as a 404 and says so instead, with nothing to reload. The
   wrapper's data-route-error attribute is what the visual layout check
   (layout/layout.spec.ts) looks for, so a page that crashes on the demo
   snapshot still fails CI (pre-merge review, 19 Oct 2026).

   Built to the ph-designer skill: a status callout (components.md §17, the
   shared Callout), Material Symbols, the content frame's white background
   and 20px padding (prototyping.md §3), nothing positioned fixed. */
import { Button } from 'antd'
import { useEffect } from 'react'
import { isRouteErrorResponse, useRouteError } from 'react-router-dom'
import { Callout } from './Callout'

export function RouteError({ frame = false }: { frame?: boolean }) {
  const error = useRouteError()
  const notFound = isRouteErrorResponse(error) && error.status === 404
  useEffect(() => {
    if (!notFound) console.error(error)
  }, [error, notFound])
  const callout = notFound ? (
    <Callout tone="warning" icon="link_off">This page doesn’t exist.</Callout>
  ) : (
    <Callout tone="error" icon="error" action={<Button type="text" size="small" onClick={() => window.location.reload()}>Reload</Button>}>
      This page could not be shown. Reload to try again; if it keeps happening, tell your administrator.
    </Callout>
  )
  const kind = notFound ? 'not-found' : 'crash'
  return frame ? <div data-route-error={kind} className="min-h-screen w-full bg-white p-5">{callout}</div> : <div data-route-error={kind}>{callout}</div>
}
