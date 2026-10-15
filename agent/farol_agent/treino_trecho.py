"""Buscar no gravador o trecho de uma gravação de treino (A21, fatia T3b).

A gravação de treino é um horário (de 15 minutos a 1 hora) de um canal. A
loja baixa esse trecho do gravador, em pedaços, para a pasta da gravação —
e é a leitura da bancada (T3c) que o lê depois. As regras:

1. **Pedaços de até 40 s, alinhados aos blocos do gravador.** É o maior
   pedido do cliente de arquivo (`dvr.arquivo.MAIOR_TRECHO`), e o pedido
   desalinhado cobriria mais que isso. Um pedido de cada vez (a vez é do
   gravador, no cliente).
2. **A hora é a do gravador.** A gravação vem da nuvem como instante; vira a
   hora do computador e, com a diferença que o cliente mede, a do gravador.
   O pedaço fica em `canal-NN/AAAA-MM-DD_HH-MM-SS.dav` — a hora do gravador
   em que ele começa —, como a cópia guardada da loja e como o leitor do
   repasse (`ferramentas/repasse/leitor.py`) lê; o manifesto diz onde cada
   um termina (os pedaços daqui não têm 5 minutos).
3. **Só o que assentou.** O pedaço só é pedido quando o perfil do gravador
   diz que a gravação dele já assentou; antes disso, a busca para e volta
   depois.
4. **Só quando pode.** Quem chama diz se agora é hora de buscar
   (`pode_buscar`): a placa da loja de teste é de 10 Mbit/s e, pela conta
   com a medida de 10/10/2026 (um bloco de 2 s = 0,53 MB em 1,9 s), 30
   minutos de gravação são perto de 480 MB e 28 minutos de rede. **A hora é
   decisão do dono.** Fora dela, a busca para no pedaço em que está.
5. **Retoma de onde parou.** O que já veio fica anotado no manifesto da
   pasta (`trecho.json`), gravado a cada pedaço: o pedaço que veio não é
   pedido de novo, nem depois de o agente reiniciar.
6. **Disco.** Com menos que o mínimo livre, a busca para — não enche o disco
   do computador da loja (que é também o servidor local do Regem).

Cada erro do gravador tem destino:

    sem gravação no pedaço        anotado; a busca segue (o gravador guarda
                                  ~18 h: o pedaço velho não volta)
    gravador ocupado              para; tenta de novo depois
    senha recusada                para TUDO: o cliente não repete a senha
                                  recusada (a conta do gravador trava)
    outro erro do gravador        o pedaço é tentado de novo depois; na
                                  terceira vez, fica anotado como falho e a
                                  busca segue

**Dorme:** nada no agente chama este módulo ainda (a T3d liga).
"""

from __future__ import annotations

import json
import logging
import os
import shutil
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Callable

from farol_agent.dvr.arquivo import MAIOR_TRECHO, GravadorOcupado, PedidoRecusado, SemGravacao, inicio_do_bloco
from farol_agent.dvr.dahua import ErroDoGravador

_log = logging.getLogger(__name__)

MANIFESTO = "trecho.json"
FORMATO_DO_MANIFESTO = 1
# Na terceira falha do mesmo pedaço, ele fica anotado como falho e a busca segue.
TENTATIVAS_POR_PEDACO = 3
# O mínimo livre no disco para pedir mais um pedaço. Um pedaço de 40 s é perto de 11 MB (conta, medida de 10/10).
DISCO_MINIMO_LIVRE = 2 * 1024**3

OK, SEM_GRAVACAO, FALHOU = "ok", "sem_gravacao", "falhou"

# Por que a busca parou antes do fim (nulo = chegou ao fim).
FORA_DA_HORA = "fora_da_hora"
AINDA_NAO_ASSENTOU = "ainda_nao_assentou"
GRAVADOR_OCUPADO = "gravador_ocupado"
GRAVADOR = "gravador"
DISCO = "disco"
SENHA_RECUSADA = "senha_recusada"
SEM_CANAL = "sem_canal"


@dataclass(frozen=True)
class Busca:
    """Como ficou a busca do trecho, depois desta vez."""

    total: int
    ok: int
    sem_gravacao: int
    falhos: int
    # Por que parou antes do fim; nulo = chegou ao fim (todo pedaço tem situação).
    parou: str | None = None
    # O que dizer, quando parou por erro.
    detalhe: str | None = None

    @property
    def completa(self) -> bool:
        return self.parou is None

    @property
    def fracao(self) -> float:
        return (self.ok + self.sem_gravacao + self.falhos) / self.total if self.total else 1.0


def passo_do_pedaco(bloco_s: int | None) -> timedelta:
    """O maior pedaço que cabe num pedido: 40 s, ou o maior múltiplo do bloco que cabe neles."""
    maior = int(MAIOR_TRECHO.total_seconds())
    if not bloco_s:
        return MAIOR_TRECHO
    return timedelta(seconds=max(bloco_s, maior - maior % bloco_s))


def pedacos(de: datetime, ate: datetime, bloco_s: int | None, desvio_s: int = 0) -> list[tuple[datetime, datetime]]:
    """Os pedaços que cobrem de `de` até `ate` (hora do gravador), em ordem, alinhados aos blocos."""
    if ate <= de:
        return []
    passo = passo_do_pedaco(bloco_s)
    t = inicio_do_bloco(de, bloco_s, desvio_s) if bloco_s else de.replace(microsecond=0)
    lista = []
    while t < ate:
        fim = min(t + passo, ate)
        lista.append((t, fim))
        t += passo
    return lista


def _nome(de: datetime) -> str:
    """O nome do pedaço: a hora do gravador em que ele começa, como na cópia guardada da loja."""
    return f"{de:%Y-%m-%d_%H-%M-%S}.dav"


def pasta_dos_videos(pasta: Path, canal: int) -> Path:
    """Onde os pedaços de um canal ficam, dentro da pasta da gravação (como na cópia guardada: `canal-04`)."""
    return Path(pasta) / f"canal-{canal:02d}"


def pedacos_baixados(pasta: Path, canal: int) -> list[tuple[Path, datetime, datetime]]:
    """Os pedaços que vieram inteiros, em ordem: o arquivo, onde começa e onde termina (hora do gravador).

    É o que a leitura da bancada (T3c) lê. Pedaço anotado que sumiu do disco não entra.
    """
    saida = []
    for nome, a in _ler_manifesto(Path(pasta) / MANIFESTO).items():
        if a.get("situacao") != OK:
            continue
        try:
            de, ate = datetime.fromisoformat(a["de"]), datetime.fromisoformat(a["ate"])
        except (KeyError, TypeError, ValueError):
            continue
        arquivo = pasta_dos_videos(pasta, canal) / nome
        if arquivo.is_file():
            saida.append((arquivo, de, ate))
    return sorted(saida, key=lambda p: p[1])


def _ler_manifesto(arquivo: Path) -> dict[str, dict[str, Any]]:
    try:
        bruto = json.loads(arquivo.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    if not isinstance(bruto, dict) or bruto.get("formato") != FORMATO_DO_MANIFESTO or not isinstance(bruto.get("pedacos"), dict):
        return {}
    return {k: v for k, v in bruto["pedacos"].items() if isinstance(v, dict)}


def _gravar_manifesto(arquivo: Path, pedacos_: dict[str, dict[str, Any]]) -> None:
    # Troca de uma vez: o agente que cai no meio da escrita não deixa manifesto pela metade.
    temporario = arquivo.with_name(arquivo.name + ".novo")
    temporario.write_text(json.dumps({"formato": FORMATO_DO_MANIFESTO, "pedacos": pedacos_}, ensure_ascii=False), encoding="utf-8")
    os.replace(temporario, arquivo)


def _local(t: datetime) -> datetime:
    """O instante, na hora do computador (sem fuso). O computador da loja está no fuso dela."""
    return t.astimezone().replace(tzinfo=None) if t.tzinfo is not None else t


def buscar_trecho(
    cliente,
    canal: int | None,
    inicio: datetime,
    fim: datetime,
    pasta: Path,
    *,
    pode_buscar: Callable[[], bool],
    ao_andar: Callable[[Busca], None] | None = None,
    agora: Callable[[], datetime] = datetime.now,
    para_o_computador: Callable[[datetime], datetime] = _local,
    disco_minimo: int = DISCO_MINIMO_LIVRE,
) -> Busca:
    """Baixa o que falta do trecho de `inicio` a `fim` (instantes) do canal, para `pasta`.

    `cliente` é o cliente de arquivo do gravador (`dvr.arquivo.ClienteDeArquivo`).
    Devolve como a busca ficou; quem chama conta o andamento e decide quando
    chamar de novo.
    """
    pasta = Path(pasta)
    if not canal or canal < 1:
        return Busca(total=0, ok=0, sem_gravacao=0, falhos=0, parou=SEM_CANAL, detalhe="a gravação não diz de que canal é")
    videos = pasta_dos_videos(pasta, canal)
    videos.mkdir(parents=True, exist_ok=True)
    arquivo_do_manifesto = pasta / MANIFESTO
    anotados = _ler_manifesto(arquivo_do_manifesto)

    def contar(parou: str | None = None, detalhe: str | None = None) -> Busca:
        situacoes = [anotados.get(_nome(de), {}).get("situacao") for de, _ in lista]
        return Busca(
            total=len(lista), ok=situacoes.count(OK), sem_gravacao=situacoes.count(SEM_GRAVACAO),
            falhos=situacoes.count(FALHOU), parou=parou, detalhe=detalhe,
        )

    lista: list[tuple[datetime, datetime]] = []
    try:
        diferenca = cliente.relogio()
    except PedidoRecusado:
        return contar(SENHA_RECUSADA, "o gravador recusou a senha do agente")
    except ErroDoGravador as e:
        return contar(GRAVADOR, f"não deu para ler a hora do gravador: {e}")
    perfil = cliente.perfil
    lista = pedacos(para_o_computador(inicio) + diferenca, para_o_computador(fim) + diferenca, perfil.bloco_s, perfil.desvio_s)

    for de, ate in lista:
        nome = _nome(de)
        anotado = anotados.get(nome, {})
        if anotado.get("situacao") in (OK, SEM_GRAVACAO, FALHOU) and (anotado.get("situacao") != OK or (videos / nome).is_file()):
            continue
        onde = {"de": de.isoformat(), "ate": ate.isoformat()}
        if not pode_buscar():
            return contar(FORA_DA_HORA)
        if not cliente.ja_gravado(ate, agora() + diferenca):
            return contar(AINDA_NAO_ASSENTOU)
        if shutil.disk_usage(pasta).free < disco_minimo:
            return contar(DISCO, "pouco espaço livre no disco do computador da loja")
        tentativas = int(anotado.get("tentativas") or 0)
        try:
            trecho = cliente.baixar(canal, de, ate, videos / nome)
        except SemGravacao:
            anotados[nome] = {"situacao": SEM_GRAVACAO, **onde}
        except PedidoRecusado:
            return contar(SENHA_RECUSADA, "o gravador recusou a senha do agente")
        except GravadorOcupado:
            return contar(GRAVADOR_OCUPADO)
        except ErroDoGravador as e:
            tentativas += 1
            if tentativas < TENTATIVAS_POR_PEDACO:
                anotados[nome] = {"situacao": None, "tentativas": tentativas, **onde}
                _gravar_manifesto(arquivo_do_manifesto, anotados)
                return contar(GRAVADOR, str(e))
            _log.warning("treino: o pedaço %s falhou %d vezes; fica de fora (%s)", nome, tentativas, e)
            anotados[nome] = {"situacao": FALHOU, "tentativas": tentativas, **onde}
        else:
            anotados[nome] = {"situacao": OK, "tamanho": trecho.tamanho, **onde}
        _gravar_manifesto(arquivo_do_manifesto, anotados)
        if ao_andar is not None:
            ao_andar(contar())
    return contar()
