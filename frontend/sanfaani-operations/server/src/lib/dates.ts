export function businessDayBounds(timeZone: string, date = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  const localMidnightAsUtc = new Date(`${parts.year}-${parts.month}-${parts.day}T00:00:00.000Z`);
  const localParts = new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    second: '2-digit', hourCycle: 'h23',
  }).formatToParts(localMidnightAsUtc);
  const map = Object.fromEntries(localParts.map((part) => [part.type, part.value]));
  const represented = Date.UTC(Number(map.year), Number(map.month) - 1, Number(map.day), Number(map.hour), Number(map.minute), Number(map.second));
  const offset = represented - localMidnightAsUtc.getTime();
  const start = new Date(localMidnightAsUtc.getTime() - offset);
  return { start, end: new Date(start.getTime() + 86_400_000) };
}
