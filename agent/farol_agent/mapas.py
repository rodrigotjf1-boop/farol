"""O mapa do canal — a imagem fixa que situa o recorte.

Quando um critério vale só num quadro, o que sai da loja é o recorte dele.
Sozinho, o recorte não diz onde está: uma tira de inox pode ser bancada,
pia ou tampa de freezer. O mapa é a câmera inteira, pequena, com os quadros
contornados e numerados — vai antes do recorte, em todo pedido daquele
canal, e por ser sempre o MESMO arquivo é lido do cache do modelo.

## O mapa é a foto do LUGAR, não de quem está nele

O recorte de um quadro mostra só o que foi marcado. O mapa mostra a câmera
inteira — então ele só é fotografia quando a câmera está vendo o lugar
vazio. A regra, em ordem:

1. **Esquema primeiro.** Assim que o canal tem quadro, existe um mapa: o
   desenho dos quadros sobre um fundo liso, no enquadramento da câmera. Não
   tem um ponto sequer da imagem. Nenhum critério espera por fotografia.
2. **Fotografia quando não há ninguém.** O detector de pessoas da loja olha
   o quadro inteiro; sem ninguém — nem um "talvez" —, o mapa passa a ser a
   fotografia. Sem detector instalado não há como saber, e o mapa fica no
   esquema.
3. **Melhora devagar.** Com a fotografia feita, tenta-se outra no máximo uma
   vez por hora, e só troca se o lugar estiver vazio E a nova for claramente
   mais clara (a primeira costuma sair de madrugada, com a luz apagada) — ou
   se a atual tiver mais de uma semana. Trocar o arquivo joga fora o cache.

Não é garantia de que ninguém aparece: o detector erra. É a mesma medida
que o porteiro usa, do lado conservador (um "talvez" já segura).
"""

from __future__ import annotations

import logging
import os
import re
from datetime import datetime, timedelta
from pathlib import Path
from typing import Callable

import cv2
import numpy as np

from farol_agent import imagens
from farol_agent.contexto import Cena, Quadro
from farol_agent.modelos import Frame
from farol_agent.pipeline import qualidade, recorte

_log = logging.getLogger(__name__)

# O lado maior do mapa. 640×360 são ≈ 300 unidades de imagem: em cache, é
# quase nada por pedido — e basta para ver onde cada quadro fica.
LADO_DO_MAPA = 640
QUALIDADE_DO_MAPA = 80

# Com a fotografia feita, de quanto em quanto tempo se tenta uma melhor.
TENTAR_MELHORAR_A_CADA = timedelta(hours=1)
# A nova só entra se for pelo menos isto mais clara que a atual…
MAIS_CLARA = 1.15
# …ou se a atual passou desta idade (o lugar muda: equipamento novo, reforma).
RENOVAR_APOS = timedelta(days=7)

COR_DO_FUNDO = recorte.COR_DE_FORA      # o mesmo cinza do que fica fora da área
COR_DO_MIOLO = (150, 150, 150)          # o quadro, no esquema
COR_DO_CONTORNO = (0, 215, 255)         # amarelo (BGR): lê-se sobre inox, piso e sombra
COR_DA_SOMBRA = (0, 0, 0)

ESQUEMA = "esquema"
FOTO = "foto"


def desenhar(base: np.ndarray | None, tamanho: tuple[int, int], quadros: tuple[Quadro, ...]) -> np.ndarray:
    """O mapa: a `base` reduzida (ou um fundo liso) com os quadros contornados e numerados.

    `tamanho` é (largura, altura) do quadro da câmera — é o que dá o
    enquadramento ao esquema, que não usa a imagem.
    """
    largura, altura = max(1, int(tamanho[0])), max(1, int(tamanho[1]))
    escala = min(1.0, LADO_DO_MAPA / max(largura, altura))
    w, h = max(1, round(largura * escala)), max(1, round(altura * escala))

    if base is None:
        mapa = np.full((h, w, 3), COR_DO_FUNDO, dtype=np.uint8)
    else:
        mapa = base if base.ndim == 3 else cv2.cvtColor(base, cv2.COLOR_GRAY2BGR)
        mapa = cv2.resize(mapa, (w, h), interpolation=cv2.INTER_AREA)

    contornos = [
        np.array([[round(x * (w - 1)), round(y * (h - 1))] for x, y in q.poligono], dtype=np.int32)
        for q in quadros
    ]
    if base is None:
        for pontos in contornos:
            cv2.fillPoly(mapa, [pontos], COR_DO_MIOLO)
    for pontos in contornos:
        # A sombra por baixo é o que faz o amarelo aparecer também sobre o claro.
        cv2.polylines(mapa, [pontos], True, COR_DA_SOMBRA, 4, cv2.LINE_AA)
        cv2.polylines(mapa, [pontos], True, COR_DO_CONTORNO, 2, cv2.LINE_AA)
    # Os números por cima de tudo: quadro que se sobrepõe a outro não esconde o número dele.
    for q, pontos in zip(quadros, contornos):
        raio = 11
        cx = int(min(max(int(pontos[:, 0].min()) + raio + 3, raio + 1), w - raio - 2))
        cy = int(min(max(int(pontos[:, 1].min()) + raio + 3, raio + 1), h - raio - 2))
        cv2.circle(mapa, (cx, cy), raio, COR_DA_SOMBRA, -1, cv2.LINE_AA)
        cv2.circle(mapa, (cx, cy), raio, COR_DO_CONTORNO, 1, cv2.LINE_AA)
        texto = str(q.numero)
        (tw, th), _ = cv2.getTextSize(texto, cv2.FONT_HERSHEY_SIMPLEX, 0.5, 1)
        cv2.putText(
            mapa, texto, (cx - tw // 2, cy + th // 2),
            cv2.FONT_HERSHEY_SIMPLEX, 0.5, COR_DO_CONTORNO, 1, cv2.LINE_AA,
        )
    return mapa


def _claridade(imagem: np.ndarray) -> float:
    cinza = cv2.cvtColor(imagem, cv2.COLOR_BGR2GRAY) if imagem.ndim == 3 else imagem
    return float(cinza.mean())


def _seguro(texto: str) -> str:
    """Um pedaço de nome de arquivo: o id do canal é um uuid, mas não se confia nisso."""
    return re.sub(r"[^A-Za-z0-9-]", "-", str(texto))[:64] or "canal"


class Mapas:
    """Os mapas dos canais, em disco, ao lado da fila."""

    def __init__(
        self,
        pasta: str | Path,
        *,
        sem_gente: Callable[[np.ndarray], bool | None] | None = None,
    ) -> None:
        self.pasta = Path(pasta)
        # Quem diz se o quadro da câmera está sem ninguém: `True` (ninguém),
        # `False` (há alguém, ou pode haver) ou `None` (não deu para saber).
        # Sem ele, o mapa nunca é fotografia.
        self.sem_gente = sem_gente
        # Por canal, quando se tenta de novo uma fotografia melhor.
        self._proxima_tentativa: dict[str, datetime] = {}

    # ───────────────────────── onde fica ─────────────────────────

    def _caminho(self, ponto_id: str, cena: Cena, tipo: str) -> Path:
        return self.pasta / f"{_seguro(ponto_id)}_{cena.desenho()}_{tipo}.jpg"

    def arquivo(self, ponto_id: str, cena: Cena) -> Path | None:
        """O mapa que vale agora para este canal: a fotografia, o esquema — ou nada."""
        if not cena.quadros:
            return None
        for tipo in (FOTO, ESQUEMA):
            caminho = self._caminho(ponto_id, cena, tipo)
            if caminho.is_file():
                return caminho
        return None

    @staticmethod
    def e_esquema(caminho: Path) -> bool:
        return caminho.stem.endswith(f"_{ESQUEMA}")

    # ───────────────────────── fazer e melhorar ─────────────────────────

    def cuidar(self, ponto_id: str, cena: Cena, quadro: Frame, agora: datetime) -> Path | None:
        """Garante o mapa deste canal e, quando dá, melhora-o. Chamado a cada olhada.

        `quadro` é o quadro INTEIRO da câmera, como ela entrega. Devolve o
        mapa que vale depois da chamada. Erro de disco sobe: sem mapa, o
        critério de quadro não pode perguntar.
        """
        if not cena.quadros:
            return None
        esquema = self._caminho(ponto_id, cena, ESQUEMA)
        foto = self._caminho(ponto_id, cena, FOTO)
        tem_foto = foto.is_file()
        if not tem_foto and not esquema.is_file():
            self._gravar(esquema, desenhar(None, (quadro.largura, quadro.altura), cena.quadros))
            _log.info("mapa do canal %s desenhado (esquema, %d quadro(s))", ponto_id, len(cena.quadros))

        if self.sem_gente is None:
            return foto if tem_foto else esquema
        if tem_foto:
            proxima = self._proxima_tentativa.get(ponto_id)
            if proxima is not None and agora < proxima:
                return foto
            self._proxima_tentativa[ponto_id] = agora + TENTAR_MELHORAR_A_CADA

        if not self._serve_de_fotografia(quadro, foto if tem_foto else None, agora):
            return foto if tem_foto else esquema

        # O rosto que o detector de pessoas não viu ainda passa pelo de rosto.
        limpo, _ = recorte.borrar_rostos(quadro)
        self._gravar(foto, desenhar(limpo.imagem, (quadro.largura, quadro.altura), cena.quadros))
        self._proxima_tentativa[ponto_id] = agora + TENTAR_MELHORAR_A_CADA
        _log.info("mapa do canal %s %s com o lugar vazio", ponto_id, "refeito" if tem_foto else "fotografado")
        return foto

    def _serve_de_fotografia(self, quadro: Frame, atual: Path | None, agora: datetime) -> bool:
        """Este quadro pode virar o mapa? Só com cena de verdade e sem ninguém."""
        utilizavel, _ = qualidade.cena_utilizavel(quadro.imagem)
        if not utilizavel:
            return False
        try:
            vazio = self.sem_gente(quadro.imagem) if self.sem_gente else None
        except Exception as e:  # noqa: BLE001
            # Detector que falhou não autoriza fotografia nenhuma.
            _log.warning("não deu para conferir se o canal está vazio (%s): o mapa fica como está", e)
            return False
        if vazio is not True:
            return False
        if atual is None:
            return True
        try:
            idade = agora - datetime.fromtimestamp(atual.stat().st_mtime)
        except OSError:
            return True
        if idade > RENOVAR_APOS:
            return True
        guardada = imagens.ler(atual)
        if guardada is None:
            return True
        return _claridade(quadro.imagem) >= _claridade(guardada) * MAIS_CLARA

    @staticmethod
    def _gravar(destino: Path, mapa: np.ndarray) -> None:
        """Grava ao lado e troca: quem está lendo o mapa nunca pega um arquivo pela metade."""
        destino.parent.mkdir(parents=True, exist_ok=True)
        novo = destino.with_name(destino.stem + ".novo.jpg")
        if not imagens.escrever(novo, mapa, [cv2.IMWRITE_JPEG_QUALITY, QUALIDADE_DO_MAPA]):
            raise OSError(f"não consegui gravar o mapa do canal em {destino}")
        os.replace(novo, destino)

    # ───────────────────────── o que sobra ─────────────────────────

    def largar(self, cenas: dict[str, Cena]) -> None:
        """Apaga os mapas de canal, ou de desenho de quadros, que não existem mais.

        Chamado a cada montagem: quadro redesenhado troca o nome do mapa, e
        o antigo não pode ficar em disco para sempre.
        """
        if not self.pasta.is_dir():
            return
        vivos = {
            self._caminho(ponto_id, cena, tipo).name
            for ponto_id, cena in cenas.items()
            if cena.quadros
            for tipo in (FOTO, ESQUEMA)
        }
        for arq in self.pasta.glob("*.jpg"):
            if arq.name in vivos:
                continue
            try:
                arq.unlink()
            except OSError as e:
                _log.warning("não apaguei o mapa %s: %s", arq.name, e)
        self._proxima_tentativa = {p: t for p, t in self._proxima_tentativa.items() if p in cenas}
