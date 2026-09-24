// KPIs do painel v2 + permissoes. Autocontido no n8n (colado depois de dashboard.js, que da diaSP/diasEntre).
const { diaSP, diasEntre } = require('./dashboard.js'); // @no-n8n

const KPIS = [
    { chave: 'consultas_total', grupo: 'volume', rotulo: 'Consultas totais' },
    { chave: 'consultas_em_dia', grupo: 'volume', rotulo: 'Consultas em dia' },
    { chave: 'consultas_debito', grupo: 'volume', rotulo: 'Consultas com débito' },
    { chave: 'encaminhamentos', grupo: 'volume', rotulo: 'Encaminhamentos para a Amais' },
    { chave: 'comparativo_diario', grupo: 'volume', rotulo: 'Comparativo diário' },
    { chave: 'funil_debito', grupo: 'conversao', rotulo: 'Débito × copiou a linha' },
    { chave: 'funil_amais', grupo: 'conversao', rotulo: 'Encaminhados × falou com a Amais' },
    { chave: 'funil_antecipar', grupo: 'conversao', rotulo: 'Em dia × antecipou' },
    { chave: 'valor_recuperado', grupo: 'financeiro', rotulo: 'Valor recuperado' },
    { chave: 'valor_antecipado', grupo: 'financeiro', rotulo: 'Valor antecipado' },
    { chave: 'reducao_inadimplencia', grupo: 'financeiro', rotulo: 'Redução de inadimplência' },
    { chave: 'tempo_humano', grupo: 'eficiencia', rotulo: 'Tempo humano economizado' },
    { chave: 'erros_por_tela', grupo: 'operacao', rotulo: 'Erros por tela' },
    { chave: 'origem_respostas', grupo: 'operacao', rotulo: 'Origem das respostas' },
    { chave: 'saude_sistema', grupo: 'operacao', rotulo: 'Saúde do sistema' }
];
const GRUPOS = ['volume', 'conversao', 'financeiro', 'eficiencia', 'operacao'];
const CHAVES = KPIS.map(k => k.chave);
const PADRAO_INICIAL = KPIS.filter(k => ['volume', 'conversao', 'operacao'].includes(k.grupo)).map(k => k.chave);
const EM_DIA = ['em_dia_boleto', 'em_dia_sem_boleto'];
const DEBITO = ['debito', 'atrasado_sem_linha'];
const TEMPO_PADRAO_MS = 60000;
const DIA_MS = 24 * 3600 * 1000;

function validarListaKpis(lista) {
    return Array.isArray(lista) && lista.every(k => CHAVES.includes(k)) && new Set(lista).size === lista.length;
}

function kpisPermitidos(usuario, padrao) {
    if (usuario && usuario.papel === 'super_admin') return CHAVES.slice();
    const lista = Array.isArray(usuario && usuario.kpis) ? usuario.kpis : (Array.isArray(padrao) ? padrao : PADRAO_INICIAL);
    return CHAVES.filter(k => lista.includes(k));
}

function filtrarKpis(obj, permitidos) {
    const out = {};
    for (const k of permitidos) if (obj && k in obj) out[k] = obj[k];
    return out;
}

const media = (xs) => xs.length ? xs.reduce((s, n) => s + n, 0) / xs.length : null;
const duracoesValidas = (ls) => ls.map(l => Number(l.duracao_ms)).filter(n => Number.isFinite(n) && n >= 0);
const soma2 = (xs) => Math.round(xs.reduce((s, n) => s + (Number(n) || 0), 0) * 100) / 100;

function agregarKpis({ consultas, eventos, resultados, aConferir, de, ate, agora }) {
    const noPeriodo = (iso) => { if (!iso) return false; const d = diaSP(iso); return d >= de && d <= ate; };
    const todas = (consultas || []).filter(l => l && l.quando);
    const cons = todas.filter(l => noPeriodo(l.quando));
    const dias = diasEntre(de, ate);
    const eh = (grupo) => (l) => grupo.includes(l.resultado);

    const comparativo = dias.map(dia => {
        const doDia = cons.filter(l => diaSP(l.quando) === dia);
        return { dia, total: doDia.length, emDia: doDia.filter(eh(EM_DIA)).length, debito: doDia.filter(eh(DEBITO)).length,
            encaminhamentos: doDia.filter(l => l.resultado === 'encaminhamento').length };
    });

    const evs = (eventos || []).filter(e => e && e.consulta_id);
    const funil = (filtroBase, tipo, modo) => {
        const baseLs = cons.filter(filtroBase);
        const ids = new Set(evs.filter(e => e.tipo === tipo && (!modo || e.modo === modo)).map(e => e.consulta_id));
        const agiu = (l) => l.consulta_id && ids.has(l.consulta_id);
        const agiram = baseLs.filter(agiu).length;
        return { base: baseLs.length, agiram, taxa: baseLs.length ? agiram / baseLs.length : null,
            dias: dias.map(dia => { const d = baseLs.filter(l => diaSP(l.quando) === dia); return { dia, base: d.length, agiram: d.filter(agiu).length }; }) };
    };

    const res = (resultados || []).filter(r => r && noPeriodo(r.copiado_em));
    const conf = (aConferir || []).filter(r => r && noPeriodo(r.copiado_em));
    const financeiro = (modo) => {
        const pagos = res.filter(r => r.modo === modo && r.resultado === 'pago');
        const emConf = conf.filter(r => r.modo === modo);
        return { valor: soma2(pagos.map(r => r.valor)), qtdPagos: pagos.length, emConferencia: soma2(emConf.map(r => r.valor)), qtdEmConferencia: emConf.length };
    };
    const recuperado = financeiro('debito');
    const baseDebito = soma2(cons.filter(eh(DEBITO)).map(l => l.valor_debito));

    const aoVivo = duracoesValidas(cons.filter(l => l.origem === 'ao_vivo'));
    const inicio30 = Date.parse(de + 'T00:00:00Z') - 30 * DIA_MS;
    const aoVivo30 = duracoesValidas(todas.filter(l => l.origem === 'ao_vivo' && Date.parse(l.quando) >= inicio30 && diaSP(l.quando) <= ate));
    const roboMs = media(aoVivo) ?? media(aoVivo30);
    const estimado = roboMs === null;
    const tempoHumanoMs = 2 * (estimado ? TEMPO_PADRAO_MS : roboMs);
    const semHumano = cons.filter(l => l.resultado !== 'erro').length;
    const tempoMedioSiteMs = media(duracoesValidas(cons));

    return {
        consultas_total: { valor: cons.length },
        consultas_em_dia: { valor: cons.filter(eh(EM_DIA)).length },
        consultas_debito: { valor: cons.filter(eh(DEBITO)).length },
        encaminhamentos: { valor: cons.filter(l => l.resultado === 'encaminhamento').length },
        comparativo_diario: { dias: comparativo },
        funil_debito: funil(eh(DEBITO), 'copiou_linha', 'debito'),
        funil_amais: funil(l => l.resultado === 'encaminhamento', 'clicou_amais'),
        funil_antecipar: funil(eh(EM_DIA), 'clicou_antecipar'),
        valor_recuperado: recuperado,
        valor_antecipado: financeiro('antecipacao'),
        reducao_inadimplencia: { taxa: baseDebito > 0 ? Math.round((recuperado.valor / baseDebito) * 10000) / 10000 : null, recuperado: recuperado.valor, baseDebito },
        tempo_humano: {
            horasEconomizadas: semHumano * tempoHumanoMs / 3600000,
            reducao: tempoMedioSiteMs === null ? null : Math.min(1, Math.max(0, 1 - tempoMedioSiteMs / tempoHumanoMs)),
            tempoHumanoMs, tempoMedioSiteMs, semHumano, estimado
        }
    };
}

module.exports = { KPIS, GRUPOS, PADRAO_INICIAL, validarListaKpis, kpisPermitidos, filtrarKpis, agregarKpis };
