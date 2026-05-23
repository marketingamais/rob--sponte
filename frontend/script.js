document.addEventListener('DOMContentLoaded', () => {
    animateHeadline();
    setupCPFMask();
    
    document.getElementById('buscaForm').addEventListener('submit', handleFormSubmit);
    document.getElementById('btnCopiarLinha').addEventListener('click', copyLinhaDigitavel);
});

// Animação do Headline
function animateHeadline() {
    const headline = document.getElementById('headline');
    const text = headline.innerText;
    headline.innerHTML = '';
    
    // Separa por palavras para manter os espaços
    const words = text.split(' ');
    
    words.forEach((word, wordIndex) => {
        const wordSpan = document.createElement('span');
        wordSpan.style.display = 'inline-block';
        wordSpan.style.whiteSpace = 'nowrap';
        
        word.split('').forEach((char, charIndex) => {
            const span = document.createElement('span');
            span.innerText = char;
            span.className = 'letter';
            // Delay escalonado para cada letra
            const totalIndex = (wordIndex * 5) + charIndex;
            span.style.animationDelay = `${totalIndex * 0.05}s`;
            wordSpan.appendChild(span);
        });
        
        headline.appendChild(wordSpan);
        
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
    
    try {
        // Rota oficial do N8N na nuvem
        const webhookUrl = 'https://n8n.amais.io/webhook/buscar-boletos-novo';
        
        const response = await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ cpf })
        });
        
        const data = await response.json();
        closeModal('modalLoading');
        
        handleRobotResponse(data);
        
    } catch (error) {
        console.error(error);
        closeModal('modalLoading');
        alert("Erro ao conectar com o servidor. Tente novamente.");
    }
}

// Controle de Fluxo
let currentProximoBoleto = null;

function handleRobotResponse(data) {
    console.log('Resposta N8N:', data);
    
    // Pega o nome formatado vindo do backend, ou usa 'Aluno'
    const nome = data.nomeFormatado ? data.nomeFormatado : "Aluno";
    
    if (data.status === 'erro') {
        alert(data.message || 'Erro ao buscar os dados.');
    }
    else if (data.status === 'negociar') {
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
        // Fallback de segurança caso a API retorne algo inesperado
        alert('Erro desconhecido ao processar o retorno: ' + JSON.stringify(data));
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
            <button class="btn-primary pill-shape" style="padding: 0.75rem 1.5rem; font-size: 0.875rem;" onclick="showLinhaDigitavel('${p.linhaDigitavel}', '${p.numParcela}', '${p.dataVencimento}')">
                Pagar
            </button>
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
