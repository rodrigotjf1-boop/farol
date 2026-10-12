"""Fila persistente de análises.

O agente roda num PC de loja: cai luz, cai internet, alguém desliga no
fim do expediente. Uma fila em memória perde o que estava esperando — e o
que estava esperando é justamente o evento que aconteceu quando a
internet caiu, ou seja, o mais provável de importar.

SQLite porque já vem com o Python, sobrevive a desligamento no meio da
escrita (WAL) e não precisa de serviço rodando ao lado.

**A imagem não entra no banco.** Fica em arquivo no spool e a fila guarda o
caminho: JPEG de 640 px dá ~60 KB, e dez mil deles dentro do SQLite
transformam um arquivo de controle de 2 MB num de 600 MB, com VACUUM e
backup proporcionais.

## Chave de idempotência

Gerada **no cliente**, no momento de enfileirar, a partir de
`(regra, versão do critério, ponto, phash, minuto)`. Isso dá duas coisas:

1. **Retry não cobra duas vezes.** Se a resposta se perdeu no caminho mas o
   julgamento aconteceu, a nova tentativa reaproveita em vez de pagar de novo.
2. **Quadro quase idêntico no mesmo minuto colapsa** — segunda camada de
   deduplicação, agora na fronteira do dinheiro.

Idempotência trata do **julgamento**; o silêncio entre alertas é outra
camada e vive no motor de regras. Confundir as duas faz a loja receber o
mesmo alerta de minuto em minuto, ou nunca mais recebê-lo.
"""

from __future__ import annotations

import json
import re
import sqlite3
import threading
from dataclasses import dataclass
from datetime import datetime, timedelta
from enum import Enum
from hashlib import sha256
from pathlib import Path
from typing import Any

from farol_agent.modelos import Resultado, Veredito, Via


class EstadoItem(str, Enum):
    PENDENTE = "pendente"
    ENVIANDO = "enviando"
    CONCLUIDO = "concluido"
    FALHOU = "falhou"          # esgotou as tentativas
    DESCARTADO = "descartado"  # expirou antes de ser julgado


# Quanto tempo uma análise ainda vale a pena. Alerta de "bancada suja" de
# seis horas atrás não serve para agir, só para estatística — e pagar o
# modelo por ele é desperdício.
VALIDADE_PADRAO = {
    "urgente": timedelta(minutes=5),
    "intermediaria": timedelta(hours=2),
    "leve": timedelta(hours=24),
}

# Espera entre tentativas. Cresce porque a causa mais comum de falha é
# internet oscilando, e martelar a cada segundo não ajuda e gasta bateria
# do nobreak.
BACKOFF_SEG = [5, 30, 120, 600, 1800]


@dataclass
class ItemFila:
    id: int
    chave: str
    regra_id: str
    ponto_id: str
    zona_id: str | None
    prioridade: str
    criterio: str
    criterio_versao: int
    imagem_caminho: str
    capturado_em: datetime
    expira_em: datetime
    tentativas: int
    estado: EstadoItem
    contexto: dict[str, Any]
    # pHash do quadro julgado, em hexadecimal. Sobe com o evento para a
    # nuvem conseguir agrupar vereditos sobre a MESMA cena.
    phash: str | None = None


_ESQUEMA = """
create table if not exists analise (
  id              integer primary key autoincrement,
  chave           text    not null unique,
  regra_id        text    not null,
  ponto_id        text    not null,
  zona_id         text,
  phash           text,
  prioridade      text    not null,
  criterio        text    not null,
  criterio_versao integer not null,
  imagem_caminho  text    not null,
  contexto        text    not null default '{}',
  capturado_em    text    not null,
  expira_em       text    not null,
  estado          text    not null default 'pendente',
  tentativas      integer not null default 0,
  proxima_em      text    not null,
  erro            text,
  -- veredito, quando houver
  resultado       text,
  confianca       real,
  motivo          text,
  via             text,
  modelo          text,
  custo_centavos  real,
  latencia_ms     integer,
  julgado_em      text,
  -- o que o juiz mediu na cena (o detector: quantos objetos viu)
  medida          real
);

create index if not exists idx_analise_proxima
  on analise (estado, proxima_em);

create index if not exists idx_analise_regra
  on analise (regra_id, julgado_em);

-- O que de fato virou alerta. Serve a duas coisas: a janela de silêncio do
-- motor e o buffer offline — quando a internet volta, é daqui que sai o que
-- o console ainda não recebeu.
--
-- `evento` é o corpo EXATO que sobe para a nuvem, gravado no instante do
-- alerta. A primeira versão desta tabela guardava só regra, zona e hora, e
-- com isso não dava para remontar o evento depois: o "buffer offline"
-- existia no comentário e não no código (ERR-019).
--
-- `enviado`: 0 = falta subir · 1 = a nuvem recebeu · 2 = a nuvem recusou
-- (regra apagada ou de outra loja — não adianta insistir).
create table if not exists alerta (
  id       integer primary key autoincrement,
  regra_id text    not null,
  zona_id  text,
  ts       text    not null,
  enviado  integer not null default 0,
  chave    text,
  evento   text
);

create index if not exists idx_alerta_regra on alerta (regra_id, ts desc);
create index if not exists idx_alerta_envio on alerta (enviado, ts);

-- O que o agente OLHOU, e no que deu, por hora, critério e canal.
--
-- Até aqui a nuvem só recebia o "não conforme" que virou alerta. Tudo o
-- mais — o conforme, o "não deu para avaliar", a câmera sem cena, o
-- critério sem juiz — ficava nesta máquina e sumia na limpeza. Quem
-- olhava o console via uma loja calada e não tinha como saber se era
-- cozinha em ordem ou sistema parado. São coisas opostas e tinham a mesma
-- cara.
--
-- Cada olhada termina em UMA destas: sem_juiz, sem_quadro, sem_cena,
-- sem_condicao, sem_gatilho, observadas, em_silencio, repetidas,
-- ja_julgadas ou enfileiradas. O que foi enfileirado vira depois conforme,
-- não conforme, não avaliável ou falha.
--
-- `sem_gatilho` é a olhada do critério com ESTUDO em que o contexto valia
-- e nenhum gatilho abriu a análise. Com `sem_condicao`, é o funil: olhadas
-- → com contexto → com gatilho → julgadas.
--
-- `observadas` é a olhada do critério em "observando": passou pelo contexto
-- (o porteiro deixou) e parou ali, de propósito — sem julgamento e sem custo.
--
-- `sem_condicao` é a olhada que o porteiro segurou: o critério pede gente
-- na área e não havia ninguém (ou pede a área livre e havia gente, ou pede
-- movimento e nada se mexeu). Não é análise, não vai à nuvem e não custa.
--
-- `vazias_guardadas` não é um desfecho a mais: é a PARTE de `ja_julgadas`
-- em que a cena era idêntica a uma que a nuvem não conseguiu avaliar há
-- pouco, e por isso não foi paga de novo (motor.py, "a resposta vazia
-- guardada"). Fica contada à parte porque, para dizer em quantas olhadas o
-- critério não pôde ser avaliado, ela conta junto com `nao_avaliaveis`.
--
-- Os contadores são somados na hora em que a coisa acontece, e não
-- recontados da tabela `analise`: ela é limpa, e um resumo que dependesse
-- dela encolheria sozinho.
--
-- `versao` sobe a cada soma. A subida só marca "a nuvem tem" se a versão
-- ainda for a que foi lida — uma soma que chegou no meio não se perde.
-- `estado`: 0 = a nuvem tem esta versão · 1 = falta subir · 2 = recusada.
create table if not exists resumo_hora (
  hora               text    not null,
  regra_id           text    not null,
  zona_id            text    not null,
  capturas           integer not null default 0,
  sem_juiz           integer not null default 0,
  sem_quadro         integer not null default 0,
  sem_cena           integer not null default 0,
  sem_condicao       integer not null default 0,
  sem_gatilho        integer not null default 0,
  observadas         integer not null default 0,
  em_silencio        integer not null default 0,
  repetidas          integer not null default 0,
  ja_julgadas        integer not null default 0,
  vazias_guardadas   integer not null default 0,
  enfileiradas       integer not null default 0,
  conformes          integer not null default 0,
  nao_conformes      integer not null default 0,
  nao_avaliaveis     integer not null default 0,
  falhas             integer not null default 0,
  alertas            integer not null default 0,
  soma_confianca     real    not null default 0,
  com_confianca      integer not null default 0,
  soma_latencia_ms   integer not null default 0,
  com_latencia       integer not null default 0,
  custo_centavos     real    not null default 0,
  julgadas_loja      integer not null default 0,
  julgadas_nuvem     integer not null default 0,
  soma_medida        real    not null default 0,
  com_medida         integer not null default 0,
  max_medida         real,
  extras             integer not null default 0,
  extras_fora        integer not null default 0,
  ultimo_resultado   text,
  ultimo_motivo      text,
  ultimo_impedimento text,
  ultima_em          text,
  versao             integer not null default 0,
  estado             integer not null default 1,
  primary key (hora, regra_id, zona_id)
);

create index if not exists idx_resumo_estado on resumo_hora (estado, hora);

-- O uso da máquina de análise (este computador), por hora.
--
-- De cada peça ficam a soma e a quantidade de amostras — para a média — e
-- o maior valor, que é o pico. Peça que não deu para medir numa amostra
-- não entra na quantidade DELA: "não medi" não vira zero na média.
-- O disco é uma posição, não uma média: vale a última leitura da hora.
--
-- `versao` e `estado` funcionam como no resumo: a linha da hora corrente
-- sobe várias vezes, e só fica "a nuvem tem" se nada somou no caminho.
create table if not exists uso_hora (
  hora            text    primary key,
  amostras        integer not null default 0,
  cpu_soma        real    not null default 0,
  cpu_n           integer not null default 0,
  cpu_max         real,
  mem_soma        real    not null default 0,
  mem_n           integer not null default 0,
  mem_max         real,
  gpu_soma        real    not null default 0,
  gpu_n           integer not null default 0,
  gpu_max         real,
  proc_cpu_soma   real    not null default 0,
  proc_cpu_n      integer not null default 0,
  proc_cpu_max    real,
  proc_mem_max_mb real,
  disco_livre_gb  real,
  disco_total_gb  real,
  versao          integer not null default 0,
  estado          integer not null default 1
);
"""

# O que se soma no resumo. Lista fechada: os nomes viram texto de SQL, e
# nome de coluna que vem de fora não entra em consulta.
CONTADORES_DO_RESUMO = (
    "capturas",
    "sem_juiz",
    "sem_quadro",
    "sem_cena",
    "sem_condicao",
    "sem_gatilho",
    "observadas",
    "em_silencio",
    "repetidas",
    "ja_julgadas",
    # Parte de `ja_julgadas`, e não um desfecho a mais (ver o esquema).
    "vazias_guardadas",
    "enfileiradas",
    "conformes",
    "nao_conformes",
    "nao_avaliaveis",
    "falhas",
    "alertas",
)

_SOMAS_DO_VEREDITO = (
    "soma_confianca",
    "com_confianca",
    "soma_latencia_ms",
    "com_latencia",
    "custo_centavos",
    # Onde o julgamento foi feito. A soma das duas é a dos três resultados.
    "julgadas_loja",
    "julgadas_nuvem",
    # A medida da cena (quantos o detector viu): soma e quantidade, para a
    # média da hora. O maior valor vai à parte, em `_MAXIMOS_DO_RESUMO`.
    "soma_medida",
    "com_medida",
    # As olhadas EXTRAS do vigia (vigia.py). Elas já estão contadas nos
    # resultados: aqui fica quantas foram, e quantas deram fora do
    # critério. Descontadas, sobra a amostra de rotina, que cai em
    # instantes regulares — a que serve para dizer "em quanto do tempo".
    "extras",
    "extras_fora",
)

# O que se guarda como MAIOR valor da hora, e não como soma.
_MAXIMOS_DO_RESUMO = ("max_medida",)

_TEXTOS_DO_RESUMO = ("ultimo_resultado", "ultimo_motivo", "ultimo_impedimento", "ultima_em")

_CONTADOR_DO_RESULTADO = {
    "conforme": "conformes",
    "nao_conforme": "nao_conformes",
    "nao_avaliavel": "nao_avaliaveis",
}

# Texto de erro vem de biblioteca, de modelo e de câmera, e sobe para a
# nuvem. Endereço com senha embutida e chave de API não podem ir junto.
_SEGREDOS = (
    # usuário e senha embutidos no endereço: rtsp://admin:senha@host
    (re.compile(r"://[^/\s:@]+:[^@\s]+@"), "://…@"),
    # o cabeçalho de autorização, com o esquema na frente do valor
    (re.compile(r"(?i)\b(bearer|basic)\s+[A-Za-z0-9._~+/=\-]{6,}"), r"\1 …"),
    # chave com cara de chave
    (re.compile(r"\b(?:sk|key|tok)[-_][A-Za-z0-9_\-]{8,}"), "…"),
    # nome=valor, inclusive dentro de endereço (…&password=…&channel=1)
    (
        re.compile(
            r"(?i)\b(senha|password|passwd|pwd|token|secret|segredo|api[-_]?key)(\s*[=:]\s*)[^\s&]+"
        ),
        r"\1\2…",
    ),
)


def sem_segredo(texto: str | None, limite: int = 300) -> str | None:
    """O texto sem o que parece segredo, e curto o bastante para viajar."""
    if not texto:
        return None
    for padrao, troca in _SEGREDOS:
        texto = padrao.sub(troca, texto)
    return texto.strip()[:limite] or None


# Colunas que entraram depois da primeira instalação. `create table if not
# exists` não toca em tabela que já existe, e a fila de uma loja em operação
# existe há semanas — sem isto, atualizar o agente quebraria no primeiro
# insert com "no such column".
_COLUNAS_NOVAS = (
    ("analise", "phash", "text"),
    ("alerta", "chave", "text"),
    ("alerta", "evento", "text"),
    ("resumo_hora", "julgadas_loja", "integer not null default 0"),
    ("resumo_hora", "julgadas_nuvem", "integer not null default 0"),
    ("analise", "medida", "real"),
    ("resumo_hora", "soma_medida", "real not null default 0"),
    ("resumo_hora", "com_medida", "integer not null default 0"),
    ("resumo_hora", "max_medida", "real"),
    ("resumo_hora", "sem_condicao", "integer not null default 0"),
    ("resumo_hora", "extras", "integer not null default 0"),
    ("resumo_hora", "extras_fora", "integer not null default 0"),
    ("resumo_hora", "observadas", "integer not null default 0"),
    ("resumo_hora", "sem_gatilho", "integer not null default 0"),
    ("resumo_hora", "vazias_guardadas", "integer not null default 0"),
)


def _agora_iso(ts: datetime) -> str:
    return ts.isoformat(timespec="seconds")


class Fila:
    """Fila de análises em SQLite, segura para uso concorrente no processo."""

    def __init__(self, caminho: str | Path, spool: str | Path | None = None) -> None:
        self.caminho = Path(caminho)
        self.caminho.parent.mkdir(parents=True, exist_ok=True)
        self.spool = Path(spool) if spool else self.caminho.parent / "spool"
        self.spool.mkdir(parents=True, exist_ok=True)

        # check_same_thread=False + lock próprio: o agente tem a captura num
        # thread e o envio em outro, e é mais simples serializar aqui do que
        # abrir uma conexão por thread.
        self._con = sqlite3.connect(self.caminho, check_same_thread=False)
        self._con.row_factory = sqlite3.Row
        self._lock = threading.Lock()

        with self._lock:
            # WAL: sobrevive a desligamento no meio da escrita, que é o modo
            # normal de desligar um PC de cozinha.
            self._con.execute("pragma journal_mode=WAL")
            self._con.execute("pragma synchronous=NORMAL")
            self._con.executescript(_ESQUEMA)
            for tabela, coluna, tipo in _COLUNAS_NOVAS:
                existentes = {
                    l["name"]
                    for l in self._con.execute(f"pragma table_info({tabela})")
                }
                if coluna not in existentes:
                    self._con.execute(
                        f"alter table {tabela} add column {coluna} {tipo}"
                    )
            self._con.commit()

    # ───────────────────────────── chave ──────────────────────────────

    @staticmethod
    def chave_idempotente(
        regra_id: str,
        criterio_versao: int,
        ponto_id: str,
        phash: int,
        ts: datetime,
        *,
        por_olhada: bool = False,
        zona_id: str | None = None,
        contexto: str | None = None,
    ) -> str:
        """Determinística: a mesma cena, na mesma regra, no mesmo minuto.

        `por_olhada` troca o minuto pelo segundo: é para os critérios em
        que cada olhada conta como medida (presença, contagem). O posto
        vazio dá a MESMA cena duas vezes no minuto, e com a chave por
        minuto a segunda olhada sumia como "já julgada". Continua
        determinística — a mesma olhada, repetida, dá a mesma chave.

        `zona_id` é a área do canal. O mesmo critério pode valer em duas
        áreas da mesma câmera, e dois recortes parecidos (duas faixas de
        piso vazio) têm o mesmo pHash: sem a área na chave, a segunda
        sumia como repetida da primeira. Sem área (bancada, um corte só),
        a chave é a de sempre.

        `contexto` é a assinatura do que vai JUNTO com a pergunta (a cena do
        canal, os quadros, o modelo): mudou o contexto, é outra pergunta, e
        o veredito guardado para a pergunta antiga não a responde. Sem
        contexto (o pedido de sempre), a chave é a de sempre.
        """
        quando = f"{ts:%Y%m%d%H%M%S}" if por_olhada else f"{ts:%Y%m%d%H%M}"
        lugar = ponto_id if zona_id is None else f"{ponto_id}/{zona_id}"
        bruto = f"{regra_id}:{criterio_versao}:{lugar}:{phash:016x}:{quando}"
        if contexto:
            bruto += f":{contexto}"
        return sha256(bruto.encode("utf-8")).hexdigest()[:32]

    # ──────────────────────────── escrita ─────────────────────────────

    def enfileirar(
        self,
        *,
        chave: str,
        regra_id: str,
        ponto_id: str,
        zona_id: str | None,
        prioridade: str,
        criterio: str,
        criterio_versao: int,
        imagem_caminho: str | Path,
        capturado_em: datetime,
        contexto: dict[str, Any] | None = None,
        phash: str | None = None,
    ) -> bool:
        """Insere. Devolve False quando a chave já existia (nada a fazer)."""
        validade = VALIDADE_PADRAO.get(prioridade, timedelta(hours=2))
        expira = capturado_em + validade
        with self._lock:
            cur = self._con.execute(
                """insert or ignore into analise
                   (chave, regra_id, ponto_id, zona_id, phash, prioridade,
                    criterio, criterio_versao, imagem_caminho, contexto,
                    capturado_em, expira_em, proxima_em)
                   values (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (
                    chave,
                    regra_id,
                    ponto_id,
                    zona_id,
                    phash,
                    prioridade,
                    criterio,
                    criterio_versao,
                    str(imagem_caminho),
                    json.dumps(contexto or {}, ensure_ascii=False),
                    _agora_iso(capturado_em),
                    _agora_iso(expira),
                    _agora_iso(capturado_em),
                ),
            )
            self._con.commit()
            return cur.rowcount > 0

    def proximos(self, agora: datetime, limite: int = 10) -> list[ItemFila]:
        """Itens prontos para enviar, urgente primeiro, mais velho primeiro.

        Marca como `enviando` na mesma transação da leitura: sem isso, dois
        laços de envio pegam o mesmo item e a loja recebe o alerta em dobro.

        `agora` é o relógio do AGENTE. Um item nasce pronto no instante em
        que foi capturado, que vem do DVR — então, se o relógio do gravador
        estiver adiantado em relação ao do PC, o item espera essa diferença
        antes de sair. Não se perde nada: ele sai quando o PC alcança. Vale
        saber na hora de diagnosticar "por que o alerta demorou".
        """
        agora_s = _agora_iso(agora)
        with self._lock:
            self._con.execute(
                """update analise set estado='descartado', erro='expirou antes do envio'
                    where estado in ('pendente','enviando') and expira_em < ?""",
                (agora_s,),
            )
            linhas = self._con.execute(
                """select * from analise
                    where estado='pendente' and proxima_em <= ?
                    order by case prioridade
                               when 'urgente' then 0
                               when 'intermediaria' then 1
                               else 2 end,
                             capturado_em
                    limit ?""",
                (agora_s, limite),
            ).fetchall()
            if linhas:
                self._con.executemany(
                    "update analise set estado='enviando' where id=?",
                    [(l["id"],) for l in linhas],
                )
            self._con.commit()
        return [self._para_item(l) for l in linhas]

    def mais_novo_pendente(self) -> datetime | None:
        """O instante do quadro mais novo que ainda espera julgamento — ou `None`.

        É com ele que o julgamento alcança o que a volta acabou de capturar
        (`Auditoria._hora_de_julgar`): o item nasce pronto no instante do
        quadro, e esse instante é segundos DEPOIS do começo da volta.
        """
        with self._lock:
            linha = self._con.execute(
                "select max(capturado_em) as mais_novo from analise where estado='pendente'"
            ).fetchone()
        if linha is None or linha["mais_novo"] is None:
            return None
        return datetime.fromisoformat(linha["mais_novo"])

    def concluir(self, item_id: int, veredito: Veredito, agora: datetime) -> None:
        with self._lock:
            self._con.execute(
                """update analise
                      set estado='concluido', resultado=?, confianca=?, motivo=?,
                          via=?, modelo=?, custo_centavos=?, latencia_ms=?,
                          medida=?, julgado_em=?, erro=null
                    where id=?""",
                (
                    veredito.resultado.value,
                    veredito.confianca,
                    veredito.motivo,
                    veredito.via.value,
                    veredito.modelo,
                    veredito.custo_centavos,
                    veredito.latencia_ms,
                    veredito.medida,
                    _agora_iso(agora),
                    item_id,
                ),
            )
            self._con.commit()

    def adiar(self, item: ItemFila, erro: str, agora: datetime) -> None:
        """Devolve o item à fila com espera crescente, ou desiste."""
        tentativas = item.tentativas + 1
        if tentativas >= len(BACKOFF_SEG):
            with self._lock:
                self._con.execute(
                    "update analise set estado='falhou', tentativas=?, erro=? where id=?",
                    (tentativas, erro[:500], item.id),
                )
                self._con.commit()
            return

        espera = BACKOFF_SEG[tentativas]
        with self._lock:
            self._con.execute(
                """update analise
                      set estado='pendente', tentativas=?, erro=?, proxima_em=?
                    where id=?""",
                (
                    tentativas,
                    erro[:500],
                    _agora_iso(agora + timedelta(seconds=espera)),
                    item.id,
                ),
            )
            self._con.commit()

    def veredito_de(self, chave: str) -> Veredito | None:
        """Resultado já apurado para esta chave, se houver.

        É o que faz a idempotência valer dinheiro: antes de mandar, pergunta
        se esta mesma cena já foi julgada.
        """
        with self._lock:
            l = self._con.execute(
                "select * from analise where chave=? and estado='concluido'",
                (chave,),
            ).fetchone()
        if not l or not l["resultado"]:
            return None
        return Veredito(
            resultado=Resultado(l["resultado"]),
            confianca=l["confianca"],
            motivo=l["motivo"],
            via=Via(l["via"]) if l["via"] else Via.NUVEM,
            modelo=l["modelo"],
            custo_centavos=l["custo_centavos"],
            latencia_ms=l["latencia_ms"],
            medida=l["medida"],
        )

    # ──────────────────────────── alertas ─────────────────────────────

    def registrar_alerta(
        self,
        *,
        regra_id: str,
        zona_id: str | None,
        ts: datetime,
        chave: str | None = None,
        evento: dict[str, Any] | None = None,
    ) -> None:
        """Registra o alerta e, junto, o corpo que vai subir para a nuvem.

        Os dois na MESMA linha: se o corpo fosse guardado depois, um PC
        desligado entre os dois passos deixaria um alerta que conta para o
        silêncio e nunca chega a ninguém.
        """
        corpo = json.dumps(evento, ensure_ascii=False) if evento is not None else None
        with self._lock:
            self._con.execute(
                "insert into alerta (regra_id, zona_id, ts, chave, evento) values (?,?,?,?,?)",
                (regra_id, zona_id, _agora_iso(ts), chave, corpo),
            )
            self._con.commit()

    def ultimo_alerta(
        self, regra_id: str, zona_id: str | None = None
    ) -> datetime | None:
        """Quando esta regra alertou pela última vez — base do silêncio.

        Com `zona_id`, a pergunta é sobre AQUELE canal. Um critério que
        vale em três canais tem três silêncios: a bancada suja do canal 1
        não pode calar a do canal 2 por quinze minutos.
        """
        with self._lock:
            if zona_id is None:
                l = self._con.execute(
                    "select ts from alerta where regra_id=? order by ts desc limit 1",
                    (regra_id,),
                ).fetchone()
            else:
                l = self._con.execute(
                    """select ts from alerta where regra_id=? and zona_id=?
                        order by ts desc limit 1""",
                    (regra_id, zona_id),
                ).fetchone()
        return datetime.fromisoformat(l["ts"]) if l else None

    def eventos_a_subir(self, limite: int = 100) -> list[tuple[int, dict[str, Any]]]:
        """O que a nuvem ainda não recebeu, do mais antigo ao mais novo.

        Linha sem `evento` é de antes desta coluna existir: não há como
        remontar o corpo, então ela fica de fora em vez de subir pela metade.
        """
        with self._lock:
            linhas = self._con.execute(
                """select id, evento from alerta
                    where enviado=0 and evento is not null
                    order by ts, id limit ?""",
                (limite,),
            ).fetchall()
        return [(l["id"], json.loads(l["evento"])) for l in linhas]

    def a_subir(self) -> int:
        """Quantos eventos esperam a nuvem. É o número que diz "tem fila"."""
        with self._lock:
            l = self._con.execute(
                "select count(*) n from alerta where enviado=0 and evento is not null"
            ).fetchone()
        return int(l["n"])

    def marcar_enviados(self, ids: list[int], estado: int = 1) -> None:
        """`estado=1`: a nuvem recebeu. `estado=2`: recusou, e não muda repetindo."""
        if not ids:
            return
        with self._lock:
            self._con.executemany(
                "update alerta set enviado=? where id=?", [(estado, i) for i in ids]
            )
            self._con.commit()

    # ─────────────────────── resumo por hora ────────────────────────

    @staticmethod
    def hora_de(ts: datetime) -> str:
        """A hora cheia em que `ts` cai, do jeito que fica gravada."""
        return _agora_iso(ts.replace(minute=0, second=0, microsecond=0))

    def _somar_no_resumo(
        self,
        ts: datetime,
        regra_id: str,
        zona_id: str | None,
        somas: dict[str, float],
        textos: dict[str, str | None],
        maximos: dict[str, float] | None = None,
    ) -> None:
        """Soma numa linha do resumo. Quem chama segura a trava e confirma.

        `maximos` guarda o MAIOR valor da hora em vez de somar.
        """
        maximos = maximos or {}
        for nome in maximos:
            if nome not in _MAXIMOS_DO_RESUMO:
                raise ValueError(f"máximo desconhecido no resumo: {nome}")
        for nome in somas:
            if nome not in CONTADORES_DO_RESUMO and nome not in _SOMAS_DO_VEREDITO:
                raise ValueError(f"contador desconhecido no resumo: {nome}")
        for nome in textos:
            if nome not in _TEXTOS_DO_RESUMO:
                raise ValueError(f"campo desconhecido no resumo: {nome}")

        chave = (self.hora_de(ts), regra_id, zona_id or "")
        self._con.execute(
            "insert or ignore into resumo_hora (hora, regra_id, zona_id) values (?,?,?)",
            chave,
        )
        partes = (
            [f"{n} = {n} + ?" for n in somas]
            + [f"{n} = ?" for n in textos]
            + [f"{n} = max(coalesce({n}, ?), ?)" for n in maximos]
        )
        # Linha recusada continua recusada: a nuvem já disse que aquele
        # critério não é mais desta loja, e somar de novo não muda isso.
        partes += ["versao = versao + 1", "estado = case when estado = 2 then 2 else 1 end"]
        self._con.execute(
            f"update resumo_hora set {', '.join(partes)} "
            "where hora = ? and regra_id = ? and zona_id = ?",
            (
                *somas.values(),
                *textos.values(),
                *(v for m in maximos.values() for v in (m, m)),
                *chave,
            ),
        )

    def contar(
        self,
        ts: datetime,
        regra_id: str,
        zona_id: str | None,
        *,
        impedimento: str | None = None,
        **somas: int,
    ) -> None:
        """Soma contadores numa hora, num critério, num canal."""
        self.contar_lote([(ts, regra_id, zona_id, somas, impedimento)])

    def contar_lote(
        self,
        itens: list[tuple[datetime, str, str | None, dict[str, int], str | None]],
    ) -> None:
        """Várias somas de uma vez, gravadas juntas.

        Uma rodada de captura olha todos os critérios de um canal; gravar
        um por um seria uma ida ao disco por critério, a cada trinta
        segundos, o dia inteiro.
        """
        if not itens:
            return
        with self._lock:
            for ts, regra_id, zona_id, somas, impedimento in itens:
                texto = sem_segredo(impedimento)
                self._somar_no_resumo(
                    ts, regra_id, zona_id, dict(somas),
                    {"ultimo_impedimento": texto} if texto else {},
                )
            self._con.commit()

    def contar_veredito(
        self,
        ts: datetime,
        regra_id: str,
        zona_id: str | None,
        veredito: Veredito,
        julgado_em: datetime,
        *,
        alerta: bool = False,
        extra: bool = False,
    ) -> None:
        """Um julgamento concluído, na hora em que a cena foi CAPTURADA.

        A hora é a da cena, não a do julgamento: um item que esperou a
        internet voltar pertence ao momento em que aconteceu.
        """
        somas: dict[str, float] = {
            _CONTADOR_DO_RESULTADO[veredito.resultado.value]: 1,
        }
        if alerta:
            somas["alertas"] = 1
        if veredito.confianca is not None:
            somas["soma_confianca"] = float(veredito.confianca)
            somas["com_confianca"] = 1
        if veredito.latencia_ms is not None:
            somas["soma_latencia_ms"] = int(veredito.latencia_ms)
            somas["com_latencia"] = 1
        if veredito.custo_centavos:
            somas["custo_centavos"] = float(veredito.custo_centavos)
        # Onde foi julgado: só a nuvem é "fora da loja". Detector, modelo
        # local e comparação rodam no computador dela — é a diferença que
        # interessa a quem paga a conta e a quem pergunta se a imagem saiu.
        somas["julgadas_nuvem" if veredito.via is Via.NUVEM else "julgadas_loja"] = 1
        # A medida da cena, quando o juiz mede (o detector: quantos viu).
        # "Não mediu" não entra na quantidade — não vira zero na média.
        maximos: dict[str, float] = {}
        if veredito.medida is not None:
            # A média da hora é feita das olhadas de ROTINA, que caem em
            # instantes regulares. A olhada extra é feita porque algo
            # mudou: somada, puxaria a média para os momentos de
            # mudança. O maior valor, esse sim, conta com ela — é o
            # pico que a rotina não veria.
            if not extra:
                somas["soma_medida"] = float(veredito.medida)
                somas["com_medida"] = 1
            maximos["max_medida"] = float(veredito.medida)
        if extra:
            # Contada nos resultados, como toda análise — e marcada à
            # parte, para quem precisar da conta só da rotina.
            somas["extras"] = 1
            if veredito.resultado.value == "nao_conforme":
                somas["extras_fora"] = 1
        with self._lock:
            self._somar_no_resumo(
                ts, regra_id, zona_id, somas,
                {
                    "ultimo_resultado": veredito.resultado.value,
                    "ultimo_motivo": sem_segredo(veredito.motivo),
                    "ultima_em": _agora_iso(julgado_em),
                },
                maximos,
            )
            self._con.commit()

    def resumos_a_subir(self, limite: int = 200) -> list[dict[str, Any]]:
        """As linhas que a nuvem ainda não tem, da hora mais antiga à mais nova."""
        with self._lock:
            linhas = self._con.execute(
                "select * from resumo_hora where estado = 1 "
                "order by hora, regra_id, zona_id limit ?",
                (limite,),
            ).fetchall()
        return [dict(l) for l in linhas]

    def resumos_pendentes(self) -> int:
        with self._lock:
            l = self._con.execute(
                "select count(*) n from resumo_hora where estado = 1"
            ).fetchone()
        return int(l["n"])

    def marcar_resumos(self, linhas: list[dict[str, Any]], estado: int = 0) -> None:
        """`estado=0`: a nuvem tem. `estado=2`: recusou, e não muda repetindo.

        "A nuvem tem" só vale para a VERSÃO que subiu. Se a linha somou
        mais enquanto o pedido viajava, ela continua esperando a próxima
        subida — é o que impede uma soma de se perder no caminho.
        """
        if not linhas:
            return
        with self._lock:
            if estado == 0:
                self._con.executemany(
                    "update resumo_hora set estado = 0 "
                    "where hora = ? and regra_id = ? and zona_id = ? "
                    "and versao = ? and estado = 1",
                    [(l["hora"], l["regra_id"], l["zona_id"], l["versao"]) for l in linhas],
                )
            else:
                self._con.executemany(
                    "update resumo_hora set estado = ? "
                    "where hora = ? and regra_id = ? and zona_id = ?",
                    [(estado, l["hora"], l["regra_id"], l["zona_id"]) for l in linhas],
                )
            self._con.commit()

    def limpar_resumos(self, antes_de: datetime) -> int:
        """Apaga o resumo antigo que a nuvem já tem (ou recusou).

        O que ainda falta subir fica, por mais velho que seja: é o único
        registro de que aquelas horas foram olhadas.
        """
        with self._lock:
            cur = self._con.execute(
                "delete from resumo_hora where hora < ? and estado <> 1",
                (self.hora_de(antes_de),),
            )
            self._con.commit()
            return cur.rowcount

    # ─────────────────────── o uso da máquina ───────────────────────

    # As peças medidas em porcentagem: a coluna e o campo da amostra.
    _PECAS_DO_USO = (
        ("cpu", "cpu"),
        ("mem", "memoria"),
        ("gpu", "gpu"),
        ("proc_cpu", "processo_cpu"),
    )

    def somar_uso(self, ts: datetime, amostra: Any) -> None:
        """Uma amostra do uso da máquina, na hora em que foi tirada."""
        hora = self.hora_de(ts)
        partes = ["amostras = amostras + 1", "versao = versao + 1", "estado = 1"]
        valores: list[float] = []
        for coluna, campo in self._PECAS_DO_USO:
            valor = getattr(amostra, campo)
            if valor is None:
                continue
            partes += [
                f"{coluna}_soma = {coluna}_soma + ?",
                f"{coluna}_n = {coluna}_n + 1",
                f"{coluna}_max = max(coalesce({coluna}_max, 0), ?)",
            ]
            valores += [float(valor), float(valor)]
        if amostra.processo_mem_mb is not None:
            partes.append("proc_mem_max_mb = max(coalesce(proc_mem_max_mb, 0), ?)")
            valores.append(float(amostra.processo_mem_mb))
        for coluna, valor in (
            ("disco_livre_gb", amostra.disco_livre_gb),
            ("disco_total_gb", amostra.disco_total_gb),
        ):
            if valor is not None:
                partes.append(f"{coluna} = ?")
                valores.append(float(valor))
        with self._lock:
            self._con.execute("insert or ignore into uso_hora (hora) values (?)", (hora,))
            self._con.execute(
                f"update uso_hora set {', '.join(partes)} where hora = ?", (*valores, hora)
            )
            self._con.commit()

    def usos_a_subir(self, limite: int = 200) -> list[dict[str, Any]]:
        """As horas de uso que a nuvem ainda não tem, da mais antiga à mais nova."""
        with self._lock:
            linhas = self._con.execute(
                "select * from uso_hora where estado = 1 order by hora limit ?", (limite,)
            ).fetchall()
        return [dict(l) for l in linhas]

    def marcar_usos(self, linhas: list[dict[str, Any]]) -> None:
        """A nuvem tem estas horas — NA VERSÃO que subiu.

        Se a hora somou mais uma amostra enquanto o pedido viajava, ela
        continua esperando a próxima subida.
        """
        if not linhas:
            return
        with self._lock:
            self._con.executemany(
                "update uso_hora set estado = 0 where hora = ? and versao = ? and estado = 1",
                [(l["hora"], l["versao"]) for l in linhas],
            )
            self._con.commit()

    def limpar_usos(self, antes_de: datetime) -> int:
        """Apaga o uso antigo que a nuvem já tem. O que falta subir fica."""
        with self._lock:
            cur = self._con.execute(
                "delete from uso_hora where hora < ? and estado <> 1",
                (self.hora_de(antes_de),),
            )
            self._con.commit()
            return cur.rowcount

    # ──────────────────────────── leitura ─────────────────────────────

    def resumo(self) -> dict[str, int]:
        with self._lock:
            linhas = self._con.execute(
                "select estado, count(*) n from analise group by estado"
            ).fetchall()
        return {l["estado"]: l["n"] for l in linhas}

    def custo_centavos(self, desde: datetime) -> float:
        with self._lock:
            l = self._con.execute(
                "select coalesce(sum(custo_centavos),0) t from analise where julgado_em >= ?",
                (_agora_iso(desde),),
            ).fetchone()
        return float(l["t"])

    # Os estados em que a análise não vai mais a lugar nenhum: julgada,
    # vencida antes de ser julgada, ou falhada de vez.
    ENCERRADOS = ("concluido", "descartado", "falhou")

    def limpar_encerrados(self, antes_de: datetime) -> int:
        """Tira do disco as análises ENCERRADAS antes de `antes_de`: a linha e a imagem.

        Sem isto o spool cresce para sempre, e disco cheio num PC de loja
        derruba o agente de um jeito difícil de diagnosticar à distância.
        (Existia só para as julgadas, e ninguém chamava: ERR-062. Quem chama
        agora é a auditoria, de hora em hora.)

        O que ainda espera julgamento não é tocado, seja de quando for.

        Só apaga imagem que está DENTRO do spool — a pasta em que o agente
        grava. Linha que aponta para arquivo de fora sai, e o arquivo fica
        onde está: este código não apaga o que não criou.

        A imagem sai antes da linha, e a linha só sai se a imagem saiu: se o
        processo cair no meio, ou se o arquivo estiver preso por outro
        programa, a linha que sobrou ainda aponta para ele e a limpeza
        seguinte tenta de novo. Na ordem contrária sobraria imagem que nada
        mais alcança.

        Devolve quantas análises saíram.
        """
        corte = _agora_iso(antes_de)
        marcas = ",".join("?" * len(self.ENCERRADOS))
        spool = self.spool.resolve()
        with self._lock:
            linhas = self._con.execute(
                f"""select id, imagem_caminho from analise
                     where estado in ({marcas}) and coalesce(julgado_em, capturado_em) < ?""",
                (*self.ENCERRADOS, corte),
            ).fetchall()
            saem: list[tuple[int]] = []
            for l in linhas:
                imagem = Path(l["imagem_caminho"])
                try:
                    if imagem.resolve().parent == spool:
                        imagem.unlink(missing_ok=True)
                except OSError:
                    continue
                saem.append((l["id"],))
            self._con.executemany("delete from analise where id = ?", saem)
            self._con.commit()
        return len(saem)

    def fechar(self) -> None:
        with self._lock:
            self._con.close()

    # ──────────────────────────── interno ─────────────────────────────

    @staticmethod
    def _para_item(l: sqlite3.Row) -> ItemFila:
        return ItemFila(
            id=l["id"],
            chave=l["chave"],
            regra_id=l["regra_id"],
            ponto_id=l["ponto_id"],
            zona_id=l["zona_id"],
            prioridade=l["prioridade"],
            criterio=l["criterio"],
            criterio_versao=l["criterio_versao"],
            imagem_caminho=l["imagem_caminho"],
            capturado_em=datetime.fromisoformat(l["capturado_em"]),
            expira_em=datetime.fromisoformat(l["expira_em"]),
            tentativas=l["tentativas"],
            estado=EstadoItem(l["estado"]),
            contexto=json.loads(l["contexto"] or "{}"),
            phash=l["phash"],
        )
