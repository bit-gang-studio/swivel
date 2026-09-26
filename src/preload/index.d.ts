import type { SwivelApi } from './index'

declare global {
  interface Window {
    swivel: SwivelApi
  }
}

export {}
