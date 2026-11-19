/** Funções de apresentação usadas pelos componentes. */

/** Divide o rótulo do desconto para a etiqueta: "15% OFF" → 15% / OFF; "R$ 50" → R$ / 50. */
export function splitLabel(label: string | null | undefined, type: 'code' | 'deal') {
  const l = (label || (type === 'code' ? 'Cupom' : 'Oferta')).trim();
  let m = l.match(/^(\d+[.,]?\d*\s*%)\s*(.*)$/i);
  if (m) return { kind: 'pct' as const, big: m[1].replace(/\s/g, ''), small: m[2] || 'OFF' };
  m = l.match(/^R\$\s*([\d.,]+)\s*(.*)$/i);
  if (m) return { kind: 'money' as const, big: m[1], small: 'R$', after: m[2] };
  return { kind: 'text' as const, big: l, small: '' };
}

/** Cor do texto (branco ou tinta) com melhor contraste sobre a cor da marca. */
export function onColor(hex: string | null | undefined): 'light' | 'dark' {
  const h = (hex || '').replace('#', '');
  if (h.length !== 6) return 'light';
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  // Texto branco por padrão (marcas costumam usar branco sobre a cor); tinta só em cores bem claras,
  // como amarelo e verde-limão, onde o branco fica ilegível.
  return lum > 0.4 ? 'dark' : 'light';
}

/** Iniciais para o monograma: "Casa Nuvem" → CN, "Vestra" → V. */
export function initials(name: string): string {
  const words = name.replace(/&/g, ' ').split(/\s+/).filter(Boolean);
  if (words.length === 1) return words[0].charAt(0).toUpperCase();
  return (words[0].charAt(0) + words[1].charAt(0)).toUpperCase();
}

const DAY = 86400000;
const tz = 'America/Sao_Paulo';
const dayKey = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(d);

/** Quantos dias de calendário (horário de Brasília) faltam até a data. 0 = hoje. */
export function daysLeft(date: Date, now = new Date()): number {
  return Math.round((Date.parse(dayKey(date)) - Date.parse(dayKey(now))) / DAY);
}

/** Texto e tom da validade do cupom. */
export function expiryInfo(expires: Date | null, expired: boolean) {
  const fmt = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: tz });
  if (expired && expires) return { text: `Expirou em ${fmt.format(expires)}`, hot: false };
  if (!expires) return { text: 'Sem data de validade', hot: false };
  const d = daysLeft(expires);
  if (d <= 0) return { text: 'Termina hoje', hot: true };
  if (d === 1) return { text: 'Termina amanhã', hot: true };
  if (d <= 3) return { text: `Termina em ${d} dias`, hot: true };
  return { text: `Válido até ${fmt.format(expires).slice(0, 5)}`, hot: false };
}

export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
