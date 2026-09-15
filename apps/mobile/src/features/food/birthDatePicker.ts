export interface BirthDateParts { year: string; month: string; day: string }

export const emptyBirthDate: BirthDateParts = { year: '', month: '', day: '' }
export const twoDateDigits = (value: number) => String(value).padStart(2, '0')

export function daysInBirthMonth(year: number, month: number) {
  return new Date(year, month, 0).getDate()
}

export function canonicalBirthDate(parts: BirthDateParts, now = new Date()): string | null {
  const year = Number(parts.year), month = Number(parts.month), day = Number(parts.day)
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day) ||
    month < 1 || month > 12 || day < 1 || day > daysInBirthMonth(year, month)) return null
  const canonical = `${year}-${twoDateDigits(month)}-${twoDateDigits(day)}`
  const today = `${now.getFullYear()}-${twoDateDigits(now.getMonth() + 1)}-${twoDateDigits(now.getDate())}`
  return canonical <= today ? canonical : null
}

export function birthDateParts(value: string): BirthDateParts {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  return match ? { year: match[1]!, month: String(Number(match[2])), day: String(Number(match[3])) }
    : emptyBirthDate
}
