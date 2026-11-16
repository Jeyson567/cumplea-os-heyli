export class ClientError extends Error {
  constructor(code, message, reason = null) {
    super(message)
    this.name = 'ClientError'
    this.code = code
    this.reason = reason
  }
}
