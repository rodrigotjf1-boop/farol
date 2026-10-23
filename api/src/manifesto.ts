// O MANIFESTO da porta de integração (Padrão DMS §13; Hub DMS, F4 parte A; pacote 0.7.2): a documentação pública da
// porta das fichas, montada do código — as duas rotas, os limites (as constantes da própria porta), os exemplos e a
// credencial (o acesso próprio). Servido SEM credencial em `/.well-known/dms-manifesto`, fora da guarda de partida (não
// usa o banco), e guardado em `docs/dms-manifesto.json`: o teste confere que o arquivo é o que o código monta, e
// `ATUALIZAR_MANIFESTO=1` regrava.
//
// Sem permissões nomeadas: o código de acesso tem um uso só (enviar e consultar as fichas da loja escolhida), dito no
// termo que a diretoria aceita ao criar o código (`termo-do-acesso.ts`). Fica de fora o que não é a porta: o console, o
// agente da loja, a distribuição, o transporte dos alertas (`fart_`, credencial que não é do Padrão) e o lado de cliente
// do Regem.

import type { FastifyInstance } from 'fastify';

import { CAMINHO_MANIFESTO, montarManifesto, type ManifestoDms } from './dms/integracao-dms.js';
import {
  LIMITE_DE_CONSULTAS_DA_CONTA_POR_MINUTO,
  LIMITE_DE_CONSULTAS_POR_MINUTO,
  LIMITE_DE_ENVIOS_DA_CONTA_POR_HORA,
  LIMITE_DE_ENVIOS_POR_HORA,
  LIMITE_DE_VALIDACOES_POR_HORA,
} from './rotas/acessos.js';

/** O endereço público da API: o manifesto é o mesmo em todo ambiente (o arquivo do repositório confere com ele). */
export const BASE_DO_MANIFESTO = 'https://api.monitorfarol.com.br';

/** A versão do contrato da porta (Padrão §12). */
export const VERSAO_DO_CONTRATO = '1.0.0';

const FICHAS = '/v1/integracao/fichas';

// Os exemplos são os da documentação da porta (`docs/integracao-fichas.md`), fictícios.
const ENVIO = {
  produtos: [
    {
      nome: 'X-Burger',
      codigo: '1042',
      categoria: 'Burgers',
      cozinha: true,
      ingredientes: [
        { nome: 'Pão brioche', quantidade: 1, unidade: 'unidade' },
        { nome: 'Blend da casa', quantidade: 120, unidade: 'g' },
        { nome: 'Queijo prato', quantidade: 2, unidade: 'fatia' },
      ],
      variacoes: [
        { nome: 'Simples', fator: 1 },
        { nome: 'Duplo', fator: 2 },
      ],
      adicionais: [
        { nome: 'Bacon', faz: 'acrescenta', ingrediente: 'Bacon fatiado', quantidade: 20, unidade: 'g' },
        { nome: 'Ponto da carne', faz: 'observacao' },
      ],
    },
    { nome: 'Refrigerante lata', cozinha: false },
  ],
};

let guardado: ManifestoDms | null = null;

/** O manifesto da porta (montado uma vez: é o mesmo enquanto o processo vive). */
export function manifestoDaPorta(): ManifestoDms {
  guardado ??= montarManifesto({
    produto: 'farol',
    versao: VERSAO_DO_CONTRATO,
    titulo: 'Porta das fichas do Farol',
    descricao:
      'O sistema da loja (o PDV, o ERP) envia as fichas técnicas do cardápio e consulta o que o Farol tem dele. A ' +
      'credencial é o código de acesso que a diretoria cria no console, para uma loja; ele não abre câmeras, alertas, ' +
      'análises nem outra loja.',
    base: BASE_DO_MANIFESTO,
    permissoes: {},
    limite: [
      { porMinuto: LIMITE_DE_CONSULTAS_POR_MINUTO, por: 'chave' },
      { porMinuto: LIMITE_DE_CONSULTAS_DA_CONTA_POR_MINUTO, por: 'empresa' },
    ],
    rotas: [
      {
        metodo: 'PUT',
        caminho: FICHAS,
        resumo:
          'Envia as fichas da loja do código: o envio é o cardápio inteiro e substitui o que o Farol tinha. Com ' +
          `?somente_validar=true, só confere (cota própria: ${LIMITE_DE_VALIDACOES_POR_HORA} por hora, por código).`,
        permissao: null,
        escrita: 'substituicao',
        limite: [
          { porHora: LIMITE_DE_ENVIOS_POR_HORA, por: 'chave' },
          { porHora: LIMITE_DE_ENVIOS_DA_CONTA_POR_HORA, por: 'empresa' },
        ],
        exemploPedido: ENVIO,
        exemploResposta: { resultado: 'atualizada', produtos: 2, com_ficha: 1, sem_ficha: ['Refrigerante lata'], de_fora: [], soltos: [], problemas: 0 },
      },
      {
        metodo: 'GET',
        caminho: FICHAS,
        resumo: 'Confere o código e o último envio: o sistema, a loja, quando chegou, quantos produtos e até quando o código vale.',
        permissao: null,
        exemploResposta: { sistema: 'PDV da Casa', loja: 'Loja Centro', recebido_em: '2026-10-11T17:02:11.000Z', produtos: 2, com_ficha: 1, vence_em: '2027-10-11T17:02:11.000Z' },
      },
    ],
    credenciais: ['acesso_proprio'],
  });
  return guardado;
}

/** A rota do manifesto, sem credencial. */
export function rotaDoManifesto(app: FastifyInstance): void {
  app.get(CAMINHO_MANIFESTO, async (_req, resposta) => {
    resposta.header('cache-control', 'public, max-age=300');
    return manifestoDaPorta();
  });
}
