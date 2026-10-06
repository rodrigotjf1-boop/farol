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
  julgado_em      text
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
"""


# Colunas que entraram depois da primeira instalação. `create table if not
# exists` não toca em tabela que já existe, e a fila de uma loja em operação
# existe há semanas — sem isto, atualizar o agente quebraria no primeiro
# insert com "no such column".
_COLUNAS_NOVAS = (
    ("analise", "phash", "text"),
    ("alerta", "chave", "text"),
    ("alerta", "evento", "text"),
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
    ) -> str:
        """Determinística: a mesma cena, na mesma regra, no mesmo minuto."""
        bruto = f"{regra_id}:{criterio_versao}:{ponto_id}:{phash:016x}:{ts:%Y%m%d%H%M}"
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

    def concluir(self, item_id: int, veredito: Veredito, agora: datetime) -> None:
        with self._lock:
            self._con.execute(
                """update analise
                      set estado='concluido', resultado=?, confianca=?, motivo=?,
                          via=?, modelo=?, custo_centavos=?, latencia_ms=?,
                          julgado_em=?, erro=null
                    where id=?""",
                (
                    veredito.resultado.value,
                    veredito.confianca,
                    veredito.motivo,
                    veredito.via.value,
                    veredito.modelo,
                    veredito.custo_centavos,
                    veredito.latencia_ms,
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

    def limpar_concluidos(self, antes_de: datetime) -> int:
        """Remove julgados antigos e as imagens deles do spool.

        Sem isto o spool cresce para sempre, e disco cheio num PC de loja
        derruba o agente de um jeito difícil de diagnosticar à distância.
        """
        corte = _agora_iso(antes_de)
        with self._lock:
            linhas = self._con.execute(
                "select id, imagem_caminho from analise where estado='concluido' and julgado_em < ?",
                (corte,),
            ).fetchall()
            for l in linhas:
                Path(l["imagem_caminho"]).unlink(missing_ok=True)
            self._con.execute(
                "delete from analise where estado='concluido' and julgado_em < ?",
                (corte,),
            )
            self._con.commit()
        return len(linhas)

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
