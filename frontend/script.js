document.addEventListener('DOMContentLoaded', () => {
    animateHeadline();
    setupCPFMask();
    
    document.getElementById('buscaForm').addEventListener('submit', handleFormSubmit);
    document.getElementById('btnCopiarLinha').addEventListener('click', copyLinhaDigitavel);
});

// Animação do Headline
const loadingPhrases = [
    "Buscando suas informações...",
    "Consultando sua matrícula...",
    "Verificando parcelas em aberto...",
    "Acessando o portal do aluno...",
    "Quase lá, só mais um instante...",
    "Por favor, não feche ou atualize esta página."
];
let loadingInterval = null;

function startLoadingAnimation() {
    const loadingText = document.getElementById('loadingText');
    let idx = 0;
    if(loadingText) loadingText.innerText = loadingPhrases[0];
    loadingInterval = setInterval(() => {
        idx = (idx + 1) % loadingPhrases.length;
        if(loadingText) loadingText.innerText = loadingPhrases[idx];
    }, 3500);
}

function stopLoadingAnimation() {
    if (loadingInterval) {
        clearInterval(loadingInterval);
        loadingInterval = null;
    }
}

function animateHeadline() {
    const headline = document.getElementById('headline');
    const text = headline.innerText;
    headline.innerHTML = '';
    
    // Separa por palavras para manter os espaços
    const words = text.split(' ');
    
    words.forEach((word, wordIndex) => {
        const span = document.createElement('span');
        span.innerText = word;
        span.className = 'animated-word';
        span.style.display = 'inline-block';
        
        // Delay escalonado para cada palavra (mais rápido)
        span.style.animationDelay = `${wordIndex * 0.08}s`;
        
        headline.appendChild(span);
        
        // Adiciona o espaço de volta, exceto na última palavra
        if (wordIndex < words.length - 1) {
            headline.appendChild(document.createTextNode('\u00A0'));
        }
    });
}

// Máscara e Validação de CPF
function setupCPFMask() {
    const cpfInput = document.getElementById('cpf');
    
    cpfInput.addEventListener('input', function(e) {
        let value = e.target.value.replace(/\D/g, ''); // Remove não números
        
        if (value.length > 11) value = value.slice(0, 11);
        
        // Aplica a máscara
        value = value.replace(/(\d{3})(\d)/, '$1.$2');
        value = value.replace(/(\d{3})(\d)/, '$1.$2');
        value = value.replace(/(\d{3})(\d{1,2})$/, '$1-$2');
        
        e.target.value = value;
        
        // Se preencheu 14 caracteres (11 números + pontuação), valida
        if (e.target.value.length === 14) {
            const numStr = e.target.value.replace(/\D/g, '');
            if (!validarCPF(numStr)) {
                document.getElementById('cpfError').classList.remove('hidden');
                cpfInput.style.borderColor = 'var(--error)';
            } else {
                document.getElementById('cpfError').classList.add('hidden');
                cpfInput.style.borderColor = 'var(--border)';
            }
        } else {
            document.getElementById('cpfError').classList.add('hidden');
            cpfInput.style.borderColor = 'var(--border)';
        }
    });
}

function validarCPF(cpf) {
    if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
    let soma = 0;
    for (let i = 0; i < 9; i++) soma += parseInt(cpf.charAt(i)) * (10 - i);
    let resto = 11 - (soma % 11);
    if (resto === 10 || resto === 11) resto = 0;
    if (resto !== parseInt(cpf.charAt(9))) return false;
    soma = 0;
    for (let i = 0; i < 10; i++) soma += parseInt(cpf.charAt(i)) * (11 - i);
    resto = 11 - (soma % 11);
    if (resto === 10 || resto === 11) resto = 0;
    if (resto !== parseInt(cpf.charAt(10))) return false;
    return true;
}

// Submissão do Formulário
async function handleFormSubmit(e) {
    e.preventDefault();
    
    const cpf = document.getElementById('cpf').value.replace(/\D/g, '');
    
    if (!validarCPF(cpf)) {
        document.getElementById('cpfError').classList.remove('hidden');
        return;
    }
    
    // Abre o loading
    openModal('modalLoading');
    startLoadingAnimation();
    
    try {
        const webhookUrl = 'https://n8n.amais.io/webhook/buscar-boletos-novo';
        
        let data = null;
        let tentativas = 0;
        const maxTentativas = 3;

        while (tentativas < maxTentativas) {
            try {
                const response = await fetch(webhookUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ cpf })
                });
                
                // Se der erro 502/504 ou não conseguir fazer o parse do JSON, vai cair no catch interno
                const jsonData = await response.json();
                
                // Verifica se o N8N retornou erro de timeout (Error in workflow)
                if (jsonData.message && jsonData.message.includes('Error in workflow')) {
                    throw new Error('N8N Timeout');
                }
                
                data = jsonData;
                break; // Sucesso, sai do loop
            } catch (err) {
                tentativas++;
                if (tentativas >= maxTentativas) {
                    throw err; // Se já tentou tudo, joga o erro para o catch principal
                }
                // Aguarda 3 segundos antes da próxima tentativa para não sobrecarregar
                await new Promise(r => setTimeout(r, 3000));
            }
        }
        
        stopLoadingAnimation();
        closeModal('modalLoading');
        
        handleRobotResponse(data);
        
    } catch (error) {
        console.error('Erro após as tentativas:', error);
        stopLoadingAnimation();
        closeModal('modalLoading');
        
        // Mantemos um modal caso falhe completamente após as tentativas
        openModal('modalCpfNaoEncontrado');
    }
}

// Controle de Fluxo
let currentProximoBoleto = null;

function handleRobotResponse(data) {
    console.log('Resposta N8N:', data);
    
    if (!data || Object.keys(data).length === 0 || (Array.isArray(data) && data.length === 0)) {
        openModal('modalCpfNaoEncontrado');
        return;
    }
    
    // Pega o nome formatado vindo do backend, ou usa 'Aluno'
    const nome = data.nomeFormatado ? data.nomeFormatado : "Aluno";
    
    if (data.status === 'erro') {
        if (data.message && data.message.includes('não possui senha')) {
            openModal('modalSemSenha');
        } else if (data.message && (data.message.toLowerCase().includes('encontrado') || data.message.toLowerCase().includes('existe'))) {
            openModal('modalCpfNaoEncontrado');
        } else {
            openModal('modalCpfNaoEncontrado'); // Fallback to not found for any other error to be safe
        }
    } else if (data.status === 'negociar') {
        document.getElementById('tituloNegociar').innerText = `Atenção, ${nome}`;
        document.getElementById('textoNegociar').innerText = `Você está com mais de 5 dias de atraso, entre em contato com a Amais para regularizar os seus débitos.`;
        openModal('modalNegociar');
    } 
    else if (data.status === 'em_dia') {
        document.getElementById('tituloEmDia').innerText = `Parabéns, ${nome}!`;
        document.getElementById('textoEmDia').innerText = `Você está em dia e não encontramos nenhuma parcela em atraso.`;
        
        currentProximoBoleto = data.proximoBoleto;
        
        const btnProximo = document.getElementById('btnQueroPagarProximo');
        if (currentProximoBoleto && currentProximoBoleto.linhaDigitavel) {
            document.getElementById('textoEmDia').innerText += ` Caso queira, você consegue pagar o próximo boleto e garantir o nosso desconto de pontualidade.`;
            btnProximo.style.display = 'flex';
            btnProximo.onclick = () => {
                showLinhaDigitavel(
                    currentProximoBoleto.linhaDigitavel, 
                    currentProximoBoleto.numParcela, 
                    currentProximoBoleto.dataVencimento
                );
            };
        } else {
            btnProximo.style.display = 'none'; // Se não tiver próximos boletos
        }
        
        openModal('modalEmDia');
    }
    else if (data.status === 'pagar_atrasados') {
        document.getElementById('tituloPagarAtrasados').innerText = `${nome}, seus Boletos Vencidos`;
        renderBoletosList(data.parcelas);
        openBoletosScreen();
    } else {
        // Fallback de segurança caso a API retorne algo inesperado ou Error in workflow
        if (data.message && data.message.includes('Error in workflow')) {
            alert("⚠️ O sistema demorou muito para responder ou está instável no momento. Por favor, tente consultar novamente em alguns instantes.");
        } else {
            alert("⚠️ Erro desconhecido ao processar o retorno. Tente novamente mais tarde.");
        }
    }
}

function renderBoletosList(parcelas) {
    const listContainer = document.getElementById('boletosList');
    listContainer.innerHTML = '';
    
    parcelas.forEach(p => {
        const card = document.createElement('div');
        card.className = 'boleto-card';
        
        card.innerHTML = `
            <div class="boleto-info">
                <h4>Parcela ${p.numParcela}</h4>
                <p>Venceu em: ${p.dataVencimento}</p>
            </div>
            ${p.linhaDigitavel ? `
            <button class="btn-primary pill-shape" style="padding: 0.75rem 1.5rem; font-size: 0.875rem;" onclick="showLinhaDigitavel('${p.linhaDigitavel}', '${p.numParcela}', '${p.dataVencimento}')">
                Pagar
            </button>
            ` : `
            <span style="font-size: 0.8rem; color: var(--error); padding: 0.5rem; background: #fff0f0; border-radius: 8px;">
                Boleto indisponível
            </span>
            `}
        `;
        listContainer.appendChild(card);
    });
}

// Funções de Modais
function openModal(id) {
    document.getElementById(id).classList.remove('hidden');
}

function closeModal(id) {
    document.getElementById(id).classList.add('hidden');
    // Reseta o feedback de cópia se fechar o modal da linha
    if(id === 'modalLinhaDigitavel') {
        document.getElementById('copyFeedback').classList.add('hidden');
    }
}

function openBoletosScreen() {
    document.getElementById('telaBoletos').classList.remove('hidden');
}

function closeBoletosScreen() {
    document.getElementById('telaBoletos').classList.add('hidden');
}

function showLinhaDigitavel(linha, numParcela = null, dataVencimento = null) {
    document.getElementById('linhaTexto').innerText = linha;
    document.getElementById('copyFeedback').classList.add('hidden');
    
    const infoDiv = document.getElementById('infoProximoBoleto');
    if (numParcela && dataVencimento) {
        document.getElementById('numParcelaProximo').innerText = numParcela;
        document.getElementById('dataVencimentoProximo').innerText = dataVencimento;
        infoDiv.classList.remove('hidden');
    } else {
        infoDiv.classList.add('hidden');
    }
    
    openModal('modalLinhaDigitavel');
}

function copyLinhaDigitavel() {
    const texto = document.getElementById('linhaTexto').innerText;
    navigator.clipboard.writeText(texto).then(() => {
        const feedback = document.getElementById('copyFeedback');
        feedback.classList.remove('hidden');
        
        setTimeout(() => {
            feedback.classList.add('hidden');
        }, 3000);
    });
}
