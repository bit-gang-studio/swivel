/** Stroke icons, drawn in the current text colour. */
export function Icon({ d, size = 16 }: { d: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  )
}

export const ICONS = {
  back: 'M19 12H5M12 19l-7-7 7-7',
  forward: 'M5 12h14M12 5l7 7-7 7',
  reload: 'M21 12a9 9 0 1 1-2.6-6.4L21 8M21 3v5h-5',
  plus: 'M12 5v14M5 12h14',
  sync: 'M7 7h13M17 4l3 3-3 3M17 17H4M7 14l-3 3 3 3',
  moon: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z',
  console: 'M4 17l6-5-6-5M12 19h8',
  trash: 'M4 7h16M10 11v6M14 11v6M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-12M9 7V4h6v3',
  rotate: 'M4 9V5h4M4 5l4 4M9 20h10a1 1 0 0 0 1-1V9a1 1 0 0 0-1-1H9a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1z',
  focus: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  close: 'M6 6l12 12M18 6L6 18',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z'
}
