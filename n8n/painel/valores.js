// Converte valores da Sponte ("179,9900", "1.234,56", "R$ 10,00") em numero. Autocontido (colado no n8n).

function paraNumero(v) {
    if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
    if (v === null || v === undefined || typeof v === 'object') return 0;
    const s = String(v).replace(/[^\d,.-]/g, '');
    if (!s) return 0;
    const n = s.includes(',') ? Number(s.replace(/\./g, '').replace(',', '.')) : Number(s);
    return Number.isFinite(n) ? n : 0;
}

function somaValores(boletos) {
    const total = (Array.isArray(boletos) ? boletos : []).reduce((s, b) => s + paraNumero(b && b.valor), 0);
    return Math.round(total * 100) / 100;
}

module.exports = { paraNumero, somaValores };
