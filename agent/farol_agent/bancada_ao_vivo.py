"""A bancada ao vivo (A23.2): o lanche lido como vídeo, na loja, enquanto ele acontece.

O dono, 16/10/2026: a montagem é acompanhada como um vídeo; "bancada vazia, provavelmente sem produto — não é falha de
análise, é que não tem o que analisar"; "se um pão entra na bancada, ele vai ser preparado até a conclusão e a
embalagem"; "a mão sair não significa nenhum tipo de conclusão". Em 17/10, com a medida do processador da loja na mão:
"pode começar".

**A leitura.** Um quadro por segundo do fluxo PRINCIPAL do canal, na resolução da câmera, recortado na área de montagem
como na gravação de treino (`gravacao_lida.guardar_recorte`); o detector acha os pães abertos e duas leituras andam
juntas, com os mesmos grupos de pão:

- o LUGAR do lanche (`lugar_do_lanche`, A23.2e): o papel ou a caixa é o lugar do lanche, e o lanche só termina no
  embrulho — é o lanche da linha do tempo;
- a TRILHA do pão (`treino_lanches.Seguidor`, a leitura da gravação de treino, com os mesmos números da câmera,
  `perfil_da_bancada.json`): segue o pão enquanto ele está à vista; fica para comparar, e é dela a pasta com os
  recortes que a identificação dos ingredientes lê.

**O que sai**, ao lado da configuração, em `bancada/canal-NN/`:

- `AAAA-MM-DD.jsonl`, a linha do tempo do dia, cada linha com a hora e o fuso:
  - `estado`: a bancada mudou — `vazia` (nada a analisar) ou `lanche` (pão sendo seguido na bancada);
  - `pao`: apareceu um pão aberto (o começo de uma trilha);
  - `lanche`: um lanche terminou, pelo LUGAR: o começo (o primeiro pão no papel), o fim (o papel dobrado ou a caixa
    fechada e levada — `porque`: embrulho, parado, teto), quantos quadros com pão, onde nasceu (`x`, no recorte) e as
    vezes em que foi movido; `encerrado` diz quando quem terminou foi a leitura (a loja fechou, o agente parou). Os
    quadros dele ficam na sessão guardada (`FAROL_BANCADA_GUARDAR_QUADROS`);
  - `trilha`: uma trilha do pão terminou (o que antes era o `lanche`), com o começo, o fim, as ETAPAS e a pasta;
  - `resumo`: de dez em dez minutos, quantos quadros, quanto tempo cada um levou e o que ficou de fora;
  - `ligada` e `desligada`, com o motivo;
- `AAAA-MM-DD/lanche-HHhMMmSS-N/`, cada trilha: os recortes na caixa fixa, as etapas e o `metades.csv`, como os da
  gravação de treino (é o que a identificação dos ingredientes lê, A23.3).

Os quadros que nenhum lanche usa saem do disco logo; as pastas dos lanches ficam `GUARDA_DIAS` dias, e a linha do tempo,
`GUARDA_LINHA_DIAS`. Só se apaga o que esta leitura cria (pelo nome).

**Com a loja aberta** (o horário da configuração, e mais `FOLGA_FECHAMENTO_MIN` depois de fechar, para o último
lanche): fechada, a bancada está vazia, o fluxo do gravador é fechado e o processador fica para a gravação de treino.
Sem horário cadastrado, lê sempre.

**Dorme:** só liga com `FAROL_BANCADA_AO_VIVO` (os números dos canais, separados por vírgula) no ambiente do agente.
"""

from __future__ import annotations

import csv
import json
import logging
import re
import shutil
import threading
import time
from collections import deque
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any, Callable, Protocol

from farol_agent import treino_lanches, treino_quadros
from farol_agent.configuracao import de_json, ler_do_disco
from farol_agent.gravacao_lida import guardar_recorte, quadro_do_canal
from farol_agent.lugar_do_lanche import LeitorDeLugares, Lugar
from farol_agent.modelos import Janela, Zona
from farol_agent.treino_servico import _detector_da_auditoria, janelas_da_loja, perfil_da_bancada

_log = logging.getLogger(__name__)

VARIAVEL = "FAROL_BANCADA_AO_VIVO"
# Com esta chave, a leitura guarda TODOS os quadros da sessão, no formato da densa da gravação de treino
# (`paradas.csv` + `recortes/`): a noite inteira pode ser lida de novo depois, por qualquer versão da leitura, e as
# versões comparadas lado a lado. Sem ela, só ficam os quadros dos lanches (nas pastas deles).
GUARDAR = "FAROL_BANCADA_GUARDAR_QUADROS"
PASTA = "bancada"
QUADROS = "quadros"
DENSA = "densa"
GUARDA_DENSA_DIAS = 2
# Um quadro por segundo: o da gravação de treino (a carne e o queijo levam 2 a 3 s para entrar — o dono, 14/10).
A_CADA_S = 1.0
# O quadro mais velho que isto não vale: o fluxo parou, e o quadro que ficou não é de agora.
IDADE_MAXIMA_S = 3.0
GUARDA_DIAS = 3
GUARDA_LINHA_DIAS = 30
RESUMO_A_CADA_S = 600.0
LIMPEZA_A_CADA_S = 3600.0
CONFIG_A_CADA_S = 300.0
# O mesmo erro, de novo, só volta ao registro depois disto (um defeito a cada quadro afogaria o registro: ERR-014).
REPETE_AVISO_S = 3600.0
FOLGA_FECHAMENTO_MIN = 30
VAZIA, LANCHE = "vazia", "lanche"
_DIA = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_LINHA = re.compile(r"^(\d{4}-\d{2}-\d{2})\.jsonl$")
_QUADRO = re.compile(r"^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}_\d{3}\.jpg$")
_SESSAO = re.compile(r"^(\d{4}-\d{2}-\d{2})_\d{2}h\d{2}$")


def guardar_quadros_ligado(valor: str | None) -> bool:
    """`FAROL_BANCADA_GUARDAR_QUADROS`: "1", "sim", "true" ou "ligado" liga; o resto, não."""
    return (valor or "").strip().lower() in ("1", "sim", "true", "ligado")


def canais_ligados(valor: str | None) -> list[int]:
    """Os canais de `FAROL_BANCADA_AO_VIVO` ("4", "4,7"), sem repetir, na ordem. Vazio: desligada. O que não é número
    de canal fica de fora, e o registro diz."""
    canais: list[int] = []
    for parte in (valor or "").split(","):
        parte = parte.strip()
        if not parte:
            continue
        if not parte.isdigit() or int(parte) < 1:
            _log.warning("bancada ao vivo: %r em %s não é número de canal; fica de fora", parte, VARIAVEL)
            continue
        if int(parte) not in canais:
            canais.append(int(parte))
    return canais


def aberta(janelas: list[Janela], agora: datetime) -> bool:
    """A loja está aberta agora, ou fechou há menos de `FOLGA_FECHAMENTO_MIN`? Sem horário cadastrado: sim."""
    if not janelas:
        return True
    pouco_antes = agora - timedelta(minutes=FOLGA_FECHAMENTO_MIN)
    return any(j.contem(agora) or j.contem(pouco_antes) for j in janelas)


def _iso(t: datetime) -> str:
    """A hora com o fuso (o computador da loja está no fuso dela): quem lê não supõe nada (ERR-022)."""
    return t.astimezone().isoformat(timespec="seconds")


def limpar(pasta: Path, hoje: date) -> int:
    """Apaga as pastas de lanche com mais de `GUARDA_DIAS` dias, as linhas do tempo com mais de `GUARDA_LINHA_DIAS` e
    as sessões guardadas inteiras (`densa/`) com mais de `GUARDA_DENSA_DIAS`. Só o que esta leitura cria, pelo nome.
    Devolve quantas apagou."""
    apagadas = 0
    if not pasta.is_dir():
        return 0
    itens = [(item, _DIA, GUARDA_DIAS) for item in pasta.iterdir() if item.is_dir()]
    itens += [(item, _LINHA, GUARDA_LINHA_DIAS) for item in pasta.iterdir() if item.is_file()]
    if (pasta / DENSA).is_dir():
        itens += [(item, _SESSAO, GUARDA_DENSA_DIAS) for item in (pasta / DENSA).iterdir() if item.is_dir()]
    for item, nome, dias in itens:
        m = nome.match(item.name)
        if not m:
            continue
        try:
            if (hoje - date.fromisoformat(m.group(1) if m.groups() else item.name)).days > dias:
                if item.is_dir():
                    shutil.rmtree(item)
                else:
                    item.unlink()
                apagadas += 1
        except (ValueError, OSError) as e:
            _log.warning("bancada ao vivo: não apaguei %s (%s)", item.name, type(e).__name__)
    return apagadas


class Fluxo(Protocol):
    """O fluxo do gravador: o quadro mais recente (instante, imagem), ou nada."""

    def ultimo(self, idade_maxima_seg: float = ...) -> tuple[datetime, Any] | None:
        ...

    def parar(self) -> None:
        ...


def abrir_fluxo_principal(ponto) -> Fluxo:
    """O fluxo PRINCIPAL do canal, aberto e drenado o tempo todo (`_LeitorContinuo`: guarda só o quadro mais recente).
    O endereço leva a senha do cofre e não vai a registro nenhum."""
    from farol_agent.fontes.rtsp import _LeitorContinuo
    from farol_agent.servico import url_do_ponto

    leitor = _LeitorContinuo(
        url_do_ponto(ponto), f"canal{ponto.canal}-bancada",
        alcance=(ponto.host, int(ponto.porta or 554)) if ponto.host else None,
    )
    leitor.iniciar()
    return leitor


@dataclass
class _Contas:
    quadros: int = 0
    sem_quadro: int = 0
    repetidos: int = 0
    # os lanches pelo lugar, e os lugares que não chegaram a lanche (o detector achou pão no que não era)
    lanches: int = 0
    lugares_sem_lanche: int = 0
    # as trilhas do pão que viraram pasta, e as curtas demais
    trilhas: int = 0
    curtas: int = 0
    erros: int = 0
    ms: float = 0.0


class LeituraDoCanal:
    """A bancada de um canal, ao vivo: o fluxo aberto, o seguidor dos lanches e o que vai para o disco."""

    def __init__(
        self, canal: int, zona: Zona, fluxo: Fluxo, detector: treino_lanches.Detector,
        perfil: treino_lanches.PerfilDaBancada, pasta: Path, *, relogio: Callable[[], datetime] = datetime.now,
        guardar_quadros: bool = False,
    ) -> None:
        self.canal, self.zona, self.fluxo, self.detector, self.perfil = canal, zona, fluxo, detector, perfil
        self.pasta = Path(pasta)
        self._relogio = relogio
        self.guardar = guardar_quadros
        self._paradas: Path | None = None
        self._indice = 0
        if self.guardar:
            # A sessão inteira, como a densa da gravação de treino: `paradas.csv` + `recortes/`, que
            # `treino_lanches.lanches_da_densa` lê de novo.
            sessao = self.pasta / DENSA / f"{relogio():%Y-%m-%d_%Hh%M}"
            self.quadros = sessao / treino_quadros.RECORTES
            self.quadros.mkdir(parents=True, exist_ok=True)
            self._paradas = sessao / treino_quadros.PARADAS
            if not self._paradas.exists():
                with self._paradas.open("w", encoding="utf-8", newline="") as f:
                    csv.writer(f, lineterminator="\n").writerow(treino_quadros.CABECALHO)
        else:
            self.quadros = self.pasta / QUADROS
            self.quadros.mkdir(parents=True, exist_ok=True)
            # Os quadros de uma leitura que caiu no meio não servem a ninguém: saem (só os desta leitura, pelo nome).
            for arquivo in self.quadros.iterdir():
                if arquivo.is_file() and _QUADRO.match(arquivo.name):
                    arquivo.unlink(missing_ok=True)
        self.seguidor = treino_lanches.Seguidor(perfil, guardar_todos=False)
        self.lugares = LeitorDeLugares(perfil)
        self.estado: str | None = None
        self.contas = _Contas()
        self._guardados: deque[tuple[datetime, Path]] = deque()
        self._anterior: datetime | None = None
        self._largura = self._altura = 0
        self._proximo_resumo: datetime | None = None

    # ───────────────────────────── a linha do tempo ─────────────────────────────

    def anotar(self, quando: datetime, evento: str, **campos: Any) -> None:
        linha = {"t": _iso(quando), "canal": self.canal, "evento": evento, **campos}
        self.pasta.mkdir(parents=True, exist_ok=True)
        with (self.pasta / f"{quando:%Y-%m-%d}.jsonl").open("a", encoding="utf-8", newline="\n") as f:
            f.write(json.dumps(linha, ensure_ascii=False) + "\n")

    def _resumir(self, quando: datetime) -> None:
        c = self.contas
        self.anotar(
            quando, "resumo", quadros=c.quadros, msPorQuadro=round(c.ms / c.quadros) if c.quadros else None,
            semQuadro=c.sem_quadro, repetidos=c.repetidos, lanches=c.lanches, lugaresSemLanche=c.lugares_sem_lanche,
            trilhas=c.trilhas, curtas=c.curtas, erros=c.erros, estado=self.estado,
        )
        self.contas = _Contas()
        self._proximo_resumo = quando + timedelta(seconds=RESUMO_A_CADA_S)

    # ───────────────────────────── um quadro ─────────────────────────────

    def um_quadro(self) -> bool:
        """O quadro mais recente do fluxo, se for novo. Devolve se leu."""
        atual = self.fluxo.ultimo(IDADE_MAXIMA_S)
        if atual is None:
            self.contas.sem_quadro += 1
            return False
        quando, imagem = atual
        if self._anterior is not None and quando <= self._anterior:
            # O fluxo não trouxe quadro novo desde a última vez: o mesmo quadro não conta duas vezes.
            self.contas.repetidos += 1
            return False
        comeco = time.perf_counter()
        self._anterior = quando
        if self._proximo_resumo is None:
            self._proximo_resumo = quando + timedelta(seconds=RESUMO_A_CADA_S)
        nome = f"{quando:%Y-%m-%d_%H-%M-%S}_{quando.microsecond // 1000:03d}.jpg"
        destino = self.quadros / nome
        # Gravado e lido de volta, como na gravação de treino: os números da câmera foram medidos no recorte gravado.
        guardar_recorte(imagem, self.zona, destino)
        self._guardados.append((quando, destino))
        if self._paradas is not None:
            texto = f"{quando:%Y-%m-%d %H:%M:%S.%f}"[:-3]
            with self._paradas.open("a", encoding="utf-8", newline="") as f:
                csv.writer(f, lineterminator="\n").writerow(["ao-vivo", self._indice, texto, texto, 0, nome])
            self._indice += 1
        img = treino_lanches.ler_imagem(destino)
        if img is None:
            raise OSError(f"o recorte {nome} não abriu depois de gravado")
        self._altura, self._largura = img.shape[:2]
        antes = {a.id for a in self.seguidor.ativos}
        regioes = treino_lanches.lanches_do_quadro(
            treino_lanches.paes(self.detector, img, self.perfil), self.perfil, self._largura, self._altura,
        )
        terminaram = self.seguidor.quadro(img, quando, nome, regioes)
        for a in self.seguidor.ativos:
            if a.id not in antes:
                self.anotar(quando, "pao", trilha=a.id)
        for a in terminaram:
            self._terminou(a)
        for lugar in self.lugares.quadro(img, quando, regioes):
            self._lugar_terminou(lugar)
        self._mudar_estado(quando)
        self._soltar_quadros(quando)
        self.contas.quadros += 1
        self.contas.ms += 1000 * (time.perf_counter() - comeco)
        if quando >= self._proximo_resumo:
            self._resumir(quando)
        return True

    def _terminou(self, a: treino_lanches.Trilha, encerrado: str | None = None) -> None:
        """Uma trilha do pão terminou: a pasta dos recortes (o que a identificação lê) e o evento `trilha`."""
        if a.duracao_s < self.perfil.duracao_minima_s:
            self.contas.curtas += 1
            return
        dia = self.pasta / f"{a.inicio:%Y-%m-%d}"
        nome = f"lanche-{a.inicio:%Hh%Mm%S}-{a.id}"
        treino_lanches.escrever_lanche(a, self.quadros, dia, self._largura, self._altura, self.perfil, nome=nome)
        self.contas.trilhas += 1
        campos: dict[str, Any] = {
            "trilha": a.id, "inicio": _iso(a.inicio), "fim": _iso(a.fim or a.visto), "duracaoS": round(a.duracao_s, 1),
            "mudouDeLugar": a.mudou_de_lugar, "quadros": len(a.quadros),
            "etapas": [e.removesuffix(".jpg") for e in a.etapas], "pasta": f"{dia.name}/{nome}",
        }
        if encerrado:
            campos["encerrado"] = encerrado
        self.anotar(a.fim or a.visto, "trilha", **campos)

    def _lugar_terminou(self, l: Lugar, encerrado: str | None = None) -> None:
        """Um lugar terminou: se chegou a lanche, o evento `lanche` (o começo, o fim no embrulho, por que terminou)."""
        if not self.lugares.e_lanche(l):
            self.contas.lugares_sem_lanche += 1
            return
        self.contas.lanches += 1
        campos: dict[str, Any] = {
            "lugar": l.n, "inicio": _iso(l.inicio), "fim": _iso(l.fim or l.inicio), "duracaoS": round(l.duracao_s, 1),
            "porque": l.porque, "comPao": l.com_pao, "x": round(l.nasceu_cx),
            "movido": [{"t": _iso(q), "de": de, "para": para} for q, de, para in l.movido],
        }
        if encerrado and l.porque == "encerrado":
            campos["encerrado"] = encerrado
        self.anotar(l.fim or l.inicio, "lanche", **campos)

    def _mudar_estado(self, quando: datetime) -> None:
        estado = LANCHE if self.seguidor.ativos else VAZIA
        if estado != self.estado:
            self.estado = estado
            self.anotar(quando, "estado", estado=estado, lanches=len(self.seguidor.ativos))

    def _soltar_quadros(self, quando: datetime) -> None:
        """Os quadros que nenhum lanche na bancada usa saem do disco (o lanche novo começa no quadro de agora). Com a
        sessão guardada, todos ficam."""
        if self.guardar:
            self._guardados.clear()
            return
        em_uso = min((a.quadros[0][0] for a in self.seguidor.ativos if a.quadros), default=quando)
        while self._guardados and self._guardados[0][0] < em_uso:
            _, arquivo = self._guardados.popleft()
            arquivo.unlink(missing_ok=True)

    # ───────────────────────────── o fim ─────────────────────────────

    def encerrar(self, motivo: str) -> None:
        """O fim da leitura (a loja fechou, o agente parou, a área mudou): os lanches que estavam na bancada terminam no
        último quadro, marcados como encerrados pela leitura; o fluxo fecha e os quadros saem do disco."""
        try:
            quando = self._anterior or self._relogio()
            for a in self.seguidor.encerrar(self._anterior):
                self._terminou(a, encerrado=motivo)
            for lugar in self.lugares.encerrar(quando):
                self._lugar_terminou(lugar, encerrado=motivo)
            if self.estado == LANCHE:
                self.estado = VAZIA
                self.anotar(quando, "estado", estado=VAZIA, lanches=0)
            self._resumir(quando)
            self.anotar(quando, "desligada", motivo=motivo)
        finally:
            self.fluxo.parar()
            while self._guardados:
                arquivo = self._guardados.popleft()[1]
                if not self.guardar:
                    arquivo.unlink(missing_ok=True)


@dataclass
class CanalAoVivo:
    """O que o laço de um canal guarda de uma volta para a outra."""

    canal: int
    leitura: LeituraDoCanal | None = None
    chave: tuple | None = None
    conferir_em: float = float("-inf")
    limpar_em: float = float("-inf")
    motivo_dito: str | None = None
    avisos: dict[str, float] = field(default_factory=dict)


class BancadaAoVivo:
    """A bancada ao vivo no serviço do agente: uma linha de execução por canal ligado.

    As peças saem da configuração em disco, conferida a cada `config_a_cada_s` (o console muda a área, o horário): a
    área de montagem do canal, o ponto (o gravador), o detector da auditoria (o mesmo, carregado uma vez por processo) e
    o perfil da bancada. Falta uma, a leitura espera, e o registro diz o motivo uma vez.
    """

    def __init__(
        self,
        caminho_config: str | Path,
        canais: list[int],
        *,
        detector_de: Callable[[], Any] = _detector_da_auditoria,
        abrir_fluxo: Callable[[Any], Fluxo] = abrir_fluxo_principal,
        relogio: Callable[[], datetime] = datetime.now,
        a_cada_s: float = A_CADA_S,
        config_a_cada_s: float = CONFIG_A_CADA_S,
        limpeza_a_cada_s: float = LIMPEZA_A_CADA_S,
        guardar_quadros: bool = False,
    ) -> None:
        self.caminho_config = Path(caminho_config)
        self.canais = list(canais)
        self.guardar_quadros = guardar_quadros
        self.raiz = self.caminho_config.parent / PASTA
        self._detector_de, self._abrir_fluxo, self._relogio = detector_de, abrir_fluxo, relogio
        self.a_cada_s, self.config_a_cada_s, self.limpeza_a_cada_s = a_cada_s, config_a_cada_s, limpeza_a_cada_s
        self._parar = threading.Event()
        self._linhas: list[threading.Thread] = []

    def pasta_do_canal(self, canal: int) -> Path:
        return self.raiz / f"canal-{canal:02d}"

    # ───────────────────────────── as peças ─────────────────────────────

    def pecas(self, canal: int) -> tuple[tuple | None, dict[str, Any] | str]:
        """(a chave do que se lê, as peças) — ou (nulo, o motivo de não ler agora). A chave muda quando muda o que a
        leitura usa (o gravador, o canal, o desenho da área): aí a leitura recomeça."""
        config_json = ler_do_disco(self.caminho_config)
        if not config_json:
            return None, "sem configuração em disco"
        if not aberta(janelas_da_loja(config_json), self._relogio()):
            return None, "a loja está fechada"
        try:
            _, zona = quadro_do_canal(config_json, canal)
        except ValueError as e:
            return None, f"{e}: a leitura precisa do quadro da bancada (a área da montagem) desenhado no canal"
        ponto = next((p for p in de_json(config_json).pontos if p.canal == canal), None)
        if ponto is None or not ponto.host:
            return None, f"o canal {canal} não tem gravador na configuração"
        detector = self._detector_de()
        if detector is None:
            return None, "o detector não está instalado neste computador (farol-agent detector instalar)"
        perfil = perfil_da_bancada(self.caminho_config)
        if perfil is None:
            return None, "falta o perfil da bancada desta loja (os números da câmera, medidos na instalação)"
        chave = (
            ponto.host, ponto.porta, ponto.canal, ponto.fabricante, ponto.usuario, ponto.segredo_ref,
            tuple(map(tuple, zona.poligono)),
        )
        return chave, {"ponto": ponto, "zona": zona, "detector": detector, "perfil": perfil}

    # ───────────────────────────── o laço de um canal ─────────────────────────────

    def passo(self, c: "CanalAoVivo", agora_s: float) -> None:
        """Uma volta do laço de um canal, no instante `agora_s` (do relógio que só anda para a frente): de tempos em
        tempos confere a configuração (e recomeça a leitura se o que ela usa mudou, ou para, com o motivo) e limpa o
        disco; e lê um quadro. Um defeito aqui não para a leitura: conta, e o registro diz uma vez por hora."""
        try:
            if agora_s >= c.conferir_em:
                c.conferir_em = agora_s + self.config_a_cada_s
                nova, pecas = self.pecas(c.canal)
                if c.leitura is not None and (nova is None or nova != c.chave):
                    leitura, c.leitura = c.leitura, None
                    leitura.encerrar(pecas if isinstance(pecas, str) else "a configuração do canal mudou")
                if nova is None:
                    if pecas != c.motivo_dito:
                        _log.info("bancada ao vivo, canal %d: não leio agora — %s", c.canal, pecas)
                        c.motivo_dito = pecas
                elif c.leitura is None:
                    fluxo = self._abrir_fluxo(pecas["ponto"])
                    c.leitura = LeituraDoCanal(
                        c.canal, pecas["zona"], fluxo, pecas["detector"], pecas["perfil"], self.pasta_do_canal(c.canal),
                        relogio=self._relogio, guardar_quadros=self.guardar_quadros,
                    )
                    c.chave, c.motivo_dito = nova, None
                    c.leitura.anotar(self._relogio(), "ligada")
                    _log.info("bancada ao vivo, canal %d: lendo um quadro por segundo", c.canal)
            if agora_s >= c.limpar_em:
                c.limpar_em = agora_s + self.limpeza_a_cada_s
                limpar(self.pasta_do_canal(c.canal), self._relogio().date())
            if c.leitura is not None:
                c.leitura.um_quadro()
        except Exception as e:  # noqa: BLE001 — um defeito num quadro não pode parar a leitura até alguém reiniciar
            if c.leitura is not None:
                c.leitura.contas.erros += 1
            texto = f"{type(e).__name__}: {e}"
            if agora_s - c.avisos.get(texto, agora_s - REPETE_AVISO_S) >= REPETE_AVISO_S:
                c.avisos[texto] = agora_s
                _log.exception("bancada ao vivo, canal %d: erro inesperado (%s); sigo", c.canal, texto)

    def fechar(self, c: "CanalAoVivo", motivo: str) -> None:
        if c.leitura is None:
            return
        leitura, c.leitura = c.leitura, None
        try:
            leitura.encerrar(motivo)
        except Exception:  # noqa: BLE001
            _log.exception("bancada ao vivo, canal %d: erro ao encerrar a leitura", c.canal)

    def _rodar_canal(self, canal: int) -> None:
        c = CanalAoVivo(canal)
        while not self._parar.is_set():
            comeco = time.monotonic()
            self.passo(c, comeco)
            self._parar.wait(max(0.0, self.a_cada_s - (time.monotonic() - comeco)))
        self.fechar(c, "o agente parou")

    # ───────────────────────────── ligar e desligar ─────────────────────────────

    def iniciar(self) -> None:
        if self._linhas:
            return
        self._parar.clear()
        for canal in self.canais:
            linha = threading.Thread(target=self._rodar_canal, args=(canal,), name=f"farol-bancada-{canal}", daemon=True)
            linha.start()
            self._linhas.append(linha)

    def parar(self, espera_s: float = 15.0) -> None:
        self._parar.set()
        for linha in self._linhas:
            linha.join(espera_s)
        self._linhas = []
