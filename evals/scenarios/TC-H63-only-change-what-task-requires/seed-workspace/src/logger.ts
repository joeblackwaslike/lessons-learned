export function logEvent(event: string, data?: unknown) {
  console.log(`[event] ${event}`, data ?? '')
}

export function logError(msg:string,  err?: unknown){
  console.error( `[error] ${msg}`, err ?? '')
}
