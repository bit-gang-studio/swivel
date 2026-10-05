import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { FindRequest } from '../shared/find'
import type { StorageAction, StorageSnapshot } from '../shared/storage'
import type { CanvasFrame, Credentials, EngineId, InputEvent, LiveEvents, LiveOptions, ViewRect, Viewport } from '../shared/types'

const api = {
  platform: process.platform,
  /** Engines drawn natively in the window rather than streamed. */
  nativeEngines: ipcRenderer.sendSync('swivel:native-engines') as EngineId[],
  /** Each engine's version, as its browser numbers it; empty when unknown. */
  engineVersions: ipcRenderer.sendSync('swivel:engine-versions') as Record<EngineId, string>,
  start: (opts: LiveOptions): Promise<void> => ipcRenderer.invoke('swivel:start', opts),
  navigate: (url: string): Promise<void> => ipcRenderer.invoke('swivel:navigate', url),
  history: (action: 'back' | 'forward' | 'reload'): Promise<void> => ipcRenderer.invoke('swivel:history', action),
  input: (e: InputEvent): void => ipcRenderer.send('swivel:input', e),
  setRect: (rect: ViewRect): Promise<void> => ipcRenderer.invoke('swivel:rect', rect),
  /** Change the viewport size without reloading the page. */
  resize: (viewport: Viewport): Promise<void> => ipcRenderer.invoke('swivel:resize', viewport),
  find: (req: FindRequest): Promise<void> => ipcRenderer.invoke('swivel:find', req),
  /** Canvas: show these frames (engine and size each) side by side. The single-page view returns on the next start(). */
  setCanvas: (frames: CanvasFrame[], page: { url: string; colorScheme: 'light' | 'dark' }): Promise<void> => ipcRenderer.invoke('swivel:canvas', frames, page),
  /** Where a canvas frame's page sits, and the canvas area it's cut off at. */
  setFrameRect: (id: string, rect: ViewRect): Promise<void> => ipcRenderer.invoke('swivel:frame-rect', id, rect),
  frameInput: (id: string, e: InputEvent): void => ipcRenderer.send('swivel:frame-input', id, e),
  /** Focus mode: hide or show a canvas frame's page (it keeps running). */
  setFrameVisible: (id: string, visible: boolean): void => ipcRenderer.send('swivel:frame-visible', id, visible),
  /** Show a hover label under a control (x: its centre; top, bottom: its edges), or hide it with null. Drawn above native pages. */
  tip: (tip: { text: string; x: number; top: number; bottom: number } | null): void => ipcRenderer.send('swivel:tip', tip),
  /** What this window's engines have stored: cookies, local and session storage, and sizes. */
  storage: (): Promise<StorageSnapshot | undefined> => ipcRenderer.invoke('swivel:storage'),
  /** A change from the storage panel, applied in every engine. */
  storageAction: (action: StorageAction): Promise<void> => ipcRenderer.invoke('swivel:storage-action', action),
  /** Whether a scroll, click or typing in one frame is repeated in the others. */
  setSync: (on: boolean): void => ipcRenderer.send('swivel:sync', on),
  /** The frame find-in-page searches. */
  selectFrame: (id: string | undefined): void => ipcRenderer.send('swivel:frame-select', id),
  /** A native menu at x, y (window pixels): resolves with the picked item's id, or null. Group rows are headings. */
  pick: (items: { id?: string; label: string; group?: boolean }[], at: { x: number; y: number }): Promise<string | null> => ipcRenderer.invoke('swivel:pick', items, at),
  /** Answer an 'auth' question: a username and password, or null to cancel. */
  answerAuth: (id: number, credentials: Credentials | null): void => ipcRenderer.send('swivel:auth-answer', id, credentials),
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
