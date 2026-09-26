import type { CaptureRequest, CaptureResult } from '../shared/types'

declare global {
  interface Window {
    swivel: {
      platform: string
      capture: (req: CaptureRequest) => Promise<CaptureResult>
    }
  }
}

export {}
