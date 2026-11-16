export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag)
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue
    if (key === 'class') node.className = value
    else if (key === 'text') node.textContent = String(value)
    else if (key === 'hidden') node.hidden = true
    else if (key === 'disabled') node.disabled = true
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2).toLowerCase(), value)
    else node.setAttribute(key, value === true ? '' : String(value))
  }
  for (const child of [children].flat(2)) {
    if (child == null || child === false) continue
    node.append(child instanceof Node ? child : document.createTextNode(String(child)))
  }
  return node
}

export function toast(message, kind = 'info') {
  const root = document.getElementById('toasts')
  if (!root) return
  const item = el('p', { class: `toast toast--${kind}`, text: message })
  root.append(item)
  window.setTimeout(() => item.remove(), 5600)
}

export async function withBusy(button, work) {
  if (!button || button.dataset.busy === '1') return
  button.dataset.busy = '1'
  button.disabled = true
  const previous = button.textContent
  try {
    await work()
  } finally {
    button.disabled = false
    button.dataset.busy = '0'
    if (button.textContent !== previous && button.dataset.lockLabel === '1') button.textContent = previous
  }
}
