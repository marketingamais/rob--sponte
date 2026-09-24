// Eventos de acao do site (copiou linha, clicou Amais, clicou antecipar). Autocontido (colado no n8n).
const { paraNumero } = require('./valores.js'); // @no-n8n
const { parcelasEmAberto, mesmaParcela, proximaConferencia } = require('./pagamentos.js'); // @no-n8n

const TIPOS_EVENTO = ['copiou_linha', 'clicou_amais', 'clicou_antecipar'];
const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const JANELA_CONSULTA_MS = 2 * 3600 * 1000;

function normalizarEvento(body, agoraIso) {
    const b = body || {};
    const ignorar = (motivo) => ({ ignorar: true, motivo });
    if (!TIPOS_EVENTO.includes(b.tipo)) return ignorar('tipo');
    const consulta_id = String(b.consulta_id || '');
    if (!RE_UUID.test(consulta_id)) return ignorar('consulta_id');

    if (b.tipo !== 'copiou_linha') {
        const modo = b.tipo === 'clicou_antecipar' ? 'antecipacao' : '';
        return { tipo: b.tipo, conferencia: null,
            log: { quando: agoraIso, tipo: b.tipo, consulta_id, modo, valor: 0, chave: `${b.tipo}|${consulta_id}||` } };
    }

    const cpf = String(b.cpf || '').replace(/\D/g, '');
    if (cpf.length !== 11) return ignorar('cpf');
    const linha = String(b.linha || '').replace(/\D/g, '');
    if (linha.length < 44 || linha.length > 48) return ignorar('linha');
    const vencimento = String(b.vencimento || '');
    if (!/^\d{2}\/\d{2}\/\d{4}$/.test(vencimento)) return ignorar('vencimento');
    const num_parcela = String(b.num_parcela || '').slice(0, 10);
    if (!num_parcela) return ignorar('parcela');
    const modo = b.modo === 'antecipacao' ? 'antecipacao' : 'debito';
    const valor = paraNumero(b.valor);
    return {
        tipo: 'copiou_linha',
        log: { quando: agoraIso, tipo: 'copiou_linha', consulta_id, modo, valor, chave: `copiou_linha|${consulta_id}|${num_parcela}|${vencimento}` },
        conferencia: { consulta_id, cpf, modo, num_parcela, vencimento, linha, valor, copiado_em: agoraIso, etapa: 1,
            proxima_conferencia: proximaConferencia(agoraIso, 1) }
    };
}

function validarCopia({ consulta, cacheRow, conferencia, agoraIso }) {
    const nao = (motivo) => ({ ok: false, motivo });
    if (!consulta || consulta.consulta_id !== conferencia.consulta_id) return nao('consulta_inexistente');
    if (Math.abs(Date.parse(agoraIso) - Date.parse(consulta.quando)) > JANELA_CONSULTA_MS) return nao('consulta_antiga');
    if (!cacheRow) return nao('sem_cache');
    if (!parcelasEmAberto(cacheRow).some(b => mesmaParcela(b, conferencia))) return nao('parcela_nao_encontrada');
    return { ok: true, motivo: '' };
}

module.exports = { TIPOS_EVENTO, normalizarEvento, validarCopia };
