import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './theme/index.css'

const render = () =>
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  )

/* The hosted demo answers the API from a captured snapshot; everywhere else
   talks to the real one. The import sits inside the branch so it is dropped
   from an ordinary build. */
if (import.meta.env.VITE_DEMO === '1') {
  void import('./demo/staticApi').then(({ installStaticApi }) => installStaticApi()).then(render)
} else {
  render()
}
