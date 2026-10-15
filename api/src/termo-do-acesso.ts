// =====================================================================
// O termo de uso do acesso de outro sistema
// =====================================================================
// Padrão DMS §2.4 (aprovado pelo dono em 14/10/2026): quem cria o acesso
// aceita o termo, e a versão do texto fica guardada junto do acesso
// (`acesso_externo.termo_versao`). O texto mora AQUI, num lugar só: a tela
// o recebe da API (`GET /v1/acessos`) e manda de volta a versão aceita.
//
// Mudou o texto? Suba a versão. A criação de um acesso só passa com a
// versão de agora, e quem tinha a tela aberta com a antiga lê a nova.
// =====================================================================

export const TERMO_DO_ACESSO = Object.freeze({
  versao: '1',
  /** Desde quando vale (aaaa-mm-dd). */
  de: '2026-10-15',
  itens: Object.freeze([
    'O código deixa um sistema enviar as fichas da loja escolhida e consultar o que o Farol tem desse sistema. Ele não abre câmeras, alertas, análises nem outra loja.',
    'Quem tem o código envia em nome da loja. Entregue-o só a quem cuida do sistema e guarde-o como se guarda uma senha.',
    'O código vale 12 meses. Para antes se ficar 90 dias sem uso (fica suspenso até alguém da diretoria reativar) ou se for revogado.',
    'Desconfiou que o código vazou? Revogue na hora: o envio para, e as fichas que o sistema mandou são apagadas.',
    'O Farol registra quem criou, renovou, reativou e revogou cada acesso, e quando. Os outros da diretoria veem esses avisos no console.',
    'Pela porta, o Farol não recebe preço, custo, margem nem dado de cliente, e ignora o que não estiver na documentação.',
  ]),
});
