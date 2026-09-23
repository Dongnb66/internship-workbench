type Kind = 'info' | 'success' | 'error'

export function toast(message: string, kind: Kind = 'info'): void {
  const host = document.getElementById('toast-host') ?? (() => {
    const el = document.createElement('div')
    el.id = 'toast-host'
    el.className = 'toast-host'
    document.body.appendChild(el)
    return el
  })()

  const item = document.createElement('div')
  item.className = `toast toast-${kind}`
  item.textContent = message
  host.appendChild(item)
  window.setTimeout(() => {
    item.classList.add('toast-out')
    window.setTimeout(() => item.remove(), 240)
  }, 2600)
}

export const notifyOk = (m: string) => toast(m, 'success')
export const notifyErr = (m: string) => toast(m, 'error')
