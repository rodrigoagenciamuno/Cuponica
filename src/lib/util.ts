export function slugify(text: string): string {
  return String(text)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' e ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100);
}

/** FAQ em texto simples ↔ lista. Formato no admin:  P: pergunta  /  R: resposta  (bloco separado por linha em branco). */
export function faqFromText(text: string): { q: string; a: string }[] {
  return text
    .split(/\n\s*\n/)
    .map((block) => {
      const q = block.match(/^\s*P:\s*([\s\S]*?)(?=\n\s*R:|$)/i)?.[1]?.trim();
      const a = block.match(/\n\s*R:\s*([\s\S]*)$/i)?.[1]?.trim();
      return q && a ? { q, a } : null;
    })
    .filter(Boolean) as { q: string; a: string }[];
}
export function faqToText(faq: { q: string; a: string }[]): string {
  return faq.map((f) => `P: ${f.q}\nR: ${f.a}`).join('\n\n');
}
