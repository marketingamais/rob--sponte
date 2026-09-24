// Agrega o log de consultas para o dashboard e avalia a saude do sistema. Autocontido (colado no n8n).

const RESOLVIDOS = ['debito', 'encaminhamento', 'em_dia_boleto', 'em_dia_sem_boleto', 'atrasado_sem_linha'];

function diaSP(iso) {
    return new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }); // AAAA-MM-DD
}

function diasEntre(de, ate) {
    const out = [];
    const d = new Date(de + 'T12:00:00Z');
    const fim = new Date(ate + 'T12:00:00Z');
    while (d <= fim && out.length < 400) {
        out.push(d.toISOString().slice(0, 10));
        d.setUTCDate(d.getUTCDate() + 1);
    }
    return out;
}

function agregarDashboard(linhas, de, ate, agora) {
    const todas = Array.isArray(linhas) ? linhas.filter(l => l && l.quando) : [];
    const noPeriodo = todas.filter(l => { const d = diaSP(l.quando); return d >= de && d <= ate; });
    const conta = (res) => noPeriodo.filter(l => l.resultado === res).length;

    const total = noPeriodo.length;
    const erros = conta('erro');
    const resolvidas = noPeriodo.filter(l => RESOLVIDOS.includes(l.resultado)).length;

    const porTela = {};
    for (const l of noPeriodo) if (l.resultado === 'erro') porTela[l.tela] = (porTela[l.tela] || 0) + 1;
    const errosPorTela = Object.entries(porTela)
        .map(([tela, qtd]) => ({ tela, qtd, pct: qtd / erros }))
        .sort((a, b) => b.qtd - a.qtd || a.tela.localeCompare(b.tela));

    const porDia = diasEntre(de, ate).map(dia => ({ dia, resolvidas: 0, erros: 0 }));
    const idx = Object.fromEntries(porDia.map((d, i) => [d.dia, i]));
    for (const l of noPeriodo) {
        const i = idx[diaSP(l.quando)];
        if (i === undefined) continue;
        if (l.resultado === 'erro') porDia[i].erros++; else if (RESOLVIDOS.includes(l.resultado)) porDia[i].resolvidas++;
    }

    const duracoes = noPeriodo.map(l => Number(l.duracao_ms)).filter(n => Number.isFinite(n) && n >= 0);
    const porOrigem = {};
    for (const l of noPeriodo) porOrigem[l.origem] = (porOrigem[l.origem] || 0) + 1;

    const limite24h = agora.getTime() - 24 * 3600 * 1000;
    const ult24 = todas.filter(l => { const t = new Date(l.quando).getTime(); return t >= limite24h && t <= agora.getTime(); });

    return {
        periodo: { de, ate },
        total,
        debito: conta('debito'),
        encaminhamento: conta('encaminhamento'),
        emDiaBoleto: conta('em_dia_boleto'),
        emDiaSemBoleto: conta('em_dia_sem_boleto'),
        atrasadoSemLinha: conta('atrasado_sem_linha'),
        erros,
        taxaResolucao: total ? resolvidas / total : null,
        taxaErros: total ? erros / total : null,
        errosPorTela,
        porDia,
        tempoMedioMs: duracoes.length ? Math.round(duracoes.reduce((s, n) => s + n, 0) / duracoes.length) : null,
        porOrigem,
        erros24h: { total: ult24.length, erros: ult24.filter(l => l.resultado === 'erro').length }
    };
}

function horasDesde(iso, agora) {
    return iso ? (agora.getTime() - new Date(iso).getTime()) / 3600000 : Infinity;
}

function avaliarSaude({ robo, ultimaIngestao, cacheAtualizadoEm, erros24h }, agora) {
    const itens = [];
    if (!robo || !robo.ok) itens.push({ item: 'Robô', nivel: 'vermelho', detalhe: 'Não respondeu' });
    else if (robo.ms < 5000) itens.push({ item: 'Robô', nivel: 'verde', detalhe: `No ar (versão ${String(robo.commit || '').slice(0, 7)})` });
    else itens.push({ item: 'Robô', nivel: 'amarelo', detalhe: `Acordando (${Math.round(robo.ms / 1000)} s)` });

    const hIng = horasDesde(ultimaIngestao && ultimaIngestao.quando, agora);
    if (ultimaIngestao && ultimaIngestao.status === 'ok' && hIng < 26) {
        itens.push({ item: 'Último export', nivel: 'verde', detalhe: `${ultimaIngestao.cpfs} CPFs há ${Math.round(hIng)} h` });
    } else if (ultimaIngestao) {
        itens.push({ item: 'Último export', nivel: 'vermelho', detalhe: ultimaIngestao.status === 'ok' ? `Há ${Math.round(hIng)} h` : `Rejeitado (${ultimaIngestao.cpfs} CPFs)` });
    } else {
        itens.push({ item: 'Último export', nivel: 'vermelho', detalhe: 'Nenhum registro' });
    }

    const hCache = horasDesde(cacheAtualizadoEm, agora);
    itens.push(hCache < 26
        ? { item: 'Idade do cache', nivel: 'verde', detalhe: `${Math.round(hCache)} h` }
        : { item: 'Idade do cache', nivel: 'vermelho', detalhe: cacheAtualizadoEm ? `${Math.round(hCache)} h` : 'Desconhecida' });

    const tx = erros24h && erros24h.total ? erros24h.erros / erros24h.total : 0;
    itens.push({ item: 'Erros nas últimas 24h', nivel: tx < 0.10 ? 'verde' : tx <= 0.25 ? 'amarelo' : 'vermelho',
        detalhe: `${erros24h ? erros24h.erros : 0} de ${erros24h ? erros24h.total : 0}` });
    return itens;
}

module.exports = { agregarDashboard, avaliarSaude, diaSP, diasEntre };
