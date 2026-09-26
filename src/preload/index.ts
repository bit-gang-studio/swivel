import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { InputEvent, LiveEvents, LiveOptions, ViewRect } from '../shared/types'

const api = {
  platform: process.platform,
  start: (opts: LiveOptions): Promise<void> => ipcRenderer.invoke('swivel:start', opts),
  navigate: (url: string): Promise<void> => ipcRenderer.invoke('swivel:navigate', url),
  history: (action: 'back' | 'forward' | 'reload'): Promise<void> => ipcRenderer.invoke('swivel:history', action),
  input: (e: InputEvent): void => ipcRenderer.send('swivel:input', e),
  setRect: (rect: ViewRect): Promise<void> => ipcRenderer.invoke('swivel:rect', rect),
  on<K extends keyof LiveEvents>(event: K, cb: (payload: LiveEvents[K]) => void): () => void {
    const listener = (_: IpcRendererEvent, payload: LiveEvents[K]) => cb(payload)
    ipcRenderer.on(`swivel:${event}`, listener)
    return () => ipcRenderer.removeListener(`swivel:${event}`, listener)
  }
}

contextBridge.exposeInMainWorld('swivel', api)

export type SwivelApi = typeof api
