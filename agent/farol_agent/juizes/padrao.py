"""O juiz da foto padrão — igual ao que deve ser é conforme, de graça.

Compara o recorte de agora com o mesmo recorte da foto padrão do canal
(`comparar.py`). Duas respostas, e só duas saem daqui sem perguntar a
ninguém:

    igual à foto padrão        → conforme (custo zero)
    canal sem foto para comparar → não deu para avaliar, dizendo por quê

**Diferente não é irregular.** Cena diferente da foto padrão pode ser sujeira
— ou uma caixa de insumo nova, ou a luz da tarde. A loja não acusa: passa a
pergunta a quem sabe julgar (o juiz da nuvem, quando a loja usa a nuvem), com
a foto padrão ao lado. Sem ter a quem passar, a resposta honesta é "não deu
para avaliar".

A semelhança medida vai no veredito (`medida`), nos dois casos: é dela que
sai, depois, "este critério nunca dá igual à foto padrão" — sinal de foto
velha, ou de área com algo que muda sozinho.

O mesmo juiz serve aos critérios de estado e de ação que pedem "mandar a foto
padrão junto": aí ele só escolhe a foto mais parecida e entrega o recorte
dela (`referencia_para`). Quem julga é a nuvem.
"""

from __future__ import annotations

import hashlib
import logging
import time
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

import cv2
import numpy as np

from farol_agent import comparar, imagens
from farol_agent.juizes.base import ErroDoJuiz, Juiz
from farol_agent.modelos import Frame, Regra, Resultado, Veredito, Via, Zona
from farol_agent.padroes import PadraoRef, Padroes
from farol_agent.pipeline import recorte

_log = logging.getLogger(__name__)

Retangulo = tuple[float, float, float, float]


@dataclass(frozen=True)
class Achado:
    """A foto padrão mais parecida com a cena de agora, já recortada na área."""

    ref: PadraoRef
    # O recorte da foto, com o que é de fora apagado — como o de agora.
    imagem: np.ndarray
    # De 0 a 1; `None` quando não sobrou bloco para comparar.
    semelhanca: float | None


class JuizDoPadrao:
    nome = "padrao"

    def __init__(
        self,
        padroes: Padroes,
        zonas: dict[str, Zona],
        *,
        relogios: dict[str, Retangulo] | None = None,
        escalar_para: Juiz | None = None,
        pasta: str | Path | None = None,
        limiar: float = comparar.LIMIAR_IGUAL,
    ) -> None:
        self.padroes = padroes
        self.zonas = zonas
        # Por canal, onde o gravador escreve o relógio (fração do quadro).
        self.relogios = relogios or {}
        self.escalar_para = escalar_para
        self.pasta = Path(pasta) if pasta else padroes.recortes
        self.limiar = limiar
        self._largar_recortes_sem_area()

    def _largar_recortes_sem_area(self) -> None:
        """Apaga os recortes de área que não existe mais.

        O juiz é montado de novo a cada configuração: é a hora de tirar do
        disco o que era de uma área excluída. (Os de foto excluída saem com
        ela, em `Padroes`.)
        """
        if not self.pasta.is_dir():
            return
        for arq in self.pasta.glob("*.jpg"):
            partes = arq.stem.split("_")
            if len(partes) == 3 and partes[1] in self.zonas:
                continue
            try:
                arq.unlink()
            except OSError as e:
                _log.warning("não apaguei o recorte %s: %s", arq.name, e)

    # ───────────────────────── na montagem ─────────────────────────

    def atende(self, regra: Regra) -> None:
        """O canal desta regra tem com o que comparar? Erro dizendo o que falta.

        Perguntado na MONTAGEM, não a cada olhada: critério de comparação em
        canal sem foto padrão não é capturado, e o console mostra o motivo.
        """
        if not self.padroes.tem(regra.zona.ponto_id):
            raise ErroDoJuiz(
                "falta a foto padrão deste canal: guarde uma em Canais → Quadro e área",
                recuperavel=False,
            )

    # ───────────────────────── a comparação ─────────────────────────

    def _relogio_no_recorte(self, zona: Zona) -> list[Retangulo]:
        r = self.relogios.get(str(zona.ponto_id))
        if r is None or not zona.poligono:
            return []
        xs = [p[0] for p in zona.poligono]
        ys = [p[1] for p in zona.poligono]
        x1, y1, x2, y2 = min(xs), min(ys), max(xs), max(ys)
        largura, altura = x2 - x1, y2 - y1
        if largura <= 0 or altura <= 0:
            return []
        ix1, iy1 = max(r[0], x1), max(r[1], y1)
        ix2, iy2 = min(r[2], x2), min(r[3], y2)
        if ix2 <= ix1 or iy2 <= iy1:
            return []
        return [((ix1 - x1) / largura, (iy1 - y1) / altura, (ix2 - x1) / largura, (iy2 - y1) / altura)]

    def mais_parecida(self, atual: np.ndarray, zona: Zona) -> Achado | None:
        """A foto padrão do canal que mais se parece com a cena de agora.

        O canal pode ter uma para cada situação de luz (dia, noite, loja
        fechada): vale a que mais se parece, não uma média — a média de
        cenas legítimas não é cena nenhuma.
        """
        melhor: Achado | None = None
        ignorar = self._relogio_no_recorte(zona)
        for ref, inteira in self.padroes.do_ponto(zona.ponto_id):
            quadro = Frame(imagem=inteira, ts=datetime.now(), ponto_id=str(zona.ponto_id or ""))
            f, dentro = recorte.recortar_area(quadro, zona)
            # Com o que é de fora apagado, como o recorte de agora: senão a
            # borda do desenho compararia cinza com cena.
            da_foto = recorte.apagar_fora(f, dentro).imagem
            s = comparar.semelhanca(atual, da_foto, dentro=dentro, ignorar=ignorar)
            achado = Achado(ref, da_foto, s)
            if melhor is None or (s if s is not None else -1.0) > (melhor.semelhanca if melhor.semelhanca is not None else -1.0):
                melhor = achado
        return melhor

    def _arquivo_do_recorte(self, achado: Achado, zona: Zona) -> Path:
        """O recorte da foto padrão em arquivo, para ir junto à nuvem.

        Um por foto e por desenho de área: o desenho entra no nome, para a
        área redesenhada não mandar o recorte antigo — que sai do disco
        quando o novo é gravado.
        """
        desenho = hashlib.sha256(repr(zona.poligono).encode("utf-8")).hexdigest()[:10]
        destino = self.pasta / f"{achado.ref.id}_{zona.id}_{desenho}.jpg"
        if not destino.is_file():
            self.pasta.mkdir(parents=True, exist_ok=True)
            for antigo in self.pasta.glob(f"{achado.ref.id}_{zona.id}_*.jpg"):
                try:
                    antigo.unlink()
                except OSError as e:
                    _log.warning("não apaguei o recorte %s: %s", antigo.name, e)
            imagens.escrever(str(destino), achado.imagem, [cv2.IMWRITE_JPEG_QUALITY, 85])
        return destino

    def referencia_para(self, imagem: Path, contexto: dict[str, Any] | None) -> tuple[Path, Achado] | None:
        """O recorte da foto padrão a mandar junto com esta imagem — ou nada."""
        zona = self.zonas.get(str((contexto or {}).get("zona_id")))
        if zona is None:
            return None
        atual = imagens.ler(str(imagem))
        if atual is None:
            return None
        achado = self.mais_parecida(atual, zona)
        if achado is None:
            return None
        return self._arquivo_do_recorte(achado, zona), achado

    # ───────────────────────── o julgamento ─────────────────────────

    def julgar(
        self,
        imagem: Path,
        criterio: str,
        *,
        contexto: dict[str, Any] | None = None,
        referencias: list[Path] | None = None,
    ) -> Veredito:
        inicio = time.monotonic()
        ctx = contexto or {}
        zona = self.zonas.get(str(ctx.get("zona_id")))
        if zona is None:
            raise ErroDoJuiz(
                f"contexto sem área utilizável ({ctx.get('zona_id')!r}): não sei com que recorte comparar",
                recuperavel=False,
            )
        atual = imagens.ler(str(imagem))
        if atual is None:
            raise ErroDoJuiz(f"não li a imagem {imagem}", recuperavel=False)

        achado = self.mais_parecida(atual, zona)
        if achado is None:
            # A configuração diz que o canal tem foto, mas nenhuma está em
            # disco ainda (não desceu): não é veredito, é espera.
            return self._nao_sei("a foto padrão deste canal ainda não chegou à loja", None, inicio)

        s = achado.semelhanca
        if s is not None and s >= self.limiar:
            return Veredito(
                resultado=Resultado.CONFORME,
                confianca=_confianca(s, self.limiar),
                motivo=f"igual à foto padrão “{achado.ref.nome}” (semelhança {_br(s)})",
                via=Via.COMPARACAO,
                modelo="foto-padrao",
                custo_centavos=0.0,
                latencia_ms=int((time.monotonic() - inicio) * 1000),
                medida=s,
            )

        porque = (
            f"diferente da foto padrão “{achado.ref.nome}” (semelhança {_br(s)})"
            if s is not None
            else f"não deu para medir a semelhança com a foto padrão “{achado.ref.nome}”"
        )
        if self.escalar_para is None:
            return self._nao_sei(f"{porque}, e a loja não tem a quem perguntar", s, inicio)
        if ctx.get("sem_cena_escrita"):
            # A loja pergunta com contexto e este canal não tem cena: o
            # recorte não sai sozinho. A comparação feita aqui continua
            # valendo — "igual" já teria sido conforme, acima.
            return self._nao_sei(f"{porque}, e falta descrever a cena deste canal para perguntar a quem sabe julgar", s, inicio)

        _log.info("comparação passou a %s: %s", self.escalar_para.nome, porque)
        v = self.escalar_para.julgar(
            imagem,
            criterio,
            contexto={**ctx, "foto_padrao": achado.ref.nome},
            referencias=[self._arquivo_do_recorte(achado, zona)],
        )
        # A semelhança que a loja mediu vai junto, seja qual for o veredito.
        v.medida = s
        return v

    def _nao_sei(self, motivo: str, s: float | None, inicio: float) -> Veredito:
        _log.info("comparação sem veredito: %s", motivo)
        return Veredito(
            resultado=Resultado.NAO_AVALIAVEL,
            confianca=None,
            motivo=motivo,
            via=Via.COMPARACAO,
            modelo="foto-padrao",
            custo_centavos=0.0,
            latencia_ms=int((time.monotonic() - inicio) * 1000),
            medida=s,
        )


def _br(s: float | None) -> str:
    return "—" if s is None else f"{s:.2f}".replace(".", ",")


def _confianca(s: float, limiar: float) -> float:
    """De 0,80 (no limiar) a 1,00 (idêntica)."""
    if limiar >= 1.0:
        return 1.0
    return round(min(1.0, 0.8 + 0.2 * (s - limiar) / (1.0 - limiar)), 3)
