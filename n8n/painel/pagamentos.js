// Conferencia de pagamento: a parcela copiada saiu das parcelas em aberto do cache? Autocontido (colado no n8n).

const ETAPAS_H = [28, 48, 72];
const HORA = 3600 * 1000;

function lerJson(v) {
    if (typeof v !== 'string') return v;
    try { return JSON.parse(v); } catch (e) { return null; }
}

function parcelasEmAberto(cacheRow) {
    const pb = lerJson(cacheRow && cacheRow.proximo_boleto);
    if (!pb) return [];
    if (Array.isArray(pb)) return pb.filter(Boolean);
    if (Array.isArray(pb.alunos)) return pb.alunos.reduce((acc, a) => acc.concat((a && a.boletos) || []), []).filter(Boolean);
    return [pb];
}

const digitos = (s) => String(s || '').replace(/\D/g, '');

function mesmaParcela(b, c) {
    if (!b || !c) return false;
    const lb = digitos(b.linhaDigitavel), lc = digitos(c.linha);
    if (lb && lc && lb === lc) return true;
    return String(b.numParcela || '') === String(c.num_parcela || '') && String(b.dataVencimento || '') === String(c.vencimento || '');
}

function proximaConferencia(copiadoEmIso, etapa) {
    return new Date(Date.parse(copiadoEmIso) + ETAPAS_H[etapa - 1] * HORA).toISOString();
}

function decidirConferencia(linha, cacheRow, agoraIso) {
    const etapa = Number(linha.etapa) || 1;
    const fim = (resultado) => ({ final: true, resultado, registro: {
        consulta_id: linha.consulta_id, modo: linha.modo, valor: linha.valor, copiado_em: linha.copiado_em,
        resultado, confirmado_em: agoraIso, etapa } });
    const seguir = () => ({ final: false, etapa: etapa + 1, proxima_conferencia: proximaConferencia(linha.copiado_em, etapa + 1) });

    if (!cacheRow) return fim('indeterminado');
    const atualizado = Date.parse(cacheRow.data_atualizacao) > Date.parse(linha.copiado_em);
    if (!atualizado) return etapa >= 3 ? fim('indeterminado') : seguir();

    // "negociar" nao lista boletos: a parcela sumir nao prova pagamento
    const emAberto = cacheRow.status_sponte === 'negociar' || parcelasEmAberto(cacheRow).some(b => mesmaParcela(b, linha));
    if (!emAberto) return fim('pago');
    return etapa >= 3 ? fim('nao_pago') : seguir();
}

module.exports = { ETAPAS_H, parcelasEmAberto, mesmaParcela, proximaConferencia, decidirConferencia };
