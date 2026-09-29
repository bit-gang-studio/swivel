import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { FindRequest } from '../shared/find'
import type { CanvasFrame, EngineId, InputEvent, LiveEvents, LiveOptions, ViewRect, Viewport } from '../shared/types'

const api = {
  platform: process.platform,
  /** Engines drawn natively in the window rather than streamed. */
  nativeEngines: ipcRenderer.sendSync('swivel:native-engines') as EngineId[],
  start: (opts: LiveOptions): Promise<void> => ipcRenderer.invoke('swivel:start', opts),
  navigate: (url: string): Promise<void> => ipcRenderer.invoke('swivel:navigate', url),
  history: (action: 'back' | 'forward' | 'reload'): Promise<void> => ipcRenderer.invoke('swivel:history', action),
  input: (e: InputEvent): void => ipcRenderer.send('swivel:input', e),
  setRect: (rect: ViewRect): Promise<void> => ipcRenderer.invoke('swivel:rect', rect),
  /** Change the viewport size without reloading the page. */
  resize: (viewport: Viewport): Promise<void> => ipcRenderer.invoke('swivel:resize', viewport),
  find: (req: FindRequest): Promise<void> => ipcRenderer.invoke('swivel:find', req),
  /** Canvas: show these frames (engine and size each) side by side. The single-page view returns on the next start(). */
  setCanvas: (frames: CanvasFrame[]): Promise<void> => ipcRenderer.invoke('swivel:canvas', frames),
  /** Where a canvas frame's page sits, and the canvas area it's cut off at. */
  setFrameRect: (id: string, rect: ViewRect): Promise<void> => ipcRenderer.invoke('swivel:frame-rect', id, rect),
  frameInput: (id: string, e: InputEvent): void => ipcRenderer.send('swivel:frame-input', id, e),
  setColorScheme: (scheme: 'light' | 'dark'): Promise<void> => ipcRenderer.invoke('swivel:color-scheme', scheme),
  /** Wipe this window's cookies, storage and cache in every engine, and reload. */
  clearData: (): Promise<void> => ipcRenderer.invoke('swivel:clear-data'),
  on<K extends keyof LiveEvents>(event: K, cb: (payload: LiveEvents[K]) => void): () => void {
    const listener = (_: IpcRendererEvent, payload: LiveEvents[K]) => cb(payload)
    ipcRenderer.on(`swivel:${event}`, listener)
    return () => ipcRenderer.removeListener(`swivel:${event}`, listener)
  }
}

contextBridge.exposeInMainWorld('swivel', api)

export type SwivelApi = typeof api
