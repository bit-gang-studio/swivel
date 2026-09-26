import { contextBridge, ipcRenderer } from 'electron'
import type { CaptureRequest, CaptureResult } from '../shared/types'

const api = {
  platform: process.platform,
  capture: (req: CaptureRequest): Promise<CaptureResult> => ipcRenderer.invoke('swivel:capture', req)
}

contextBridge.exposeInMainWorld('swivel', api)

export type SwivelApi = typeof api
