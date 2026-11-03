/** Datas. Zero dependência. */
const DIA_MS = 86_400_000;

/** "AAAA-MM-DD" no fuso LOCAL — nunca `toISOString()` (UTC), que cruza o dia perto da meia-noite local. */
export function hojeISO(agora = new Date()) {
  const p2 = (n) => String(n).padStart(2, '0');
  return `${agora.getFullYear()}-${p2(agora.getMonth() + 1)}-${p2(agora.getDate())}`;
}

const ms = (x) => (typeof x === 'number' ? x : x instanceof Date ? x.getTime() : Date.parse(x));

/** Dias (fracionários) de `a` até `b`; aceita ISO string, Date ou ms. NaN se algum não for data. */
export function diasEntre(a, b) {
  return (ms(b) - ms(a)) / DIA_MS;
}
