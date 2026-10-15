// =====================================================================
// A documentação da porta para outro sistema — página ABERTA (sem login)
// =====================================================================
// Para quem programa o sistema que a loja usa (o PDV, o ERP): como enviar
// ao Farol o cardápio e as fichas. É o endereço que a tela Conexões manda a
// diretoria entregar junto com o código de acesso.
//
// O conteúdo é o de `docs/integracao-fichas.md`: mudou a porta, mudam os
// dois. Não há dado de ninguém aqui — é texto fixo, igual para todos.
//
// Nada rola para o lado: o exemplo quebra a linha, e as tabelas de campos
// viram fichas no estreito.
// =====================================================================

import type { Metadata } from 'next';

import { Palavra } from '@/componentes/marca';

export const metadata: Metadata = {
  title: 'Enviar as fichas ao Farol — documentação',
  description: 'Como o sistema da loja envia o cardápio e as fichas técnicas ao Monitor Farol.',
};

const ENDERECO = 'https://api.monitorfarol.com.br/v1/integracao/fichas';

const EXEMPLO = `{
  "produtos": [
    {
      "nome": "X-Burger",
      "codigo": "1042",
      "categoria": "Burgers",
      "cozinha": true,
      "ingredientes": [
        { "nome": "Pão brioche", "quantidade": 1, "unidade": "unidade" },
        { "nome": "Blend da casa", "quantidade": 120, "unidade": "g" },
        { "nome": "Queijo prato", "quantidade": 2, "unidade": "fatia" },
        { "nome": "Cebola roxa", "quantidade": 10, "unidade": "g" }
      ],
      "variacoes": [
        { "nome": "Simples", "fator": 1 },
        { "nome": "Duplo", "fator": 2 }
      ],
      "adicionais": [
        { "nome": "Bacon", "faz": "acrescenta", "ingrediente": "Bacon fatiado", "quantidade": 20, "unidade": "g" },
        { "nome": "Sem cebola", "faz": "tira", "ingrediente": "Cebola roxa" },
        { "nome": "Ponto da carne", "faz": "observacao" }
      ]
    },
    {
      "nome": "Batata frita",
      "ingredientes": [
        { "nome": "Batata palito", "quantidade": 200, "unidade": "g" },
        { "nome": "Sal", "quantidade": 1, "unidade": "pitada" }
      ]
    },
    { "nome": "Refrigerante lata", "cozinha": false },
    {
      "nome": "Combo da casa",
      "combo": [
        { "produto": "X-Burger", "quantidade": 1 },
        { "produto": "Batata frita", "quantidade": 1 },
        { "produto": "Refrigerante lata", "quantidade": 1 }
      ]
    }
  ]
}`;

const RECEBIDO = `{
  "resultado": "atualizada",
  "produtos": 4,
  "com_ficha": 2,
  "sem_ficha": ["Refrigerante lata"],
  "de_fora": [],
  "soltos": [],
  "problemas": 0
}`;

const COM_DE_FORA = `{
  "resultado": "atualizada",
  "produtos": 2,
  "com_ficha": 1,
  "sem_ficha": ["Refrigerante lata"],
  "de_fora": [
    {
      "produto": "X-Burger",
      "problemas": [
        { "onde": "produtos[0].ingredientes[2]", "texto": "falta a quantidade." },
        { "onde": "produtos[0].adicionais[1]", "texto": "o produto não tem “Tomate” na ficha, para tirar." }
      ]
    },
    {
      "produto": "Combo da casa",
      "problemas": [
        { "onde": "produtos[3].combo[0]", "texto": "o produto “X-Burger”, que vem neste combo, ficou de fora." }
      ]
    }
  ],
  "soltos": [],
  "problemas": 3
}`;

const FORMA_ERRADA = `{
  "type": "https://dev.dmstecnologias.com/erros/regra-invalida",
  "title": "Regra inválida",
  "status": 422,
  "detail": "produtos[1].cozinha: era para ser verdadeiro ou falso (true ou false)",
  "request_id": "req-3m",
  "erro": "envio_invalido",
  "mensagem": "produtos[1].cozinha: era para ser verdadeiro ou falso (true ou false)"
}`;

const SO_VALIDADO = `{
  "resultado": "so_validado",
  "gravado": false,
  "produtos": 3,
  "com_ficha": 1,
  "sem_ficha": ["Refrigerante lata"],
  "de_fora": [ … como no envio … ],
  "soltos": [],
  "problemas": 3
}`;

const O_QUE_TEM = `{
  "sistema": "PDV da Casa",
  "loja": "Loja Centro",
  "recebido_em": "2026-10-11T17:02:11.000Z",
  "produtos": 4,
  "com_ficha": 2,
  "vence_em": "2027-10-11T17:02:11.000Z"
}`;

type Campo = [campo: string, preencher: string, oQueE: React.ReactNode];

const DO_PRODUTO: Campo[] = [
  ['nome', 'sempre', <>O nome como aparece no pedido. <b className="font-semibold text-farol-tinta">É a identidade do produto:</b> não pode repetir no envio (maiúscula, minúscula e acento não fazem diferença).</>],
  ['codigo', 'se quiser', 'O código do produto no seu sistema. Texto ou número.'],
  ['categoria', 'se quiser', 'Só para achar o produto na lista.'],
  ['cozinha', 'se quiser', <><Cod>false</Cod> para o que sai pronto, como a bebida em lata. Sem o campo, vale <Cod>true</Cod>.</>],
  ['ingredientes', 'se o produto tem ficha', <>A ficha, <b className="font-semibold text-farol-tinta">na ordem em que o produto é montado</b>. Sem ingredientes, o produto entra sem ficha.</>],
  ['variacoes', 'se o produto tem tamanhos', 'Ver abaixo.'],
  ['adicionais', 'se o cliente pode pedir a mais ou tirar', 'Ver abaixo.'],
  ['combo', 'se o produto é feito de outros', 'Ver abaixo.'],
];
const DO_INGREDIENTE: Campo[] = [
  ['nome', 'sempre', 'O nome do ingrediente.'],
  ['quantidade', 'sempre', <>Um número maior que zero. Aceita também o texto do número (<Cod>&quot;0,5&quot;</Cod> ou <Cod>&quot;0.5&quot;</Cod>).</>],
  ['unidade', 'sempre', <>Uma da lista: <Cod>g</Cod>, <Cod>kg</Cod>, <Cod>ml</Cod>, <Cod>l</Cod>, <Cod>unidade</Cod>, <Cod>fatia</Cod>, <Cod>folha</Cod>, <Cod>rodela</Cod>, <Cod>colher</Cod>, <Cod>pitada</Cod>.</>],
];
const DA_VARIACAO: Campo[] = [
  ['nome', 'sempre', '“Simples”, “Duplo”, “Grande”. Não pode repetir no mesmo produto.'],
  ['fator', 'se quiser', <>Quanto da ficha a variação usa: o Duplo usa <Cod>2</Cod>; a meia porção, <Cod>0.5</Cod>. Sem o campo, vale <Cod>1</Cod>.</>],
];
const DO_ADICIONAL: Campo[] = [
  ['nome', 'sempre', '“Bacon”, “Sem cebola”, “Ponto da carne”.'],
  ['faz', 'sempre', <><Cod>acrescenta</Cod>, <Cod>tira</Cod> ou <Cod>observacao</Cod>.</>],
  ['ingrediente', 'com acrescenta e tira', <>O que entra, ou o que sai. No <Cod>tira</Cod>, tem de ser um ingrediente <b className="font-semibold text-farol-tinta">da ficha deste produto</b>, escrito igual.</>],
  ['quantidade e unidade', 'se quiser, com acrescenta', 'Quanto entra. Os dois juntos, ou nenhum.'],
];
const DO_COMBO: Campo[] = [
  ['produto', 'sempre', <>O <Cod>nome</Cod> de outro produto <b className="font-semibold text-farol-tinta">deste mesmo envio</b>.</>],
  ['quantidade', 'se quiser', <>Quantos vêm no combo. Sem o campo, vale <Cod>1</Cod>.</>],
];
const RECUSAS: Array<[string, string, string]> = [
  ['400', 'corpo_invalido', 'O corpo não é JSON, ou veio vazio.'],
  ['400', 'parametro_invalido', 'somente_validar com um valor que não é true nem false.'],
  ['401', 'sem_credencial', 'Faltou o cabeçalho Authorization: Bearer <código>.'],
  ['401', 'credencial_invalida', 'O código não vale: não existe, foi copiado errado ou foi revogado. A resposta é a mesma nos três casos, de propósito.'],
  ['401', 'acesso_vencido', 'O código venceu (vale 12 meses). Peça à diretoria para renovar: sai um código novo. O type é chave-vencida.'],
  ['403', 'acesso_suspenso', 'O acesso ficou 90 dias sem uso e está suspenso. Peça à diretoria para reativar: o código continua o mesmo. O type é chave-suspensa.'],
  ['413', 'corpo_grande', 'O envio passa de 8 MB.'],
  ['415', 'tipo_invalido', 'O Content-Type não é application/json.'],
  ['422', 'envio_invalido', 'A forma do envio não serve. A mensagem diz o caminho do campo.'],
  ['422', 'nada_a_receber', 'Nenhum produto do envio está certo. A resposta traz de_fora.'],
  ['429', 'limite_de_chamadas', 'Chamadas demais em pouco tempo (ver Limites). O cabeçalho Retry-After diz em quantos segundos tentar de novo.'],
  ['500', 'erro_interno', 'Algo quebrou do nosso lado. Informe o request_id a quem cuida da conta no Farol.'],
];

function Cod({ children }: { children: React.ReactNode }) {
  return <code className="break-words rounded bg-farol-realce px-1 py-px font-mono text-[0.92em] text-farol-tinta">{children}</code>;
}

/** Um bloco de exemplo. Quebra a linha em vez de rolar para o lado. */
function Bloco({ children, rotulo }: { children: string; rotulo: string }) {
  return (
    <pre aria-label={rotulo} className="whitespace-pre-wrap break-words rounded-[10px] border border-farol-borda bg-farol-painel-2 px-3.5 py-3 font-mono text-[12.5px] leading-relaxed text-farol-tinta">
      {children}
    </pre>
  );
}

/** Os campos de um objeto: uma tabela no largo, uma ficha por campo no estreito. */
function Campos({ de, itens }: { de: string; itens: Campo[] }) {
  return (
    <div role="table" aria-label={`Os campos ${de}`} className="overflow-hidden rounded-[10px] border border-farol-borda">
      <div role="row" className="hidden grid-cols-[minmax(0,0.9fr)_minmax(0,1fr)_minmax(0,2.4fr)] gap-x-3 border-b border-farol-borda bg-farol-painel-2 px-3.5 py-2 text-xs font-semibold text-farol-suave sm:grid">
        <span role="columnheader">Campo</span>
        <span role="columnheader">Preencher</span>
        <span role="columnheader">O que é</span>
      </div>
      {itens.map(([campo, preencher, oQueE]) => (
        <div key={campo} role="row" className="grid grid-cols-1 gap-x-3 gap-y-0.5 border-b border-farol-borda px-3.5 py-2.5 text-[13.5px] last:border-b-0 sm:grid-cols-[minmax(0,0.9fr)_minmax(0,1fr)_minmax(0,2.4fr)]">
          <span role="cell" className="break-words font-mono text-[13px] font-semibold text-farol-tinta">
            {campo}
          </span>
          <span role="cell" className="text-farol-suave">
            <span className="sm:hidden">preencher: </span>
            {preencher}
          </span>
          <span role="cell" className="min-w-0 break-words text-farol-suave">
            {oQueE}
          </span>
        </div>
      ))}
    </div>
  );
}

function Secao({ id, titulo, children }: { id: string; titulo: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex min-w-0 flex-col gap-3">
      <h2 id={id} className="font-display text-xl font-semibold tracking-tight text-farol-tinta">
        {titulo}
      </h2>
      {children}
    </section>
  );
}

const SUB = 'mt-1 text-[15px] font-semibold text-farol-tinta';
const P = 'max-w-[72ch] text-farol-suave';
const forte = (t: string) => <b className="font-semibold text-farol-tinta">{t}</b>;

export default function Integracao() {
  return (
    <div className="min-h-dvh bg-farol-fundo text-[14.5px] leading-relaxed text-farol-tinta">
      <header className="border-b border-farol-borda bg-farol-painel">
        <div className="mx-auto flex w-full max-w-[860px] flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3.5 sm:px-6">
          <Palavra className="h-7 w-auto" />
          <span className="text-[13px] text-farol-suave">documentação para quem integra</span>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-[860px] flex-col gap-9 px-4 py-8 sm:px-6 sm:py-10">
        <div className="flex flex-col gap-3">
          <h1 className="font-display text-[28px] font-semibold leading-tight tracking-tight">Enviar as fichas ao Farol</h1>
          <p className={P}>
            Esta página é para quem programa o sistema que a loja usa para o cardápio e as fichas técnicas — o PDV, o ERP, o sistema de estoque. Ela descreve a{' '}
            {forte('porta')} por onde esse sistema envia ao Monitor Farol o que a loja vende e do que cada produto é feito.
          </p>
          <p className={P}>
            O Farol usa as fichas para saber como cada produto deve ser montado. Ele {forte('não recebe preço, custo, margem nem dado de cliente')} — e ignora
            qualquer campo que não esteja descrito aqui.
          </p>
        </div>

        <Secao id="codigo" titulo="Antes de começar: o código de acesso">
          <p className={P}>
            Quem cria o acesso é a diretoria da conta, no console do Farol (em {forte('Conexões')}, no cartão {forte('Outro sistema')}, botão{' '}
            {forte('Criar acesso')}). Ela escolhe a loja e recebe um {forte('código de acesso')}, que começa por <Cod>dms_ap_farol_</Cod> (os criados antes de
            14/10/2026 começam por <Cod>farol_</Cod> e continuam valendo até serem revogados).
          </p>
          <ul className="flex max-w-[72ch] list-disc flex-col gap-1.5 pl-5 text-farol-suave">
            <li>O código vale para {forte('uma loja')}. Para outra loja, é outro código.</li>
            <li>Os 6 últimos caracteres conferem o resto: um código copiado pela metade, ou com uma letra trocada, é recusado na hora.</li>
            <li>Ele aparece {forte('uma vez')}, na hora em que é criado. O Farol não o guarda: se for perdido, a diretoria renova o acesso, e sai um código novo.</li>
            <li>
              O código {forte('vale 12 meses')}. Antes de vencer, a diretoria renova: sai um código novo, e o de antes continua valendo por {forte('mais 7 dias')}, para dar
              tempo de trocar no seu sistema. A consulta (GET) diz até quando o código usado vale (<Cod>vence_em</Cod>): confira de vez em quando.
            </li>
            <li>
              {forte('90 dias sem nenhuma chamada')}, o acesso fica {forte('suspenso')}. A diretoria reativa com um clique, e o código continua o mesmo. Vencido ou suspenso,
              as fichas que o seu sistema já enviou ficam no Farol; só não se atualizam.
            </li>
            <li>Trate o código como uma senha: guarde-o na configuração do seu sistema, fora do código-fonte, e não o escreva em registro (log).</li>
            <li>Quando a diretoria {forte('revoga')} o acesso, o código para de valer na hora, e as fichas que o seu sistema enviou são apagadas do Farol.</li>
          </ul>
          <p className={P}>Você não precisa de usuário nem de senha do console.</p>
        </Secao>

        <Secao id="endereco" titulo="O endereço e a identificação">
          <Bloco rotulo="O endereço da porta">{ENDERECO}</Bloco>
          <p className={P}>Toda chamada leva o código no cabeçalho:</p>
          <Bloco rotulo="Os cabeçalhos de toda chamada">{'Authorization: Bearer dms_ap_farol_...\nContent-Type: application/json'}</Bloco>
          <p className={P}>A loja é a do código. Nada no corpo do envio escolhe a loja.</p>
        </Secao>

        <Secao id="enviar" titulo="Enviar as fichas — PUT">
          <p className={P}>
            O corpo é um objeto com a lista <Cod>produtos</Cod>. {forte('O envio é o cardápio inteiro da loja')}: ele substitui o que o Farol tinha dessa loja. Para
            tirar um produto, envie a lista sem ele.
          </p>
          <Bloco rotulo="Um envio de exemplo">{EXEMPLO}</Bloco>

          <h3 className={SUB}>O produto</h3>
          <Campos de="do produto" itens={DO_PRODUTO} />

          <h3 className={SUB}>
            O ingrediente — <Cod>ingredientes[]</Cod>
          </h3>
          <Campos de="do ingrediente" itens={DO_INGREDIENTE} />
          <p className={P}>
            A unidade pode vir do jeito que se costuma escrever (<Cod>gr</Cod>, <Cod>gramas</Cod>, <Cod>quilo</Cod>, <Cod>litros</Cod>, <Cod>un</Cod>,{' '}
            <Cod>unidades</Cod>, <Cod>fatias</Cod>, <Cod>folhas</Cod>, <Cod>rodelas</Cod>, <Cod>colheres</Cod>, <Cod>pitadas</Cod>). O que não é da lista —{' '}
            <Cod>pct</Cod>, <Cod>cx</Cod>, <Cod>fls</Cod> — deixa o produto de fora.
          </p>
          <p className={P}>
            Um preparo da casa (um molho, um blend) entra como {forte('um ingrediente')}, com o nome dele. A ficha do preparo não é desmontada dentro do produto.
          </p>

          <h3 className={SUB}>
            A variação — <Cod>variacoes[]</Cod>
          </h3>
          <Campos de="da variação" itens={DA_VARIACAO} />

          <h3 className={SUB}>
            O adicional — <Cod>adicionais[]</Cod>
          </h3>
          <Campos de="do adicional" itens={DO_ADICIONAL} />
          <p className={P}>
            <Cod>observacao</Cod> é o que a cozinha lê e não põe nem tira nada (“ponto da carne”).
          </p>

          <h3 className={SUB}>
            O combo — <Cod>combo[]</Cod>
          </h3>
          <Campos de="do combo" itens={DO_COMBO} />
        </Secao>

        <Secao id="resposta" titulo="O que o Farol responde">
          <h3 className={SUB}>Recebido — 200</h3>
          <Bloco rotulo="A resposta de um envio recebido">{RECEBIDO}</Bloco>
          <ul className="flex max-w-[72ch] list-disc flex-col gap-1.5 pl-5 text-farol-suave">
            <li>
              <Cod>resultado</Cod>: <Cod>atualizada</Cod> quando as fichas da loja mudaram; <Cod>nada_mudou</Cod> quando o envio traz o que a loja já tinha. Enviar
              de novo a mesma coisa não muda nada.
            </li>
            <li>
              <Cod>produtos</Cod> e <Cod>com_ficha</Cod>: quantos produtos entraram, e quantos deles com ficha.
            </li>
            <li>
              <Cod>sem_ficha</Cod>: os produtos que entraram sem ingredientes. Não é erro.
            </li>
            <li>
              <Cod>de_fora</Cod>: os produtos que {forte('não entraram')}, com o motivo de cada um.
            </li>
          </ul>

          <h3 className={SUB}>Entra o que está certo</h3>
          <p className={P}>
            Um produto com qualquer problema fica {forte('inteiro de fora')}, e os outros entram. O Farol não guarda meia ficha: ele conferiria a montagem contra uma
            ficha com um ingrediente a menos. O combo que leva um produto que ficou de fora fica de fora junto.
          </p>
          <p className={P}>A resposta continua sendo 200, e diz o que ficou de fora e onde está o problema, no que foi enviado:</p>
          <Bloco rotulo="A resposta de um envio com produtos de fora">{COM_DE_FORA}</Bloco>
          <p className={P}>
            Quem cuida da loja vê a mesma lista no console, na tela {forte('Fichas')}. {forte('Confira de_fora a cada envio:')} um produto que ficou de fora não tem
            ficha no Farol até o envio seguinte trazê-lo certo.
          </p>

          <h3 className={SUB}>O que recusa o envio inteiro</h3>
          <div role="table" aria-label="As respostas que recusam o envio" className="overflow-hidden rounded-[10px] border border-farol-borda">
            {RECUSAS.map(([resposta, erro, quando]) => (
              <div key={`${resposta}-${erro}`} role="row" className="grid grid-cols-1 gap-x-3 gap-y-0.5 border-b border-farol-borda px-3.5 py-2.5 text-[13.5px] last:border-b-0 sm:grid-cols-[52px_minmax(0,1fr)_minmax(0,2.2fr)]">
                <span role="cell" className="font-mono font-semibold text-farol-tinta">
                  {resposta}
                </span>
                <span role="cell" className="break-words font-mono text-[13px] text-farol-tinta">
                  {erro}
                </span>
                <span role="cell" className="min-w-0 break-words text-farol-suave">
                  {quando}
                </span>
              </div>
            ))}
          </div>
          <p className={P}>Quando o envio é recusado, as fichas que a loja tinha continuam como estavam.</p>

          <h3 className={SUB}>A forma do erro</h3>
          <p className={P}>
            Todo erro da porta vem em <Cod>application/problem+json</Cod>, no Padrão de integração da DMS (RFC 9457): os mesmos nomes em todo produto da DMS. Junto
            vêm o <Cod>erro</Cod> e a <Cod>mensagem</Cod> do Farol:
          </p>
          <Bloco rotulo="A resposta de um envio com a forma errada">{FORMA_ERRADA}</Bloco>
          <ul className="flex max-w-[72ch] list-disc flex-col gap-1.5 pl-5 text-farol-suave">
            <li>
              <Cod>erro</Cod> é para o seu programa: estável, não muda de texto. Decida por ele (ou por <Cod>type</Cod>).
            </li>
            <li>
              <Cod>mensagem</Cod> (igual a <Cod>detail</Cod>) é para a pessoa: diz o que fazer.
            </li>
            <li>
              <Cod>request_id</Cod> identifica a chamada no registro do Farol. Diga-o a quem cuida da conta quando pedir ajuda.
            </li>
            <li>
              O 401 traz o cabeçalho <Cod>WWW-Authenticate: Bearer</Cod>.
            </li>
          </ul>
          <p className={P}>
            A forma errada é erro de programação, e por isso recusa tudo, em vez de deixar um produto de fora. São erros de forma: <Cod>produtos</Cod> não ser uma
            lista (ou vir vazia); um produto, ingrediente, variação, adicional ou item de combo que não é um objeto; faltar o <Cod>nome</Cod>; vir texto onde vai{' '}
            <Cod>true</Cod>/<Cod>false</Cod>; vir um objeto ou uma lista onde vai um texto ou um número.
          </p>
        </Secao>

        <Secao id="so-validar" titulo="Conferir sem gravar — PUT com somente_validar">
          <p className={P}>
            O mesmo envio, com{' '}
            <span className="whitespace-nowrap">
              <Cod>?somente_validar=true</Cod>
            </span>{' '}
            no endereço: o Farol confere tudo e responde o que entraria, {forte('sem gravar nada')} — as fichas
            da loja, a data do último envio e o computador da loja ficam como estavam. Serve para montar a integração sem mexer na loja.
          </p>
          <Bloco rotulo="A resposta de uma conferência">{SO_VALIDADO}</Bloco>
          <p className={P}>
            O que o envio recusa, a conferência recusa igual (422, <Cod>envio_invalido</Cod> ou <Cod>nada_a_receber</Cod>). Só <Cod>true</Cod> e <Cod>false</Cod>{' '}
            valem:{' '}
            <span className="whitespace-nowrap">
              <Cod>?somente_validar=1</Cod>
            </span>{' '}
            é recusado (400), para que ninguém grave achando que só conferia.
          </p>
        </Secao>

        <Secao id="conferir" titulo="Conferir o código e o último envio — GET">
          <p className={P}>No mesmo endereço, com o mesmo cabeçalho. Serve para testar o código antes do primeiro envio e para ver o que o Farol tem do seu sistema:</p>
          <Bloco rotulo="A resposta do GET">{O_QUE_TEM}</Bloco>
          <p className={P}>
            <Cod>recebido_em</Cod>, <Cod>produtos</Cod> e <Cod>com_ficha</Cod> vêm vazios (<Cod>null</Cod>) enquanto o sistema não enviou nada.{' '}
            <Cod>vence_em</Cod> é até quando o código usado nesta chamada vale: o código de antes de uma renovação para 7 dias depois dela; o novo, em 12 meses.
          </p>
        </Secao>

        <Secao id="limites" titulo="Limites, e quando enviar">
          <ul className="flex max-w-[72ch] list-disc flex-col gap-1.5 pl-5 text-farol-suave">
            <li>Até 5.000 produtos por envio, e 300 ingredientes por produto.</li>
            <li>Até 8 MB por envio.</li>
            <li>Nomes com até 200 letras (o que passar é cortado).</li>
          </ul>
          <p className={P}>Chamadas, por código de acesso:</p>
          <ul className="flex max-w-[72ch] list-disc flex-col gap-1.5 pl-5 text-farol-suave">
            <li>Envio (PUT): até 12 por hora.</li>
            <li>
              Conferência (PUT com <Cod>somente_validar=true</Cod>): até 60 por hora.
            </li>
            <li>Consulta (GET): até 60 por minuto.</li>
            <li>E, somando todos os códigos da conta: 60 envios por hora e 240 consultas por minuto.</li>
          </ul>
          <p className={P}>
            Passou do limite, a resposta é 429 com o cabeçalho <Cod>Retry-After</Cod> (em segundos). Espere esse tempo antes de tentar de novo: repetir antes não
            adianta.
          </p>
          <p className={P}>
            Envie quando o cardápio ou uma ficha mudar — ou uma vez por dia, se for mais simples. Ficha técnica não muda a toda hora: não é preciso enviar a cada
            pedido.
          </p>
        </Secao>

        <Secao id="o-que-faz" titulo="O que o Farol faz com o que recebe">
          <ul className="flex max-w-[72ch] list-disc flex-col gap-1.5 pl-5 text-farol-suave">
            <li>Guarda o cardápio e as fichas da loja, no formato dele, e mostra na tela Fichas.</li>
            <li>Envia uma cópia ao computador do Farol que fica na loja.</li>
            <li>{forte('Não')} guarda nem repassa preço, custo ou dado de cliente: esses campos nem são lidos.</li>
            <li>
              Uma loja recebe as fichas de um lugar só. Se a loja tinha fichas importadas por planilha, elas ficam até o primeiro envio do seu sistema; aí as do
              sistema entram no lugar.
            </li>
          </ul>
        </Secao>
      </main>
    </div>
  );
}
