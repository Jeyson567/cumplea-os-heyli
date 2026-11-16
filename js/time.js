import { isValidDateParts, isValidTime } from './policy.js'

function zoneOffsetMs(utcMs, timeZone) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })
  const parts = {}
  for (const part of formatter.formatToParts(new Date(utcMs))) {
    if (part.type !== 'literal') parts[part.type] = part.value
  }
  let hour = Number(parts.hour)
  if (hour === 24) hour = 0
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    hour,
    Number(parts.minute),
    Number(parts.second)
  )
  return asUtc - utcMs
}

export function zonedTimeToUtc(dateISO, timeHHMM, timeZone) {
  if (!isValidDateParts(dateISO) || !isValidTime(timeHHMM)) return null
  const [year, month, day] = dateISO.split('-').map(Number)
  const [hour, minute] = timeHHMM.split(':').map(Number)
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, 0)
  const firstOffset = zoneOffsetMs(utcGuess, timeZone)
  let instant = utcGuess - firstOffset
  const secondOffset = zoneOffsetMs(instant, timeZone)
  if (secondOffset !== firstOffset) instant = utcGuess - secondOffset
  return new Date(instant)
}

export function formatLongDate(dateISO, timeZone) {
  const instant = zonedTimeToUtc(dateISO, '12:00', timeZone)
  if (!instant) return dateISO
  return new Intl.DateTimeFormat('es-GT', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone
  }).format(instant)
}

export function formatTimeLabel(timeHHMM) {
  if (!isValidTime(timeHHMM)) return timeHHMM || ''
  const [hourValue, minute] = timeHHMM.split(':').map(Number)
  const suffix = hourValue >= 12 ? 'p. m.' : 'a. m.'
  const hour = hourValue % 12 || 12
  return `${hour}:${String(minute).padStart(2, '0')} ${suffix}`
}

export function formatInZone(iso, timeZone) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return { date: '', time: '' }
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
  const parts = {}
  for (const part of formatter.formatToParts(date)) {
    if (part.type !== 'literal') parts[part.type] = part.value
  }
  const hour = parts.hour === '24' ? '00' : parts.hour
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${hour}:${parts.minute}`
  }
}

export function formatStamp(iso, timeZone) {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('es-GT', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: timeZone || 'America/Guatemala'
  }).format(date)
}

export function countdownParts(targetMs, nowMs = Date.now()) {
  const diff = targetMs - nowMs
  if (diff <= 0) return { done: true, days: 0, hours: 0, minutes: 0, seconds: 0 }
  const total = Math.floor(diff / 1000)
  return {
    done: false,
    days: Math.floor(total / 86400),
    hours: Math.floor((total % 86400) / 3600),
    minutes: Math.floor((total % 3600) / 60),
    seconds: total % 60
  }
}

export function pad(value) {
  return String(value).padStart(2, '0')
}
