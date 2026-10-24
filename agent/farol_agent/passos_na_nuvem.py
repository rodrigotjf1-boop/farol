"""A noite lida por passos sobe para a conferência (A23.3, parte 4).

O dono, 21/10/2026, perguntando se os erros do juiz já viram aprendizado: "pq não começa hoje ao invés de amanhã?".
Cada lanche que a bancada ao vivo leu por passos (`bancada_ao_vivo`: o `passos.json`, com o recorte e o contorno de cada
passo) sobe, depois do fechamento, para a CONFERÊNCIA POR PASSO do console (`POST /v1/agentes/treino/lanches`, o
`porPassos` de `contratos/lanche-de-treino.json`). Lá a pessoa diz, passo a passo, o que era e o que não era
ingrediente; o que ela diz vira exemplo da base da loja, que desce para o juiz (`base_da_loja`).

**A noite é uma gravação** de origem `ao-vivo`: a janela do horário da loja em que o lanche começou (a madrugada é da
noite em que a loja abriu, como em `Janela.contem`), com a folga da leitura depois de fechar
(`bancada_ao_vivo.FOLGA_FECHAMENTO_MIN`). Chave `ao-vivo-canal-NN-AAAA-MM-DD`; com a hora da abertura (`-19h00`) quando a
loja abre mais de uma vez no dia; numa janela de mais de 14 horas (o limite do contrato), um pedaço por 14 horas.

**Uma amostra por noite** (`POR_NOITE` lanches por canal). A nuvem guarda os recortes do lanche que ninguém conferiu, e a
fila da conferência traz todos os que esperam: a noite inteira (uns 150 lanches) afogaria as duas. Primeiro os lanches
em que o juiz teve DÚVIDA — a mesma regra da fila na nuvem (`passoDeDuvida`): o passo que ele tirou (vazio), e o passo e
o provisório com nota abaixo de `NOTA_DE_DUVIDA` —, que são os erros a corrigir, os com mais dúvidas antes; as vagas que
sobram, espalhadas pela noite (o acerto confirmado também ensina: vira exemplo do ingrediente). A escolha se faz com a
noite terminada, e é sempre a mesma para a mesma noite.

**Só o lanche lido COM o juiz** (`"juiz": true` no `passos.json`): sem ele, um terço dos passos era o inox ou o alumínio
(ERR-138), cada cartão perguntaria "o que era?", e a fila poria esses lanches primeiro ("coberto"), acima das dúvidas do
juiz.

**O lanche** é a pasta `passos-HHhMMmSS-N`, e as etapas são os passos, na ordem da hora:

- o COMEÇO de cada peça é o pão (lado `pao`): o Farol só diz qual quando são 3 peças e a base da loja tem UM pão de dois
  cortes (o único com a fatia do meio — o dono, 21/10); senão a conferência pergunta;
- o passo e o provisório levam o ingrediente que o juiz achou; o vazio leva o "parece" do juiz, sem candidato (não é
  evidência); a peça que saiu, a passagem e o fechamento vão sem leitura;
- sobem com recorte (reduzido, `treino_corpo.reduzir`) o começo, o passo, o provisório e o vazio — o que a conferência
  pergunta —, e o contorno vai na escala do recorte que sobe.

**Com a loja FECHADA**, como a base e a gravação de treino: a internet da loja é a dos pedidos. A cada `PAUSA_S`. O lanche
que subiu não sobe de novo: `enviado.json` na pasta dele guarda o resumo (sha256) do `passos.json` — a leitura refeita
sobe de novo, e a nuvem troca a leitura (a não ser que ele já tenha sido conferido). A resposta decide: 409 (a gravação
foi cancelada ou apagada no console) — os lanches dela param de subir (`gravacoes-encerradas.json`, na pasta do canal);
422 (e as outras recusas) — aquele lanche não sobe de novo; rede, 5xx, 401, 403 e 429 — de novo na volta seguinte, e a
volta para ali.

**Dorme:** liga com o juiz de ingrediente (`FAROL_BANCADA_INGREDIENTES`, com os passos e a guarda dos quadros).
`FAROL_CONFERENCIA_POR_NOITE` muda a amostra; 0 desliga.
"""

from __future__ import annotations

import base64
import hashlib
import json
import logging
import math
import os
import re
import threading
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from pathlib import Path
from typing import Any, Callable, Protocol

from farol_agent import imagens
from farol_agent.bancada_ao_vivo import FOLGA_FECHAMENTO_MIN, GUARDA_DIAS
from farol_agent.bancada_ao_vivo import PASTA as PASTA_DA_BANCADA
from farol_agent.base_da_loja import BaseDaLoja
from farol_agent.configuracao import ler_do_disco
from farol_agent.juizes.ingrediente import chave as chave_do_nome
from farol_agent.juizes.ingrediente import e_pao
from farol_agent.modelos import Janela
from farol_agent.nuvem import ErroDaNuvem
from farol_agent.treino_corpo import LADO_DO_QUADRO, MAX_ETAPAS, MAX_QUADROS, _com_fuso, reduzir
from farol_agent.treino_servico import janelas_da_loja, loja_fechada

_log = logging.getLogger(__name__)

VARIAVEL_POR_NOITE = "FAROL_CONFERENCIA_POR_NOITE"
# Os lanches de cada noite, por canal, que sobem (uma conferência de uns 20 minutos).
POR_NOITE = 20
MAX_POR_NOITE = 200
# A volta da linha de execução.
PAUSA_S = 300.0
# A noite termina na folga da leitura depois de fechar; os passos do último lanche são lidos logo depois (até 60 s).
MARGEM = timedelta(minutes=5)
# O limite do contrato para a gravação `ao-vivo`.
DURACAO_MAXIMA = timedelta(hours=14)
# A nota abaixo da qual o passo lido fica na dúvida: a da nuvem (`NOTA_DE_DUVIDA` em `api/src/treino.ts`).
NOTA_DE_DUVIDA = 0.55
TIPOS = ("comeco", "passo", "provisorio", "transitorio", "fechou", "vazio", "saiu")
COM_QUADRO = ("comeco", "passo", "provisorio", "vazio")
# Os limites do contrato (`limites` em `contratos/lanche-de-treino.json`).
MAX_PECAS = 8
MAX_PEDACOS = 8
MAX_PONTOS = 64
MAX_LEU = 80
MAX_CANDIDATO = 120
MAX_HORA = 40
ENVIADO = "enviado.json"
ENCERRADAS = "gravacoes-encerradas.json"
GUARDA_ENCERRADAS = 60
# A24 F3: o que já foi escolhido e mandado para marcar, por noite (na pasta do canal), e quantas noites ele guarda.
RECORTES_ESTADO = "recortes-para-marcar.json"
GUARDA_NOITES_DOS_RECORTES = 30
# Os destinos de um lanche (os de `treino_corpo`, mais o que ficou para depois).
SUBIU, RECUSADO, ENCERRADA, DEPOIS = "enviado", "recusado", "encerrada", "depois"
_DIA = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_DOIS_CORTES = re.compile(r"\b(dois|2) cortes?\b")
_UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.I)


class ClienteDaConferencia(Protocol):
    def lanche_de_treino(self, corpo: dict[str, Any]) -> dict[str, Any]: ...


def por_noite(valor: str | None) -> int:
    """`FAROL_CONFERENCIA_POR_NOITE`: quantos lanches de cada noite sobem (0 desliga). Sem ela, ou torta, `POR_NOITE`."""
    if valor is None or not valor.strip():
        return POR_NOITE
    try:
        n = int(valor.strip())
    except ValueError:
        _log.warning("conferência: %s=%r não é um número; fico com %d lanches por noite", VARIAVEL_POR_NOITE, valor, POR_NOITE)
        return POR_NOITE
    return min(MAX_POR_NOITE, max(0, n))


# ───────────────────────────── a noite ─────────────────────────────


@dataclass(frozen=True)
class Noite:
    """Uma noite de leitura de um canal: a gravação `ao-vivo` da nuvem (hora local, sem fuso)."""

    chave: str
    inicio: datetime
    fim: datetime


def _hora_do_dia(texto: str) -> time:
    h, m = str(texto).split(":")[:2]
    return time(int(h), int(m))


def aberturas(janelas: list[Janela], dia: date) -> list[tuple[datetime, datetime]]:
    """As janelas da loja que ABREM em `dia`: (abertura, fechamento), na ordem. O fechamento é o fim do minuto de
    `hora_fim` — no dia seguinte, quando a janela cruza a meia-noite (como em `Janela.contem`)."""
    saida = set()
    for j in janelas:
        if j.dias and dia.isoweekday() not in j.dias:
            continue
        try:
            ini, fim = _hora_do_dia(j.hora_ini), _hora_do_dia(j.hora_fim)
        except (ValueError, TypeError):
            continue
        dia_do_fim = dia + timedelta(days=1) if j.hora_ini > j.hora_fim else dia
        saida.add((datetime.combine(dia, ini), datetime.combine(dia_do_fim, fim) + timedelta(minutes=1)))
    return sorted(saida)


def noite_do_lanche(janelas: list[Janela], canal: int, quando: datetime, folga: timedelta) -> Noite | None:
    """A noite de um lanche que começou em `quando` (hora local, sem fuso): a janela da loja aberta naquela hora, ou na
    folga depois de fechar. Nula fora do horário."""
    achadas = []
    for dia in (quando.date() - timedelta(days=1), quando.date()):
        for n, (abre, fecha) in enumerate(aberturas(janelas, dia)):
            if abre <= quando < fecha + folga:
                achadas.append((abre, fecha, n))
    if not achadas:
        return None
    abre, fecha, n = max(achadas)
    chave = f"ao-vivo-canal-{canal:02d}-{abre:%Y-%m-%d}" + (f"-{abre:%Hh%M}" if n else "")
    fim = fecha + folga
    if fim - abre > DURACAO_MAXIMA:
        pedaco = int((quando - abre) / DURACAO_MAXIMA)
        abre += pedaco * DURACAO_MAXIMA
        fim = min(fim, abre + DURACAO_MAXIMA)
        chave += f"-{pedaco + 1}" if pedaco else ""
    return Noite(chave, abre, fim)


def _local(texto: Any) -> datetime | None:
    """A hora do `passos.json` (com o fuso) na hora local, sem fuso; nula se torta."""
    if not isinstance(texto, str) or not texto or len(texto) > MAX_HORA:
        return None
    try:
        t = datetime.fromisoformat(texto)
    except ValueError:
        return None
    return t.astimezone().replace(tzinfo=None) if t.tzinfo is not None else t


# ───────────────────────────── a amostra ─────────────────────────────


@dataclass(frozen=True)
class LancheLido:
    """Um lanche da leitura ao vivo, na pasta dele: a hora em que começou, as dúvidas do juiz e o resumo do arquivo."""

    pasta: Path
    inicio: datetime
    duvidas: int
    resumo: str


def duvidas(passos: list[dict]) -> int:
    """Os passos em que o juiz teve dúvida — a regra da nuvem (`passoDeDuvida`): o vazio, e o passo e o provisório com
    nota abaixo de `NOTA_DE_DUVIDA`."""
    n = 0
    for p in passos:
        tipo, nota = p.get("tipo"), p.get("nota")
        if tipo == "vazio":
            n += 1
        elif tipo in ("passo", "provisorio") and isinstance(nota, (int, float)) and nota < NOTA_DE_DUVIDA:
            n += 1
    return n


def amostra(lanches: list[LancheLido], n: int) -> list[LancheLido]:
    """Os lanches da noite que sobem, na ordem da hora: primeiro os com dúvida (mais dúvidas antes; no empate, pela
    hora); nas vagas que sobram, os outros, espalhados pela noite. A mesma escolha para os mesmos lanches."""
    if n <= 0:
        return []
    por_hora = sorted(lanches, key=lambda l: (l.inicio, l.pasta.name))
    escolhidos = sorted((l for l in por_hora if l.duvidas), key=lambda l: (-l.duvidas, l.inicio, l.pasta.name))[:n]
    outros = [l for l in por_hora if not l.duvidas]
    vagas = n - len(escolhidos)
    if vagas >= len(outros):
        escolhidos += outros
    elif vagas > 0:
        passo = len(outros) / vagas
        escolhidos += [outros[int(i * passo + passo / 2)] for i in range(vagas)]
    return sorted(escolhidos, key=lambda l: (l.inicio, l.pasta.name))


# ───────────────────────────── o corpo ─────────────────────────────


def pao_pelas_pecas(pecas: int | None, nomes: list[str]) -> str | None:
    """Como a conferência: 3 peças é o pão de dois cortes, quando a loja tem UM pão com esse nome; com outro número de
    peças, o Farol não diz qual pão (por cima, ele ainda não separa o de um corte do brioche)."""
    if pecas != 3:
        return None
    achados = sorted({n for n in nomes if e_pao(n) and _DOIS_CORTES.search(chave_do_nome(n))})
    return achados[0] if len(achados) == 1 else None


def _fracao(v: Any) -> float | None:
    if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v):
        return None
    return round(min(1.0, max(0.0, float(v))), 3)


def _contorno(bruto: Any, k: float, largura: int, altura: int) -> list[list[list[int]]]:
    """O contorno na escala `k` do recorte que sobe, dentro dele e nos limites do contrato: até `MAX_PEDACOS` pedaços (os
    maiores: a leitura grava do maior para o menor) de 3 a `MAX_PONTOS` pontos."""
    saida: list[list[list[int]]] = []
    for pedaco in bruto[:MAX_PEDACOS] if isinstance(bruto, list) else []:
        pontos: list[list[int]] = []
        for p in pedaco if isinstance(pedaco, list) else []:
            if not (isinstance(p, list) and len(p) == 2) or any(
                isinstance(c, bool) or not isinstance(c, (int, float)) or not math.isfinite(c) for c in p
            ):
                continue
            ponto =[min(largura - 1, max(0, round(p[0] * k))), min(altura - 1, max(0, round(p[1] * k)))]
            if not pontos or pontos[-1] != ponto:
                pontos.append(ponto)
        if len(pontos) > MAX_PONTOS:
            passo = len(pontos) / MAX_PONTOS
            pontos = [pontos[int(i * passo)] for i in range(MAX_PONTOS)]
        if len(pontos) >= 3:
            saida.append(pontos)
    return saida


def corpo_do_lanche(noite: Noite, ponto_id: str | None, pasta: Path, leitura: dict, paes: list[str]) -> dict | None:
    """O corpo de `POST /v1/agentes/treino/lanches` de um lanche lido por passos (`leitura` é o `passos.json` dele).
    Nulo quando não sobra etapa nenhuma (nada a conferir)."""
    passos = []
    for p in leitura.get("passos") or []:
        if not isinstance(p, dict) or p.get("tipo") not in TIPOS:
            continue
        hora, metade = _local(p.get("hora")), p.get("metade")
        if hora is None or isinstance(metade, bool) or not isinstance(metade, int) or not 1 <= metade <= MAX_PECAS:
            continue
        passos.append((hora, p))
    passos.sort(key=lambda x: x[0])
    if len(passos) > MAX_ETAPAS:
        # a passagem não se confere: sai antes
        passos = [x for x in passos if x[1]["tipo"] != "transitorio"][:MAX_ETAPAS]
    if not passos:
        return None
    metades = leitura.get("metades")
    pecas = len(metades) if isinstance(metades, list) and 1 <= len(metades) <= MAX_PECAS else None
    pao = pao_pelas_pecas(pecas, paes)
    quadros: list[dict] = []
    etapas: list[dict] = []
    for hora, p in passos:
        tipo = p["tipo"]
        nome = p.get("nome").strip() if isinstance(p.get("nome"), str) and p["nome"].strip() else None
        e: dict[str, Any] = {
            "hora": _com_fuso(hora), "lado": "pao" if tipo == "comeco" else "outro", "inicio": tipo == "comeco",
            "leu": None, "candidatos": [], "vezes": 1, "quadro": None, "tipo": tipo, "metade": p["metade"],
        }
        if tipo == "comeco" and pao:
            e["leu"], e["candidatos"] = pao[:MAX_LEU], [pao[:MAX_CANDIDATO]]
        elif tipo in ("passo", "provisorio") and nome:
            e["leu"], e["candidatos"] = nome[:MAX_LEU], [nome[:MAX_CANDIDATO]]
        elif tipo == "vazio" and nome:
            e["leu"] = nome[:MAX_LEU]
        for campo in ("parte", "nota"):
            v = _fracao(p.get(campo))
            if v is not None:
                e[campo] = v
        arquivo = p.get("recorte")
        if tipo in COM_QUADRO and isinstance(arquivo, str) and arquivo and Path(arquivo).name == arquivo \
                and len(quadros) < MAX_QUADROS:
            img = imagens.ler(pasta / arquivo)
            dados = reduzir(img) if img is not None else None
            if dados is not None:
                h, w = img.shape[:2]
                k = min(1.0, LADO_DO_QUADRO / max(h, w))
                e["quadro"] = len(quadros)
                quadros.append({"imagemBase64": base64.b64encode(dados).decode("ascii")})
                contorno = _contorno(p.get("contorno"), k, max(1, round(w * k)), max(1, round(h * k)))
                if contorno:
                    e["contorno"] = contorno
        etapas.append(e)
    aberto, fechou = _local(leitura.get("inicio")), _local(leitura.get("fim"))
    return {
        "gravacao": {
            "chave": noite.chave, "pontoId": ponto_id, "inicio": _com_fuso(noite.inicio), "fim": _com_fuso(noite.fim),
            "origem": "ao-vivo",
        },
        "lanche": {
            "chave": pasta.name, "abertoEm": _com_fuso(aberto) if aberto else None,
            "fechouEm": _com_fuso(fechou) if fechou else None, "pecas": pecas, "etapas": etapas,
        },
        "quadros": quadros,
    }


def mandar(cliente: ClienteDaConferencia, corpo: dict) -> tuple[str, str | None]:
    """Manda o corpo e diz o destino do lanche, com o motivo quando não subiu."""
    try:
        cliente.lanche_de_treino(corpo)
    except ErroDaNuvem as e:
        if e.status == 409:
            return ENCERRADA, str(e)
        if e.status in (0, 401, 403, 429) or e.status >= 500:
            return DEPOIS, str(e)
        return RECUSADO, str(e)
    return SUBIU, None


# ───────────────────────────── a linha de execução ─────────────────────────────


def _resumo_do_arquivo(caminho: Path) -> str | None:
    try:
        return hashlib.sha256(caminho.read_bytes()).hexdigest()
    except OSError:
        return None


def _ler_json(caminho: Path) -> Any:
    try:
        return json.loads(caminho.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def _chave_do_recorte(escolhido: dict) -> str:
    """A chave que o recorte escolhido leva para a nuvem: a pasta do lanche e o arquivo (`recortes_na_nuvem.Candidato`)."""
    return f"{Path(str(escolhido.get('pasta'))).name}/{escolhido.get('arquivo')}"[:160]


def _gravar_json(caminho: Path, dados: Any) -> None:
    temporario = caminho.with_name(caminho.name + ".novo")
    temporario.write_text(json.dumps(dados, ensure_ascii=False), encoding="utf-8")
    os.replace(temporario, caminho)


@dataclass
class Volta:
    """O que uma volta fez: os lanches que subiram, os recusados, as noites encerradas no console e se parou por erro."""

    subiram: int = 0
    recusados: int = 0
    encerradas: int = 0
    parou: str | None = None
    # os recortes que subiram para marcar (A24 F3, `recortes_na_nuvem`)
    recortes: int = 0


class ConferenciaEmFundo:
    """As noites terminadas sobem para a conferência numa linha de execução própria, com a loja FECHADA."""

    def __init__(
        self, cliente: ClienteDaConferencia, caminho_config: str | Path, canais: list[int], *,
        por_noite: int = POR_NOITE, relogio: Callable[[], datetime] = datetime.now, pausa_s: float = PAUSA_S,
        folga: timedelta = timedelta(minutes=FOLGA_FECHAMENTO_MIN), marcar_por_noite: int = 0,
    ) -> None:
        self.cliente = cliente
        # A24 F3: os recortes de cada noite que sobem para marcar (`recortes_na_nuvem`); 0 desliga
        self.marcar_por_noite = marcar_por_noite
        self.caminho_config = Path(caminho_config)
        self.raiz = self.caminho_config.parent / PASTA_DA_BANCADA
        self.base = BaseDaLoja.ao_lado(caminho_config)
        self.canais = list(canais)
        self.por_noite = por_noite
        self._relogio, self.pausa_s, self.folga = relogio, pausa_s, folga
        self._lidos: dict[Path, tuple[float, LancheLido | None]] = {}
        self._avisou_sem_horario = False
        self._ultimo_erro: str | None = None
        self._parar = threading.Event()
        self._linha: threading.Thread | None = None

    # ── a leitura das pastas ──

    def _lanche(self, pasta: Path) -> LancheLido | None:
        """O lanche de uma pasta `passos-…`, se foi lido com o juiz (guardado pela data do arquivo: a volta seguinte não
        relê o que não mudou)."""
        arquivo = pasta / "passos.json"
        try:
            quando = arquivo.stat().st_mtime
        except OSError:
            return None
        guardado = self._lidos.get(pasta)
        if guardado is not None and guardado[0] == quando:
            return guardado[1]
        leitura, resumo = _ler_json(arquivo), _resumo_do_arquivo(arquivo)
        inicio = _local(leitura.get("inicio")) if isinstance(leitura, dict) else None
        lanche = None
        if inicio is not None and resumo is not None and leitura.get("juiz") is True \
                and isinstance(leitura.get("passos"), list) and leitura["passos"]:
            lanche = LancheLido(pasta, inicio, duvidas([p for p in leitura["passos"] if isinstance(p, dict)]), resumo)
        self._lidos[pasta] = (quando, lanche)
        return lanche

    def noites(self, canal: int, janelas: list[Janela], hoje: date) -> dict[Noite, list[LancheLido]]:
        """Os lanches lidos por passos de um canal, nos dias que a leitura ainda guarda, por noite."""
        pasta = self.raiz / f"canal-{canal:02d}"
        por_noite: dict[Noite, list[LancheLido]] = {}
        try:
            dias = sorted(d for d in pasta.iterdir() if d.is_dir() and _DIA.match(d.name))
        except OSError:
            return por_noite
        vistas = set()
        for d in dias:
            try:
                if (hoje - date.fromisoformat(d.name)).days > GUARDA_DIAS + 1:
                    continue
                lanches = sorted(p for p in d.iterdir() if p.is_dir() and p.name.startswith("passos-"))
            except (OSError, ValueError):
                continue
            for p in lanches:
                vistas.add(p)
                lanche = self._lanche(p)
                noite = noite_do_lanche(janelas, canal, lanche.inicio, self.folga) if lanche else None
                if noite is not None:
                    por_noite.setdefault(noite, []).append(lanche)
        for velha in [p for p in self._lidos if p.parent.parent == pasta and p not in vistas]:
            del self._lidos[velha]
        return por_noite

    # ── o envio ──

    @staticmethod
    def _ja_foi(lanche: LancheLido) -> bool:
        marca = _ler_json(lanche.pasta / ENVIADO)
        return isinstance(marca, dict) and marca.get("passos") == lanche.resumo

    def _marcar(self, lanche: LancheLido, noite: Noite, destino: str, motivo: str | None) -> None:
        marca = {"destino": destino, "em": _com_fuso(self._relogio()), "gravacao": noite.chave, "passos": lanche.resumo}
        if motivo:
            marca["motivo"] = motivo[:300]
        try:
            _gravar_json(lanche.pasta / ENVIADO, marca)
        except OSError as e:
            _log.warning("conferência: não marquei o lanche %s como enviado (%s)", lanche.pasta.name, e)

    def _encerradas(self, canal: int) -> list[str]:
        lista = _ler_json(self.raiz / f"canal-{canal:02d}" / ENCERRADAS)
        return [c for c in lista if isinstance(c, str)] if isinstance(lista, list) else []

    def _encerrar(self, canal: int, chave: str) -> None:
        lista = [c for c in self._encerradas(canal) if c != chave] + [chave]
        try:
            _gravar_json(self.raiz / f"canal-{canal:02d}" / ENCERRADAS, lista[-GUARDA_ENCERRADAS:])
        except OSError as e:
            _log.warning("conferência: não guardei a gravação %s como encerrada (%s)", chave, e)

    def _ponto(self, config_json: dict, canal: int) -> str | None:
        ponto = next((p for p in config_json.get("pontos") or [] if isinstance(p, dict) and p.get("canal") == canal), None)
        pid = str(ponto.get("id") or "") if ponto else ""
        return pid if _UUID.match(pid) else None

    def _paes(self) -> list[str]:
        lista = self.base.lista() or {}
        return [i["nome"] for i in lista.get("itens") or [] if isinstance(i, dict) and isinstance(i.get("nome"), str)
                and e_pao(i["nome"])]

    def volta(self) -> Volta | None:
        """Uma volta: com a loja fechada, sobem os lanches escolhidos das noites terminadas que ainda não subiram."""
        if self.por_noite <= 0:
            return None
        config_json = ler_do_disco(self.caminho_config)
        if not config_json:
            return None
        janelas = janelas_da_loja(config_json)
        agora = self._relogio()
        fechada = loja_fechada(janelas, agora)
        if fechada is None:
            if not self._avisou_sem_horario:
                _log.info("conferência: a loja não tem horário de funcionamento cadastrado; a noite espera ele para subir")
                self._avisou_sem_horario = True
            return None
        if not fechada:
            return None
        v = Volta()
        paes = self._paes()
        for canal in self.canais:
            ponto_id = self._ponto(config_json, canal)
            encerradas = set(self._encerradas(canal))
            for noite, lanches in sorted(self.noites(canal, janelas, agora.date()).items(), key=lambda x: x[0].inicio):
                if noite.fim + MARGEM > agora or noite.chave in encerradas:
                    continue
                escolhidos = amostra(lanches, self.por_noite)
                novos = 0
                for lanche in escolhidos:
                    if self._parar.is_set():
                        return v
                    if self._ja_foi(lanche):
                        continue
                    leitura = _ler_json(lanche.pasta / "passos.json")
                    corpo = corpo_do_lanche(noite, ponto_id, lanche.pasta, leitura, paes) if isinstance(leitura, dict) else None
                    if corpo is None:
                        self._marcar(lanche, noite, RECUSADO, "sem etapa para conferir")
                        continue
                    destino, motivo = mandar(self.cliente, corpo)
                    if destino == DEPOIS:
                        v.parou = motivo
                        self._dizer_erro(motivo)
                        return v
                    self._ultimo_erro = None
                    if destino == ENCERRADA:
                        _log.info("conferência: a gravação %s foi encerrada no console; os lanches dela param de subir",
                                  noite.chave)
                        self._encerrar(canal, noite.chave)
                        v.encerradas += 1
                        break
                    self._marcar(lanche, noite, destino, motivo)
                    if destino == RECUSADO:
                        _log.warning("conferência: a nuvem recusou o lanche %s da noite %s (%s); não repito",
                                     lanche.pasta.name, noite.chave, motivo)
                        v.recusados += 1
                    else:
                        v.subiram += 1
                        novos += 1
                if novos:
                    _log.info(
                        "conferência: %d lanche(s) da noite %s subiram (%d escolhidos de %d; %d com dúvida do juiz)",
                        novos, noite.chave, len(escolhidos), len(lanches), sum(1 for l in escolhidos if l.duvidas),
                    )
                # os recortes para marcar (A24 F3): da mesma noite, dos lanches que NÃO foram para a conferência
                if self.marcar_por_noite > 0 and noite.chave not in set(self._encerradas(canal)):
                    if self._recortes(canal, noite, lanches, escolhidos, ponto_id, v):
                        return v
        return v

    # ── os recortes para marcar (A24 F3) ──

    def _estado_dos_recortes(self, canal: int) -> dict:
        """O que já foi escolhido e mandado, por noite (`noites`), e desde qual noite a amostra vale (`desde`). Na
        primeira volta depois do pacote novo (sem o arquivo), `desde` é a noite mais nova no disco (terminada ou não):
        as de antes não sobem — o dono pode já ter marcado na página local (21 e 22/10)."""
        estado = _ler_json(self.raiz / f"canal-{canal:02d}" / RECORTES_ESTADO)
        if isinstance(estado, dict) and isinstance(estado.get("noites"), dict) and isinstance(estado.get("desde"), str):
            return estado
        config_json = ler_do_disco(self.caminho_config) or {}
        agora = self._relogio()
        desde = max((n.inicio for n in self.noites(canal, janelas_da_loja(config_json), agora.date())), default=agora)
        estado = {"desde": _com_fuso(desde), "noites": {}}
        self._guardar_recortes(canal, estado)
        return estado

    def _guardar_recortes(self, canal: int, estado: dict) -> None:
        # só as noites mais novas: a leitura guarda os passos por poucos dias
        noites = estado["noites"]
        if len(noites) > GUARDA_NOITES_DOS_RECORTES:
            for velha in sorted(noites)[: len(noites) - GUARDA_NOITES_DOS_RECORTES]:
                del noites[velha]
        try:
            _gravar_json(self.raiz / f"canal-{canal:02d}" / RECORTES_ESTADO, estado)
        except OSError as e:
            _log.warning("marcar: não guardei o que subiu do canal %d (%s)", canal, e)

    def _recortes(self, canal: int, noite: Noite, lanches: list[LancheLido], conferencia: list[LancheLido],
                  ponto_id: str | None, v: Volta) -> bool:
        """Sobe o que falta da amostra de recortes da noite, em envios de até 25. Verdadeiro: parou (por erro, ou porque
        a linha está parando) — a volta para ali, como os lanches."""
        from farol_agent.recortes_na_nuvem import POR_ENVIO, candidatos_do_lanche, recorte
        from farol_agent.recortes_na_nuvem import amostra as amostra_de_recortes
        from farol_agent.recortes_na_nuvem import mandar as mandar_recortes

        pasta_canal = self.raiz / f"canal-{canal:02d}"
        estado = self._estado_dos_recortes(canal)
        desde = _local(estado["desde"])
        if desde is not None and noite.inicio < desde:
            return False
        da_noite = estado["noites"].get(noite.chave)
        if da_noite is None:
            fora = {l.pasta for l in conferencia}
            candidatos = []
            for l in lanches:
                leitura = _ler_json(l.pasta / "passos.json") if l.pasta not in fora else None
                if isinstance(leitura, dict):
                    candidatos += candidatos_do_lanche(l.pasta, leitura, _local)
            escolha = amostra_de_recortes(candidatos, self.marcar_por_noite, NOTA_DE_DUVIDA)
            da_noite = {
                "escolhidos": [{"pasta": c.pasta.relative_to(pasta_canal).as_posix(), "arquivo": c.arquivo, "parte": parte}
                               for c, parte in escolha],
                "feitos": [], "recusados": [],
            }
            estado["noites"][noite.chave] = da_noite
            self._guardar_recortes(canal, estado)
            if escolha:
                partes = [p for _, p in escolha]
                _log.info("marcar: a noite %s escolheu %d recorte(s) de %d (%d de dúvida, %d começos, %d de cobertura)",
                          noite.chave, len(escolha), len(candidatos), partes.count("duvida"), partes.count("comeco"),
                          partes.count("cobertura"))
        prontos = set(da_noite.get("feitos") or []) | set(da_noite.get("recusados") or [])
        falta = [e for e in da_noite.get("escolhidos") or [] if isinstance(e, dict)
                 and _chave_do_recorte(e) not in prontos]
        leituras: dict[str, Any] = {}
        subiram = 0
        for i in range(0, len(falta), POR_ENVIO):
            if self._parar.is_set():
                return True
            lote, chaves, sem_imagem = [], [], []
            for e in falta[i : i + POR_ENVIO]:
                pasta = pasta_canal / str(e.get("pasta"))
                if str(pasta) not in leituras:
                    leituras[str(pasta)] = _ler_json(pasta / "passos.json")
                leitura = leituras[str(pasta)]
                achado = next((c for c in candidatos_do_lanche(pasta, leitura, _local) if c.arquivo == e.get("arquivo")),
                              None) if isinstance(leitura, dict) else None
                corpo = recorte(achado, str(e.get("parte")), _contorno) if achado is not None else None
                if corpo is None:
                    # a pasta saiu (a leitura guarda poucos dias) ou a imagem não abre: não sobe, e não se tenta de novo
                    sem_imagem.append(_chave_do_recorte(e))
                    continue
                lote.append(corpo)
                chaves.append(_chave_do_recorte(e))
            da_noite["recusados"] = list(da_noite.get("recusados") or []) + sem_imagem
            if lote:
                envio = {
                    "gravacao": {"chave": noite.chave, "pontoId": ponto_id, "inicio": _com_fuso(noite.inicio),
                                 "fim": _com_fuso(noite.fim), "origem": "ao-vivo"},
                    "recortes": lote,
                }
                destino, motivo = mandar_recortes(self.cliente, envio)
                if destino == DEPOIS:
                    self._guardar_recortes(canal, estado)
                    v.parou = motivo
                    self._dizer_erro(motivo)
                    return True
                self._ultimo_erro = None
                if destino == ENCERRADA:
                    _log.info("marcar: a gravação %s foi encerrada no console; os recortes dela param de subir", noite.chave)
                    self._encerrar(canal, noite.chave)
                    v.encerradas += 1
                    self._guardar_recortes(canal, estado)
                    return False
                if destino == RECUSADO:
                    _log.warning("marcar: a nuvem recusou %d recorte(s) da noite %s (%s); não repito", len(lote),
                                 noite.chave, motivo)
                    da_noite["recusados"] = list(da_noite["recusados"]) + chaves
                else:
                    da_noite["feitos"] = list(da_noite.get("feitos") or []) + chaves
                    subiram += len(chaves)
                    v.recortes += len(chaves)
            self._guardar_recortes(canal, estado)
        if subiram:
            _log.info("marcar: %d recorte(s) da noite %s subiram para marcar", subiram, noite.chave)
        return False

    def _dizer_erro(self, motivo: str | None) -> None:
        # A mesma frase não volta ao registro a cada volta (ERR-014).
        if motivo != self._ultimo_erro:
            _log.info("conferência: os lanches não subiram agora (%s); de novo na volta seguinte", motivo)
            self._ultimo_erro = motivo

    def _rodar(self) -> None:
        while not self._parar.is_set():
            try:
                self.volta()
            except Exception:  # noqa: BLE001 — um defeito numa volta não para a linha
                _log.exception("conferência: erro inesperado; sigo")
            self._parar.wait(self.pausa_s)

    def iniciar(self) -> None:
        if self._linha is not None:
            return
        self._parar.clear()
        self._linha = threading.Thread(target=self._rodar, name="farol-conferencia", daemon=True)
        self._linha.start()

    def parar(self, espera_s: float = 10.0) -> None:
        self._parar.set()
        if self._linha is not None:
            self._linha.join(espera_s)
            self._linha = None
