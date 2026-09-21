/* npm run dev:mocks — mock DSP APIs on DSP_MOCKS_PORT (default 4100). */
import { buildMocks } from './app'

const port = Number(process.env.DSP_MOCKS_PORT ?? 4100)
const { app } = buildMocks()
app.listen({ port, host: '127.0.0.1' }).then(() => console.log(`Mock DSPs on http://127.0.0.1:${port} (test page at /)`))
