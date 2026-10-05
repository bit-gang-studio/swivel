import { useEffect, useState } from 'react'
import type { Download } from '../../shared/types'
import { engineLabel } from './engines'

/**
 * A page downloaded a file. A link opened in every frame starts the download in each engine:
 * one copy is kept, and the bar names the engines that started it.
 */
export function DownloadBar() {
  const [downloads, setDownloads] = useState<Download[]>([])
  useEffect(() => window.swivel.on('download', (d) => setDownloads((all) => [...all.filter((o) => o.id !== d.id), d])), [])

  const download = downloads[downloads.length - 1]
  if (!download) return null
  const engines = download.engines.map(engineLabel).join(', ')
  return (
    <div className="authbar downloadbar" role="status">
      <span>
        {download.state === 'saving' ? 'Downloading ' : download.state === 'saved' ? 'Saved ' : <span className="retry">Couldn't download </span>}
        <strong>{download.name}</strong>
        {download.state === 'saved' && ' to Downloads'}
      </span>
      <span className="muted" data-tip={download.engines.length > 1 ? 'Each of these engines started the download. One copy was kept.' : 'The engine that downloaded it'}>
        {engines}
      </span>
      {download.state === 'saved' && (
        <button type="button" onClick={() => window.swivel.showDownload(download.id)}>
          Show in folder
        </button>
      )}
      <button type="button" aria-label="Dismiss" onClick={() => setDownloads([])}>
        Dismiss
      </button>
    </div>
  )
}
