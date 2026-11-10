/** Small vector template image; AppKit renders it sharply at either display scale. */
export function quotaRingImage(rings: Array<{ remaining: number | null; warning?: boolean }>): string {
  const values = rings.length ? rings : [{ remaining: null }];
  const width = values.length * 22 - 6;
  const number = (value: number) => value.toFixed(3);
  function arc(cx: number, cy: number, radius: number, fraction: number): string {
    let angle = Math.PI / 2;
    const parts = [`${number(cx)} ${number(cy + radius)} m`];
    const steps = Math.ceil(fraction * 4);
    for (let step = 0; step < steps; step++) {
      const next = Math.PI / 2 - Math.min((step + 1) / 4, fraction) * Math.PI * 2;
      const factor = 4 / 3 * Math.tan((next - angle) / 4);
      parts.push(`${number(cx + radius * (Math.cos(angle) - factor * Math.sin(angle)))} ${number(cy + radius * (Math.sin(angle) + factor * Math.cos(angle)))} ${number(cx + radius * (Math.cos(next) + factor * Math.sin(next)))} ${number(cy + radius * (Math.sin(next) - factor * Math.cos(next)))} ${number(cx + radius * Math.cos(next))} ${number(cy + radius * Math.sin(next))} c`);
      angle = next;
    }
    return parts.join('\n');
  }
  const drawing = values.map((ring, index) => {
    const cx = index * 22 + 8;
    const circle = arc(cx, 8, 6.15, 1);
    const commands = ['q 0 G 0 g 1.8 w 1 J', `/track gs ${circle} S`];
    if (ring.remaining === null) commands.push(`/ink gs [1.5 2.5] 0 d ${circle} S`);
    else if (ring.remaining > 0) commands.push(`/ink gs ${arc(cx, 8, 6.15, Math.min(100, Math.max(0, ring.remaining)) / 100)} S`);
    if (ring.warning) commands.push(`/ink gs [] 0 d 2.3 w ${cx + 5.6} 13.6 m ${cx + 5.6} 13.61 l S`);
    return commands.join('\n') + '\nQ';
  }).join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} 16] /Resources << /ExtGState << /track << /Type /ExtGState /CA 0.22 >> /ink << /Type /ExtGState /CA 1 >> >> >> /Contents 4 0 R >>`,
    `<< /Length ${Buffer.byteLength(drawing)} >>\nstream\n${drawing}\nendstream`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 5\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf).toString('base64');
}
