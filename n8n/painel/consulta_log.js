// Classifica uma resposta de consulta (a mesma que o site recebe) para o log e a planilha de erros.
// Arquivo autocontido: e colado no no Code do n8n por gerar-codigo-no.js (sem require).

const TELA_POR_RESULTADO = {
    debito: 'Boletos vencidos',
    atrasado_sem_linha: 'Boletos vencidos',
    encaminhamento: 'Negociar com a Amais',
    em_dia_boleto: 'Em dia',
    em_dia_sem_boleto: 'Em dia'
};

const TELA_POR_CODE = {
    nao_encontrado: 'CPF não encontrado',
    instabilidade: 'Sistema instável',
    timeout_navegador: 'Sistema instável',
    sem_senha: 'Sem senha no portal',
    cpf_invalido: 'CPF inválido'
};

const MOTIVOS = {
    nao_encontrado: {
        erro: 'Nenhum aluno ou responsável com esse CPF',
        motivo: 'O CPF não é de aluno cadastrado na Sponte (8731/70532) e não aparece como CPFResponsavel no relatório de Contas a Receber',
        solucao: 'Conferir o CPF com o responsável; verificar na Sponte se o aluno/responsável está cadastrado com esse CPF'
    },
    instabilidade_robo: {
        erro: 'Robô não respondeu',
        motivo: 'O robô ao vivo falhou ou demorou nas 5 tentativas e não havia cache',
        solucao: 'Tentar de novo em alguns minutos; ver "Saúde do sistema" no painel'
    },
    instabilidade_api_sponte: {
        erro: 'API da Sponte indisponível',
        motivo: 'A consulta de alunos na Sponte retornou erro',
        solucao: 'Aguardar a Sponte normalizar; se persistir, contatar suporte Sponte'
    },
    sem_senha: {
        erro: 'Aluno sem senha no Portal',
        motivo: 'O aluno não tem senha do Portal do Aluno cadastrada na Sponte',
        solucao: 'Cadastrar a senha do Portal do Aluno na Sponte'
    },
    timeout_navegador: {
        erro: 'Tempo esgotado no site',
        motivo: 'O site esperou 150 s sem resposta, ou a rede falhou',
        solucao: 'Tentar de novo; se repetir, ver "Saúde do sistema"'
    },
    cpf_invalido: {
        erro: 'CPF inválido',
        motivo: 'O CPF digitado não passa na verificação de dígitos',
        solucao: 'Orientar a pessoa a conferir o CPF digitado'
    },
    desconhecido: {
        erro: 'Erro desconhecido',
        motivo: 'Resposta inesperada do sistema',
        solucao: 'Ver a execução no n8n pelo horário'
    }
};

function contarLinhas(boletos) {
    return (Array.isArray(boletos) ? boletos : []).filter(b => b && b.linhaDigitavel).length;
}

function classificarConsulta(resposta) {
    const r = resposta || {};
    const origem = r.status === 'erro' || !r.status ? 'sem_dados'
        : r.cacheDesatualizado ? 'cache_antigo'
        : r.cache === true ? 'cache' : 'ao_vivo';

    if (r.status === 'erro' || !TELA_POR_RESULTADO[mapearStatus(r)]) {
        const code = r.code || 'desconhecido';
        return { resultado: 'erro', tela: TELA_POR_CODE[code] || 'Erro desconhecido', code, origem: 'sem_dados', qtd_boletos: 0 };
    }

    const alunos = Array.isArray(r.alunos) ? r.alunos : null;
    let resultado, qtd = 0;
    if (r.status === 'negociar') {
        resultado = 'encaminhamento';
    } else if (r.status === 'pagar_atrasados') {
        qtd = alunos
            ? alunos.filter(a => a && a.status === 'pagar_atrasados').reduce((s, a) => s + contarLinhas(a.boletos), 0)
            : contarLinhas(r.parcelas);
        resultado = qtd > 0 ? 'debito' : 'atrasado_sem_linha';
    } else {
        qtd = alunos ? alunos.reduce((s, a) => s + contarLinhas(a && a.boletos), 0) : contarLinhas(r.proximoBoleto ? [r.proximoBoleto] : []);
        resultado = qtd > 0 ? 'em_dia_boleto' : 'em_dia_sem_boleto';
    }
    return { resultado, tela: TELA_POR_RESULTADO[resultado], code: '', origem, qtd_boletos: qtd };
}

// status valido -> chave que existe em TELA_POR_RESULTADO (so para decidir se e erro)
function mapearStatus(r) {
    if (r.status === 'negociar') return 'encaminhamento';
    if (r.status === 'pagar_atrasados') return 'debito';
    if (r.status === 'em_dia') return 'em_dia_boleto';
    return '';
}

function motivoESolucao(code, detalhe) {
    if (code === 'instabilidade') return MOTIVOS[detalhe === 'api_sponte' ? 'instabilidade_api_sponte' : 'instabilidade_robo'];
    return MOTIVOS[code] || MOTIVOS.desconhecido;
}

function formatarCpf(cpf) {
    const d = String(cpf || '').replace(/\D/g, '');
    return d.length === 11 ? d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4') : String(cpf || '');
}

function dataHoraSP(iso) {
    const p = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).formatToParts(new Date(iso));
    const v = t => p.find(x => x.type === t).value;
    return `${v('day')}/${v('month')}/${v('year')} ${v('hour')}:${v('minute')}:${v('second')}`;
}

function linhaPlanilhaErro({ quando, cpf, tela, code, detalhe }) {
    const m = motivoESolucao(code, detalhe);
    return {
        'Data/hora': dataHoraSP(quando),
        'CPF': formatarCpf(cpf),
        'Tela do erro': tela,
        'Erro': m.erro,
        'Motivo do erro': m.motivo,
        'Possível solução': m.solucao
    };
}

module.exports = { classificarConsulta, motivoESolucao, linhaPlanilhaErro };
