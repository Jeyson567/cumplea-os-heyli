const memory = new Map()

export function requestIdFor(scope, payload) {
  const fingerprint = JSON.stringify(payload)
  const current = memory.get(scope)
  if (current && current.fingerprint === fingerprint && !current.done) return current.id
  const id = crypto.randomUUID()
  memory.set(scope, { id, fingerprint, done: false })
  return id
}

export function completeRequest(scope) {
  const current = memory.get(scope)
  if (current) current.done = true
}
