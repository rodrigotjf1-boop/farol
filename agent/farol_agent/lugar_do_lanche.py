"""O lugar do lanche (A23.2e): o papel ou a caixa aberta é o LUGAR do lanche, e o lanche só termina no embrulho.

O dono, 19/10/2026, depois de ver a primeira noite guardada: "o pão não some quando se coloca molho e alface em cima —
na verdade se somam nas etapas: papel → topo pão [molho, alface], base pão [carne, queijo]; o lanche só se conclui
depois do embrulho". As duas metades do pão no mesmo papel são UM grupo ("em sua maioria vão ser o tampo superior do
pão e o tampo inferior; ideal é considerar esses dois como 1 grupo"); "em alguns casos podem ser movidos para o lado
pelo colaborador"; "a ordem e o fluxo é da esquerda para a direita"; o embrulhado vai para o lado direito da cena, "onde
vão ser embalados ou colocados para consumo local". A caixa de isopor faz o papel do papel: o lanche é montado dentro
dela, e ela fecha.

A regra do pão (`treino_lanches.Seguidor`) termina o lanche quando o pão some do detector por `sumiu_s` — e o pão
some debaixo da carne, do queijo e da alface muito antes do embrulho. Medido na noite de 18/10 (21h04–21h14, 8
lanches contados à mão, de 10 em 10 s): ela terminava os lanches até 52 s ANTES do embrulho. Esta leitura segue o
LUGAR:

1. **A bancada vazia** (`BancadaVazia`): a bancada (abaixo das cubas) cortada em faixas verticais; cada faixa guarda
   até `estados` aparências vazias, porque o vazio muda — a bandeja do consumo local entra e sai do lado direito, um
   pacote fica parado ali. Um ponto está OCUPADO se difere de TODAS as aparências da faixa dele. A faixa só aprende
   quando está livre: nenhum lugar vivo a cobre, nenhum pão nela há `parado_s`, e quieta há `quieto_s`. (Medido: com
   um quadro só de bancada vazia, o lanche montado onde estava a bandeja nunca terminava — a bandeja saiu 4 s antes
   do papel chegar.)
2. **O lugar nasce do pão** — do grupo de metades do detector (`treino_lanches.lanches_do_quadro`) que está em cima de
   algo NOVO na bancada (o papel, a caixa): o que o detector acha no que já é da bancada vazia não é pão (os copos bege
   da borda, vistos de cima, ele acha que são). O lugar tem a largura do papel; vai até a metade do caminho para o
   vizinho vivo (a caixa é mais estreita que o papel, e elas ficam lado a lado).
3. **O fim é o embrulho**: o papel dobrado (ou a caixa fechada e levada) deixa a faixa do lugar quase vazia — o pacote
   ocupa pouco dela. O lanche termina quando a ocupação da faixa fica abaixo do limite por `fim_s` segundos seguidos; o
   limite é a metade da ocupação típica DO PRÓPRIO lugar (um papel pequeno também termina); a hora do fim é a do
   primeiro quadro baixo.
4. **Só é lanche** o lugar com pão em pelo menos `confirma` quadros no primeiro minuto; o resto sai na hora (e libera
   a faixa).
5. **O lanche movido** (empurrado ou levado aberto para o lado): quando um lanche cheio esvazia de uma vez e, no mesmo
   segundo, nasce um lugar com a faixa enchendo de uma vez e com a MESMA cara (as cores do miolo, como o puxão da
   regra do pão, `MESMA_CARA_LONGE`), é ele — a soma continua. Rígido de propósito: ligar errado some com um lanche e
   mistura duas somas; não ligar só deixa o movido em dois.
6. **A rede**: o lugar parado (nada mexe na faixa) e sem pão há `rede_s` termina no último movimento; e nada vive mais
   que `vida_max_s`.

Medido (19/10, a leitura de cada quadro guardado da noite de 18/10, contra a régua contada à mão): 21h04–21h14, 8 de 8
lanches, 1 a mais (o pão do lanche seguinte, deixado 18 s direto no inox antes do papel: as metades empilhadas enchem
a região do grupo, e a regra "em cima de algo novo" passa), o fim a 8 s do embrulho na mediana (o maior, 25 s DEPOIS;
nenhum antes); 00h00–00h10 (caixas de isopor e papel), 14 de 15 (a caixa que o detector nunca viu com pão não tem
como), 3 a mais (2 dos movidos que não ligaram, 1 lanche com as metades lado a lado no papel), o fim a 8 s na mediana.
A regra do pão, na mesma janela, juntou 3 lanches em 1 e 2 em 1, e terminou as caixas até 50 s antes de fecharem.

**O que é da loja** vem do perfil da bancada (`PerfilDaBancada`): a largura do papel sai do tamanho do pão
(`PAPEL_EM_PAES` pães). O resto é da conta e fica em `Parametros`.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any

import cv2
import numpy as np

from farol_agent.treino_lanches import PerfilDaBancada, aparencia

# A faixa de cima do recorte não é bancada: é a frente das cubas e das bandejas de carne (o que muda ali é a cuba, não
# o lanche). Medido na loja piloto: a frente das cubas termina a 1/4 da altura do recorte.
TOPO_DA_BANCADA = 0.25
# A conta é feita em meia resolução: a ocupação é de área, e o detalhe não ajuda.
ESCALA = 2
# A diferença de cor (Lab) a partir da qual o ponto não é a bancada vazia — o papel, o pão, a mão, o pacote passam com
# folga; a compressão e o tremor da luz, não.
DELTA = 20.0
# A largura do papel em diâmetros do pão: na loja piloto, o papel tem ~480 px e o pão 100–260 px (média 180).
PAPEL_EM_PAES = 2.65


@dataclass
class Parametros:
    """A conta da leitura pelo lugar (medida na noite de 18/10 da loja piloto; ver o cabeçalho do módulo)."""

    # Os vizinhos: o grupo de pão cai no lugar vivo de centro mais perto, até `raio_em_papel` da largura do papel.
    raio_em_papel: float = 0.4
    # O fim: a ocupação abaixo do limite por tantos segundos; o limite nunca abaixo de `vazio_min`.
    fim_s: int = 3
    vazio_min: float = 0.12
    # A rede: parado e sem pão por tanto tempo; e o teto de vida.
    rede_s: int = 45
    vida_max_s: int = 480
    # Só é lanche com pão em tantos quadros no primeiro `confirma_em_s`.
    confirma: int = 5
    confirma_em_s: int = 60
    # O movido: o fim só é entregue depois disto (ele ainda pode voltar); a queda de uma vez; a faixa nova que enche de
    # uma vez; a mesma cara.
    move_s: int = 10
    queda: float = 0.35
    salto: float = 0.15
    mesma_cara: float = 0.9
    # O pão em cima de algo novo: a fração da região do grupo que não é bancada vazia.
    sobre_novo: float = 0.5
    # A bancada vazia: a largura de cada faixa (em meia resolução), quantas aparências guarda, e quando aprende.
    faixa_px: int = 16
    estados: int = 3
    parado_s: int = 60
    quieto_s: int = 30
    mexe_max: float = 0.01
    novo_max: float = 0.05
    aprende_a_cada_s: int = 30


def bancada_lab(img: np.ndarray) -> np.ndarray:
    """A bancada (abaixo das cubas) em Lab, em meia resolução, com um borrão leve (o ruído da compressão)."""
    corpo = img[int(TOPO_DA_BANCADA * img.shape[0]):]
    corpo = cv2.resize(corpo, None, fx=1 / ESCALA, fy=1 / ESCALA, interpolation=cv2.INTER_AREA)
    return cv2.cvtColor(cv2.GaussianBlur(corpo, (3, 3), 0), cv2.COLOR_BGR2LAB).astype(np.float32)


def difere(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    return np.sqrt(((a - b) ** 2).sum(axis=-1)) > DELTA


class BancadaVazia:
    """As aparências da bancada vazia, faixa por faixa (ver o cabeçalho do módulo)."""

    def __init__(self, lab: np.ndarray, p: Parametros):
        self.p = p
        self.w = lab.shape[1]
        self.n_faixas = (self.w + p.faixa_px - 1) // p.faixa_px
        self.estados = np.repeat(lab[None], p.estados, axis=0)
        self.valido = np.zeros((p.estados, self.n_faixas), bool)
        self.valido[0] = True
        self.usado = np.zeros((p.estados, self.n_faixas))
        self.quieto_desde: list[datetime | None] = [None] * self.n_faixas
        self.pao_em: list[datetime | None] = [None] * self.n_faixas
        self.aprendeu_em: list[datetime | None] = [None] * self.n_faixas
        self.anterior = lab
        self.aprendidas = 0

    def faixas(self, x0: float, x1: float) -> range:
        """As faixas que cobrem [x0, x1) — x no recorte inteiro."""
        fp = self.p.faixa_px
        return range(max(0, int(x0 / ESCALA) // fp), min(self.n_faixas, int(x1 / ESCALA) // fp + 1))

    def semear(self, lab: np.ndarray, x0: float = 0, x1: float | None = None) -> None:
        """Mais uma aparência vazia, nas faixas de [x0, x1) (a releitura de uma noite começa por quadros escolhidos)."""
        for f in self.faixas(x0, self.w * ESCALA if x1 is None else x1):
            k = next((j for j in range(self.p.estados) if not self.valido[j, f]), self.p.estados - 1)
            sl = slice(f * self.p.faixa_px, (f + 1) * self.p.faixa_px)
            self.estados[k][:, sl] = lab[:, sl]
            self.valido[k, f] = True

    def ocupado(self, lab: np.ndarray) -> np.ndarray:
        """1 onde o ponto difere de todas as aparências vazias da faixa dele."""
        occ = np.ones(lab.shape[:2], bool)
        for k in range(self.p.estados):
            col_valida = np.repeat(self.valido[k], self.p.faixa_px)[: self.w]
            occ &= difere(lab, self.estados[k]) | ~col_valida[None, :]
        return cv2.morphologyEx(occ.astype(np.uint8), cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))

    def movimento(self, lab: np.ndarray) -> np.ndarray:
        """A fração de cada coluna que mudou desde o quadro anterior."""
        m = difere(lab, self.anterior).mean(axis=0)
        self.anterior = lab
        return m

    def aprender(self, lab: np.ndarray, agora: datetime, mexeu_col: np.ndarray, pao_xs: list[float], cobertas: set[int]) -> None:
        """A faixa livre, sem pão e quieta guarda a aparência de agora como vazia: refresca a que bate (a luz que muda
        devagar) ou entra no lugar da mais antiga."""
        p = self.p
        for x in pao_xs:
            self.pao_em[min(self.n_faixas - 1, max(0, int(x / ESCALA) // p.faixa_px))] = agora
        for f in range(self.n_faixas):
            sl = slice(f * p.faixa_px, (f + 1) * p.faixa_px)
            quieta = float(mexeu_col[sl].mean()) < p.mexe_max
            self.quieto_desde[f] = (self.quieto_desde[f] or agora) if quieta else None
            if f in cobertas or not quieta or (agora - self.quieto_desde[f]).total_seconds() < p.quieto_s:
                continue
            if self.pao_em[f] and (agora - self.pao_em[f]).total_seconds() < p.parado_s:
                continue
            if self.aprendeu_em[f] and (agora - self.aprendeu_em[f]).total_seconds() < p.aprende_a_cada_s:
                continue
            pedaco = lab[:, sl]
            fracs = [float(difere(pedaco, self.estados[k][:, sl]).mean()) if self.valido[k, f] else 2.0
                     for k in range(p.estados)]
            k = int(np.argmin(fracs))
            if fracs[k] <= p.novo_max:
                self.estados[k][:, sl] = 0.8 * self.estados[k][:, sl] + 0.2 * pedaco
            else:
                k = next((j for j in range(p.estados) if not self.valido[j, f]), int(np.argmin(self.usado[:, f])))
                self.estados[k][:, sl] = pedaco
                self.valido[k, f] = True
                self.aprendidas += 1
            self.usado[k, f] = agora.timestamp()
            self.aprendeu_em[f] = agora


@dataclass
class Lugar:
    """Um lanche no lugar dele (o papel, a caixa)."""

    n: int
    cx: float
    inicio: datetime
    fim: datetime | None = None
    # embrulho | parado | teto | não confirmou | encerrado
    porque: str = ""
    com_pao: int = 0
    pao_no_comeco: int = 0
    baixos: int = 0
    historia: list[float] = field(default_factory=list)
    ultimo_pao: datetime | None = None
    ultimo_mov: datetime | None = None
    x0: float = 0.0
    x1: float = 0.0
    nasceu_cx: float = 0.0
    # (a hora, de onde, para onde) de cada vez que foi movido
    movido: list[tuple[datetime, int, int]] = field(default_factory=list)
    queda: float = 0.0
    cheio_antes: bool = False
    cara: Any = None
    primeira_cara: Any = None

    @property
    def duracao_s(self) -> float:
        return ((self.fim or self.inicio) - self.inicio).total_seconds()


def _media_em(perfil: np.ndarray, x0: float, x1: float) -> float:
    a, b = int(max(0, x0)) // ESCALA, int(x1) // ESCALA
    return float(perfil[a:b].mean()) if b > a else 0.0


class LeitorDeLugares:
    """Os lanches pelo lugar, quadro a quadro (um por segundo). Sem arquivo nem rede: quem chama dá o recorte, a hora e
    os grupos de pão (`treino_lanches.lanches_do_quadro`) e recebe os lugares que terminaram de vez."""

    def __init__(self, perfil: PerfilDaBancada, p: Parametros | None = None):
        self.p = p or Parametros()
        self.meio_pao = (perfil.pao_px_min + perfil.pao_px_max) / 4
        self.papel_w = PAPEL_EM_PAES * 2 * self.meio_pao
        self.raio = self.p.raio_em_papel * self.papel_w
        self.bancada: BancadaVazia | None = None
        self.ativos: list[Lugar] = []
        self.recentes: list[Lugar] = []
        self._perfis: list[tuple[datetime, np.ndarray]] = []
        self._contador = 0

    def semear(self, img: np.ndarray, x0: float = 0, x1: float | None = None) -> None:
        """A bancada vazia de partida (sem isto, é o primeiro quadro): o recorte inteiro, ou só as faixas de [x0, x1)."""
        lab = bancada_lab(img)
        if self.bancada is None:
            self.bancada = BancadaVazia(lab, self.p)
            if x0 > 0 or x1 is not None:
                self.bancada.valido[0] = False
                self.bancada.semear(lab, x0, x1)
        else:
            self.bancada.semear(lab, x0, x1)

    def e_lanche(self, l: Lugar) -> bool:
        return l.com_pao >= self.p.confirma

    def lanches_na_bancada(self) -> int:
        return sum(1 for l in self.ativos if self.e_lanche(l))

    def quadro(self, img: np.ndarray, agora: datetime, grupos: list[tuple]) -> list[Lugar]:
        """Um quadro (o recorte), a hora dele e os grupos de pão (x0, y0, x1, y1, ...) no recorte. Devolve os lugares
        que terminaram de vez — o fim há mais de `move_s` (um movido ainda podia voltar) — lanches ou não."""
        p = self.p
        h, w = img.shape[:2]
        topo = int(TOPO_DA_BANCADA * h)
        lab = bancada_lab(img)
        if self.bancada is None:
            self.bancada = BancadaVazia(lab, p)  # o primeiro quadro é a bancada vazia de partida
        ocupado = self.bancada.ocupado(lab)
        perfil = ocupado.mean(axis=0)
        self._perfis = (self._perfis + [(agora, perfil)])[-8:]
        mexeu = self.bancada.movimento(lab)

        def novo(caixa) -> bool:
            a, b = int(max(0.0, caixa[0])) // ESCALA, int(max(0.0, caixa[2])) // ESCALA
            c, d = int(max(0.0, caixa[1] - topo)) // ESCALA, int(max(0.0, caixa[3] - topo)) // ESCALA
            janela = ocupado[c:d, a:b]
            return janela.size > 0 and float(janela.mean()) >= p.sobre_novo

        def sobre_novo(g) -> bool:
            """O pão em cima do papel (ou na caixa): a região do grupo, com a folga em volta das metades, é quase toda
            algo novo na bancada — e alguma metade é ela mesma nova (o que o detector acha no que já é da bancada vazia
            não é pão)."""
            metades = g[5] if len(g) > 5 and g[5] else (g,)
            return novo(g) and any(novo(m) for m in metades)

        def inteiro(g) -> bool:
            """O pão com o centro a menos de meio pão da borda do recorte está cortado por ela (na loja piloto, os copos
            bege da borda esquerda, vistos de cima, parecem pão ao detector)."""
            cx = (g[0] + g[2]) / 2
            return self.meio_pao <= cx <= w - self.meio_pao

        # todo pão que o detector acha conta para a bancada vazia não aprender ali (mesmo o que não vira lugar)
        pao_xs = [(g[0] + g[2]) / 2 for g in grupos]
        grupos = [g for g in grupos if (g[1] + g[3]) / 2 > topo and inteiro(g) and sobre_novo(g)]
        for g in grupos:
            cx = (g[0] + g[2]) / 2
            cara = aparencia(img, g)
            perto = min(self.ativos, key=lambda l: abs(l.cx - cx), default=None)
            if perto is not None and abs(perto.cx - cx) <= self.raio:
                perto.cx = 0.8 * perto.cx + 0.2 * cx
            else:
                perto = self._renascer(cx, cara, agora) or self._nascer(cx, agora)
            perto.cara = cara
            if perto.primeira_cara is None:
                perto.primeira_cara = cara
            perto.com_pao += 1
            perto.ultimo_pao = agora
            if (agora - perto.inicio).total_seconds() <= p.confirma_em_s:
                perto.pao_no_comeco += 1
        self._repartir(w)
        for l in list(self.ativos):
            if l in self.ativos:  # pode ter sido juntado a um movido neste mesmo quadro
                self._medir(l, perfil, mexeu, agora)
        cobertas: set[int] = set()
        for l in self.ativos:
            cobertas.update(self.bancada.faixas(l.x0, l.x1))
        self.bancada.aprender(lab, agora, mexeu, pao_xs, cobertas)
        prontos = [r for r in self.recentes if (agora - r.fim).total_seconds() > p.move_s]
        self.recentes = [r for r in self.recentes if r not in prontos]
        return prontos

    def encerrar(self, agora: datetime) -> list[Lugar]:
        """O fim da leitura: os que esperavam a volta do movido saem como estão; os vivos terminam agora, "encerrado"."""
        for l in self.ativos:
            l.fim, l.porque = agora, "encerrado"
        fim = self.recentes + self.ativos
        self.ativos, self.recentes = [], []
        return fim

    # ───────────────────────────── por dentro ─────────────────────────────

    def _nascer(self, cx: float, agora: datetime) -> Lugar:
        self._contador += 1
        l = Lugar(self._contador, cx, agora, ultimo_pao=agora, ultimo_mov=agora, nasceu_cx=cx)
        self.ativos.append(l)
        return l

    def _encheu(self, cx: float, quando: datetime) -> bool:
        """A faixa em volta de `cx` encheu de uma vez num segundo a até 2 s de `quando`?"""
        a, b = cx - self.papel_w / 4, cx + self.papel_w / 4
        return any(_media_em(p1, a, b) - _media_em(p0, a, b) >= self.p.salto and abs((q - quando).total_seconds()) <= 2
                   for (q, p1), (_, p0) in zip(self._perfis[1:], self._perfis[:-1]))

    def _mesma_cara(self, a, b) -> bool:
        return a is not None and b is not None and cv2.compareHist(a, b, cv2.HISTCMP_CORREL) >= self.p.mesma_cara

    def _pode_ter_movido(self, l: Lugar) -> bool:
        return self.e_lanche(l) and l.cheio_antes and l.queda >= self.p.queda

    def _renascer(self, cx: float, cara, agora: datetime) -> Lugar | None:
        """O pão apareceu longe de todo lugar vivo pouco DEPOIS de um lanche esvaziar de uma vez, com a mesma cara e a
        faixa nova enchendo de uma vez no mesmo segundo: é ele, movido."""
        cands = [r for r in self.recentes if r.porque == "embrulho" and (agora - r.fim).total_seconds() <= self.p.move_s
                 and self._pode_ter_movido(r) and self._encheu(cx, r.fim) and self._mesma_cara(r.cara, cara)]
        if not cands:
            return None
        r = max(cands, key=lambda r: r.fim)
        self.recentes.remove(r)
        r.movido.append((r.fim, int(r.cx), int(cx)))
        r.cx, r.fim, r.porque, r.baixos = cx, None, "", 0
        r.historia = r.historia[-30:]
        self.ativos.append(r)
        return r

    def _repartir(self, w: int) -> None:
        """A faixa de cada lugar: até a metade do caminho para o vizinho vivo, nunca além de meio papel."""
        self.ativos.sort(key=lambda l: l.cx)
        meia = self.papel_w / 2
        for i, l in enumerate(self.ativos):
            esq = (self.ativos[i - 1].cx + l.cx) / 2 if i > 0 else -1e9
            dir_ = (self.ativos[i + 1].cx + l.cx) / 2 if i + 1 < len(self.ativos) else 1e9
            l.x0, l.x1 = max(0.0, l.cx - meia, esq), min(float(w), l.cx + meia, dir_)

    def _medir(self, l: Lugar, perfil: np.ndarray, mexeu: np.ndarray, agora: datetime) -> None:
        p = self.p
        f = _media_em(perfil, l.x0, l.x1)
        if _media_em(mexeu, l.x0, l.x1) >= p.mexe_max:
            l.ultimo_mov = agora
        l.historia.append(f)
        tipico = float(np.percentile(l.historia, 80))
        limite = max(p.vazio_min, 0.5 * tipico)
        l.baixos = l.baixos + 1 if f < limite else 0
        parado = min((agora - l.ultimo_mov).total_seconds(), (agora - l.ultimo_pao).total_seconds())
        if not self.e_lanche(l) and (agora - l.inicio).total_seconds() >= p.confirma_em_s:
            l.fim, l.porque = agora, "não confirmou"
        elif l.baixos >= p.fim_s:
            antes = l.historia[-p.fim_s - 5:-p.fim_s] or [f]
            l.queda = max(antes) - l.historia[-p.fim_s]
            l.cheio_antes = max(antes) >= 0.8 * tipico
            l.fim, l.porque = agora - timedelta(seconds=p.fim_s - 1), "embrulho"  # o primeiro quadro baixo
            if self._pode_ter_movido(l) and self._juntar_o_movido(l):
                return
        elif parado >= p.rede_s:
            l.fim, l.porque = max(l.ultimo_mov, l.ultimo_pao), "parado"
        elif (agora - l.inicio).total_seconds() >= p.vida_max_s:
            l.fim, l.porque = agora, "teto"
        if l.fim:
            self.ativos.remove(l)
            self.recentes.append(l)

    def _juntar_o_movido(self, l: Lugar) -> bool:
        """O movido visto do fim: nasceu, no mesmo segundo em que `l` esvaziou, um lugar com a faixa enchendo de uma
        vez e com a mesma cara — é `l`, que mudou de lugar. Ele segue lá, com a soma de antes."""
        novos = [n for n in self.ativos if n is not l and abs((n.inicio - l.fim).total_seconds()) <= 3
                 and self._encheu(n.cx, l.fim) and self._mesma_cara(l.cara, n.primeira_cara)]
        if not novos:
            return False
        n = min(novos, key=lambda n: abs((n.inicio - l.fim).total_seconds()))
        l.movido.append((l.fim, int(l.cx), int(n.cx)))
        l.cx, l.com_pao = n.cx, l.com_pao + n.com_pao
        l.ultimo_pao = max(l.ultimo_pao, n.ultimo_pao)
        l.cara = n.cara
        l.historia = l.historia[:-self.p.fim_s][-30:] + n.historia
        l.fim, l.porque, l.baixos = None, "", 0
        self.ativos.remove(n)
        return True
