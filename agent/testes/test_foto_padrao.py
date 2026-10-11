"""A foto padrão do canal: a loja compara antes de perguntar (fase 2).

O que se protege aqui:

- o comparador dá "igual" para a mesma cena (com a luz mexida, com ruído, com
  outra resolução) e "diferente" para uma mudança pequena — e só olha o que é
  da área, fora o relógio do gravador;
- as fotos descem da nuvem, são conferidas pelo resumo antes de valer, e o
  que saiu da configuração sai do disco;
- o juiz: igual é conforme e não custa; diferente NÃO é irregular — vai a
  quem sabe julgar, com a foto ao lado; sem ter a quem ir, "não deu para
  avaliar";
- o critério de estado que pede a foto leva o recorte dela à nuvem, e o
  endereço do agente (área, canal) nunca chega ao modelo.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import replace
from datetime import datetime, timedelta
from pathlib import Path

import cv2
import numpy as np
import pytest

from farol_agent import comparar, imagens, preview
from farol_agent.auditoria import NOVA_BUSCA_DE_PADROES, Auditoria
from farol_agent.configuracao import de_json
from farol_agent.dvr.dahua import ClienteDahua
from farol_agent.fila import Fila
from farol_agent.juizes import nuvem as juiz_nuvem
from farol_agent.juizes.base import ErroDoJuiz
from farol_agent.juizes.padrao import JuizDoPadrao
from farol_agent.juizes.seletor import JuizPorRegra, SeletorDeJuiz
from farol_agent.modelos import EventoGatilho, Frame, Resultado, TipoRegra, Veredito, Via, Zona
from farol_agent.motor import MotorDeRegras
from farol_agent.nuvem import ClienteNuvem
from farol_agent.padroes import PadraoRef, Padroes
from farol_agent.pipeline import recorte
from testes.conftest import BASE

from .test_auditoria import NuvemDeTeste
from .test_configuracao import resposta

LIMIAR = comparar.LIMIAR_IGUAL


# ───────────────────────────── as cenas ─────────────────────────────


def cena(largura=1280, altura=720, semente=7) -> np.ndarray:
    """Uma cozinha de mentira: fundo em degradê, bancadas, equipamentos e riscos."""
    rng = np.random.default_rng(semente)
    x = np.linspace(70, 150, largura, dtype=np.float32)
    y = np.linspace(0, 40, altura, dtype=np.float32)[:, None]
    img = np.repeat((x[None, :] + y)[:, :, None], 3, axis=2).astype(np.uint8)
    for _ in range(26):
        x1, y1 = int(rng.integers(0, largura - 80)), int(rng.integers(0, altura - 60))
        w, h = int(rng.integers(40, largura // 5)), int(rng.integers(30, altura // 4))
        cor = [int(c) for c in rng.integers(30, 225, 3)]
        cv2.rectangle(img, (x1, y1), (x1 + w, y1 + h), cor, -1)
    for _ in range(14):
        c = (int(rng.integers(0, largura)), int(rng.integers(0, altura)))
        cv2.circle(img, c, int(rng.integers(8, 40)), [int(v) for v in rng.integers(30, 225, 3)], -1)
    for _ in range(18):
        p1 = (int(rng.integers(0, largura)), int(rng.integers(0, altura)))
        p2 = (int(rng.integers(0, largura)), int(rng.integers(0, altura)))
        cv2.line(img, p1, p2, [int(v) for v in rng.integers(20, 235, 3)], 2)
    return img


def com_objeto(img: np.ndarray, x: float, y: float, parte: float) -> np.ndarray:
    """Põe um objeto (uma caixa listrada) ocupando `parte` da área, no ponto (x, y)."""
    h, w = img.shape[:2]
    lado_w, lado_h = max(4, int(w * parte ** 0.5)), max(4, int(h * parte ** 0.5))
    x1, y1 = int(x * w), int(y * h)
    saida = img.copy()
    for k in range(lado_h):
        saida[y1 + k:y1 + k + 1, x1:x1 + lado_w] = (235, 235, 235) if (k // 3) % 2 == 0 else (20, 20, 20)
    return saida


def jpeg(img: np.ndarray, qualidade=85) -> np.ndarray:
    ok, buffer = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, qualidade])
    assert ok
    return cv2.imdecode(buffer, cv2.IMREAD_COLOR)


def em_bytes(img: np.ndarray, qualidade=82) -> bytes:
    ok, buffer = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, qualidade])
    assert ok
    return buffer.tobytes()


def reduzida(img: np.ndarray, lado=640) -> np.ndarray:
    h, w = img.shape[:2]
    e = lado / max(h, w)
    return cv2.resize(img, (round(w * e), round(h * e)), interpolation=cv2.INTER_AREA)


LIMPA = cena()


# ───────────────────────────── o comparador ─────────────────────────────


def test_o_limiar_e_o_que_foi_medido_na_loja():
    # Medido em 08/10/2026 com quadros de verdade: a mesma cena dá de 0,96 a
    # 0,99, e uma mudança de 0,2% da área, até 0,83. Mexer nisto é medir de novo.
    assert (comparar.LIMIAR_IGUAL, comparar.LADO, comparar.BLOCO) == (0.90, 384, 21)


def test_a_mesma_imagem_e_igual():
    assert comparar.semelhanca(LIMPA, LIMPA) > 0.999


def test_a_mesma_cena_em_outra_resolucao_e_depois_do_jpeg_e_igual():
    # Como no agente: o recorte de agora vai a 640 e passa por JPEG; a foto
    # padrão veio a 1280, por outro JPEG.
    s = comparar.semelhanca(jpeg(reduzida(LIMPA)), jpeg(LIMPA, 82))
    assert s >= 0.97, s


@pytest.mark.parametrize("ganho", [0.85, 0.9, 1.1, 1.15])
def test_a_luz_subir_ou_descer_nao_e_diferenca(ganho):
    outra = np.clip(LIMPA.astype(np.float32) * ganho, 0, 255).astype(np.uint8)
    assert comparar.semelhanca(reduzida(outra), LIMPA) >= LIMIAR


@pytest.mark.parametrize("sigma", [4, 16])
def test_ruido_de_sensor_nao_e_diferenca(sigma):
    # 16 é câmera barata à noite, com o ganho no alto. É para isto que as
    # imagens são suavizadas antes da medida: sem suavizar, dá 0,87.
    ruido = np.random.default_rng(3).normal(0, sigma, LIMPA.shape)
    outra = np.clip(LIMPA.astype(np.float32) + ruido, 0, 255).astype(np.uint8)
    assert comparar.semelhanca(jpeg(reduzida(outra)), LIMPA) >= LIMIAR + 0.05


def test_o_quadro_de_agora_vindo_do_fluxo_menor_do_gravador_ainda_e_a_mesma_cena():
    # A foto padrão vem do fluxo principal; a olhada pode vir do menor
    # (352 × 240 nos gravadores mais simples). Sem suavizar, dá 0,89.
    tri = Zona(id="z", nome="t", poligono=[(0.1, 0.1), (0.9, 0.1), (0.1, 0.9)], ponto_id="p1")
    pequena = cv2.resize(LIMPA, (352, 240), interpolation=cv2.INTER_AREA)

    def recortada(img, lado=None):
        f, dentro = recorte.recortar_area(Frame(imagem=img, ts=BASE, ponto_id="p1"), tri)
        f = recorte.apagar_fora(f, dentro)
        return (recorte.redimensionar(f, lado) if lado else f).imagem, dentro

    padrao, dentro = recortada(LIMPA)
    agora, _ = recortada(pequena, 640)
    assert comparar.semelhanca(jpeg(agora), padrao, dentro=dentro) >= 0.93


@pytest.mark.parametrize("parte", [0.005, 0.01, 0.03])
def test_um_objeto_pequeno_fora_do_lugar_e_diferenca(parte):
    s = comparar.semelhanca(reduzida(com_objeto(LIMPA, 0.42, 0.55, parte)), LIMPA)
    assert s < LIMIAR - 0.1, f"um objeto de {parte:.1%} da área passou como igual ({s:.3f})"


def test_a_media_nao_veria_o_que_o_pior_bloco_ve():
    # É o motivo de a medida ser o pior bloco: 1% da área muda a média do
    # mapa em 1% — menos do que a mesma cena oscila sozinha.
    a = comparar._preparar(reduzida(com_objeto(LIMPA, 0.42, 0.55, 0.01)), (384, 216))
    b = comparar._preparar(LIMPA, (384, 216))
    assert float(comparar._mapa_de_semelhanca(a, b).mean()) > 0.97
    assert comparar.semelhanca(reduzida(com_objeto(LIMPA, 0.42, 0.55, 0.01)), LIMPA) < 0.6


def test_o_relogio_do_gravador_fica_de_fora_da_conta():
    # O relógio da foto padrão nunca é o de agora.
    com_outro_relogio = com_objeto(LIMPA, 0.70, 0.07, 0.01)
    relogio = (0.48, 0.045, 1.0, 0.18)
    assert comparar.semelhanca(reduzida(com_outro_relogio), LIMPA) < LIMIAR
    assert comparar.semelhanca(reduzida(com_outro_relogio), LIMPA, ignorar=[relogio]) >= LIMIAR
    # ...e o que muda FORA do relógio continua sendo visto
    assert comparar.semelhanca(reduzida(com_objeto(com_outro_relogio, 0.3, 0.6, 0.01)), LIMPA, ignorar=[relogio]) < LIMIAR


def triangulo(img: np.ndarray) -> np.ndarray:
    """A máscara de um triângulo com o canto reto em cima, à esquerda."""
    h, w = img.shape[:2]
    m = np.zeros((h, w), dtype=np.uint8)
    cv2.fillPoly(m, [np.array([[0, 0], [w - 1, 0], [0, h - 1]], dtype=np.int32)], 255)
    return m


def test_so_conta_o_que_e_da_area():
    dentro = triangulo(LIMPA)
    fora = com_objeto(LIMPA, 0.80, 0.80, 0.02)      # o canto de baixo, à direita: fora do triângulo
    no_meio = com_objeto(LIMPA, 0.20, 0.20, 0.02)   # dentro
    assert comparar.semelhanca(reduzida(fora), LIMPA) < LIMIAR, "sem a máscara, o objeto é visto"
    assert comparar.semelhanca(reduzida(fora), LIMPA, dentro=dentro) >= LIMIAR
    assert comparar.semelhanca(reduzida(no_meio), LIMPA, dentro=dentro) < LIMIAR


@pytest.mark.parametrize("de_x", [120, 123])
def test_o_que_muda_do_lado_de_fora_colado_na_borda_nao_conta(de_x):
    # A cena já no tamanho em que a medida é feita; a área é a esquerda dela,
    # até x = 119. O bloco da borda (colunas 107 a 128) é mais área do que
    # entorno: entra na conta, mas só com o que é da área.
    #   de 123 em diante: reprova quem tira a média do bloco inteiro (0,64);
    #   de 120 em diante: a janela da medida enxerga além da borda — é por
    #   isso que a beirada do desenho fica de fora (0,95 contra 0,85).
    base = cv2.resize(LIMPA, (384, 216), interpolation=cv2.INTER_AREA)
    dentro = np.zeros((216, 384), dtype=np.uint8)
    dentro[:, :119] = 255

    por_fora = base.copy()
    por_fora[60:110, de_x:128] = 255 - por_fora[60:110, de_x:128]
    assert comparar.semelhanca(por_fora, base) < LIMIAR, "sem a área, a mudança é vista"
    assert comparar.semelhanca(por_fora, base, dentro=dentro) >= LIMIAR

    por_dentro = base.copy()
    por_dentro[60:110, 100:112] = 255 - por_dentro[60:110, 100:112]
    assert comparar.semelhanca(por_dentro, base, dentro=dentro) < LIMIAR, "no mesmo bloco, do lado de dentro, é vista"


def test_a_beirada_do_desenho_nao_vira_diferenca():
    # Os dois recortes têm cinza fora do desenho, e o de agora passou por
    # JPEG: a compressão mistura cena e cinza na beirada.
    dentro = triangulo(LIMPA)
    apagada = LIMPA.copy()
    apagada[dentro == 0] = recorte.COR_DE_FORA
    s = comparar.semelhanca(jpeg(reduzida(apagada), 80), apagada, dentro=dentro)
    assert s >= 0.95, s


def test_sem_bloco_para_comparar_nao_ha_medida():
    nada = np.zeros(LIMPA.shape[:2], dtype=np.uint8)
    assert comparar.semelhanca(LIMPA, LIMPA, dentro=nada) is None
    assert comparar.semelhanca(LIMPA, LIMPA, ignorar=[(0.0, 0.0, 1.0, 1.0)]) is None


def test_recorte_pequeno_tambem_e_comparado():
    pequeno = LIMPA[200:260, 300:400]
    assert comparar.semelhanca(pequeno, pequeno) > 0.999
    mexido = pequeno.copy()
    mexido[20:40, 30:60] = 250
    assert comparar.semelhanca(mexido, pequeno) < LIMIAR


# ───────────────────────────── as fotos em disco ─────────────────────────────


def ref(nome: str, dados: bytes, foto_id: str | None = None) -> PadraoRef:
    return PadraoRef(id=foto_id or f"foto-{nome}", nome=nome, sha256=hashlib.sha256(dados).hexdigest())


class Nuvem:
    """Entrega as imagens combinadas e anota o que foi pedido."""

    def __init__(self, **imagens_por_id: bytes):
        self.imagens = dict(imagens_por_id)
        self.pedidos: list[str] = []
        self.erro: Exception | None = None

    def baixar_padrao(self, foto_id: str) -> bytes:
        self.pedidos.append(foto_id)
        if self.erro:
            raise self.erro
        return self.imagens[foto_id]


NOITE = em_bytes(LIMPA)
DIA = em_bytes(np.clip(LIMPA.astype(np.float32) * 1.6 + 30, 0, 255).astype(np.uint8))


def test_baixa_o_que_falta_e_entrega_aberto(tmp_path):
    noite, dia = ref("Noite", NOITE, "n1"), ref("Dia", DIA, "d1")
    nuvem = Nuvem(n1=NOITE, d1=DIA)
    p = Padroes(tmp_path / "padroes", baixar=nuvem.baixar_padrao)
    p.declarar({"p1": [dia, noite]})

    assert p.tem("p1") and not p.tem("p2") and not p.tem(None)
    assert [r.id for r in p.faltam()] == ["d1", "n1"]
    assert p.do_ponto("p1") == [], "sem a imagem em disco não há o que entregar"

    assert p.baixar_o_que_falta() == 2
    assert p.faltam() == [] and p.falhas == {}
    assert sorted(a.name for a in (tmp_path / "padroes").iterdir()) == ["d1.jpg", "n1.jpg"], "sem arquivo temporário sobrando"
    assert (tmp_path / "padroes" / "n1.jpg").read_bytes() == NOITE

    entregues = p.do_ponto("p1")
    assert [r.nome for r, _ in entregues] == ["Dia", "Noite"], "na ordem da configuração: da mais nova para a mais antiga"
    assert entregues[1][1].shape == LIMPA.shape

    assert p.baixar_o_que_falta() == 0
    assert nuvem.pedidos == ["d1", "n1"], "o que já está em disco não é pedido de novo"


def test_imagem_que_desce_diferente_do_resumo_e_descartada(tmp_path):
    noite = ref("Noite", NOITE, "n1")
    p = Padroes(tmp_path / "padroes", baixar=Nuvem(n1=NOITE[:-40]).baixar_padrao)   # cortada no caminho
    p.declarar({"p1": [noite]})

    assert p.baixar_o_que_falta() == 0
    assert "não é a que a nuvem descreveu" in p.falhas["n1"]
    assert not (tmp_path / "padroes" / "n1.jpg").exists(), "comparar com meia imagem é comparar com o que ninguém guardou"
    assert p.do_ponto("p1") == []


def test_rede_fora_fica_para_depois(tmp_path):
    noite = ref("Noite", NOITE, "n1")
    nuvem = Nuvem(n1=NOITE)
    nuvem.erro = OSError("não cheguei na nuvem")
    p = Padroes(tmp_path / "padroes", baixar=nuvem.baixar_padrao)
    p.declarar({"p1": [noite]})

    assert p.baixar_o_que_falta() == 0
    assert "não cheguei na nuvem" in p.falhas["n1"] and [r.id for r in p.faltam()] == ["n1"]

    nuvem.erro = None
    assert p.baixar_o_que_falta() == 1
    assert p.falhas == {} and len(p.do_ponto("p1")) == 1


def test_arquivo_estragado_em_disco_e_baixado_de_novo(tmp_path):
    noite = ref("Noite", NOITE, "n1")
    nuvem = Nuvem(n1=NOITE)
    p = Padroes(tmp_path / "padroes", baixar=nuvem.baixar_padrao)
    p.declarar({"p1": [noite]})
    p.baixar_o_que_falta()

    (tmp_path / "padroes" / "n1.jpg").write_bytes(b"lixo")
    assert [r.id for r in p.faltam()] == ["n1"]
    assert p.baixar_o_que_falta() == 1
    assert (tmp_path / "padroes" / "n1.jpg").read_bytes() == NOITE

    # Outra imagem no lugar — abre, mas não é a que foi guardada: não é entregue.
    (tmp_path / "padroes" / "n1.jpg").write_bytes(DIA)
    assert p.do_ponto("p1") == [], "comparar com o que ninguém guardou é pior do que não comparar"


def test_o_que_saiu_da_configuracao_sai_do_disco(tmp_path):
    noite, dia = ref("Noite", NOITE, "n1"), ref("Dia", DIA, "d1")
    p = Padroes(tmp_path / "padroes", baixar=Nuvem(n1=NOITE, d1=DIA).baixar_padrao)
    p.declarar({"p1": [noite, dia]})
    p.baixar_o_que_falta()
    p.do_ponto("p1")

    p.declarar({"p1": [noite]})

    assert [a.name for a in (tmp_path / "padroes").iterdir()] == ["n1.jpg"]
    assert [r.nome for r, _ in p.do_ponto("p1")] == ["Noite"]
    p.declarar({})
    assert list((tmp_path / "padroes").iterdir()) == [] and not p.tem("p1")


def test_sem_quem_baixe_a_loja_fica_com_o_que_tem(tmp_path):
    p = Padroes(tmp_path / "padroes")
    p.declarar({"p1": [ref("Noite", NOITE, "n1")]})
    assert p.baixar_o_que_falta() == 0 and p.tem("p1") and p.do_ponto("p1") == []


# ───────────────────────────── a configuração ─────────────────────────────


def test_a_configuracao_traz_as_fotos_do_canal_e_o_criterio_com_foto():
    corpo = resposta()
    corpo["pontos"][0]["padroes"] = [
        {"id": "d1", "nome": "Dia", "sha256": "a" * 64},
        {"id": "n1", "nome": "Noite", "sha256": "b" * 64},
        {"id": "", "nome": "sem id", "sha256": "c" * 64},
        {"id": "x1", "nome": "sem resumo"},
        "lixo",
    ]
    corpo["pontos"][0]["zonas"][0]["regras"][0]["comPadrao"] = True
    config = de_json(corpo)

    assert config.pontos[0].padroes == [PadraoRef("d1", "Dia", "a" * 64), PadraoRef("n1", "Noite", "b" * 64)]
    assert config.regras[0].com_padrao is True


def test_nuvem_antiga_nao_manda_nada_e_a_loja_segue_como_era():
    config = de_json(resposta())
    assert config.pontos[0].padroes == [] and config.regras[0].com_padrao is False


@pytest.mark.parametrize("torto", ["sim", 1, "true", None])
def test_com_padrao_so_e_verdade_quando_e_verdade(torto):
    corpo = resposta()
    corpo["pontos"][0]["zonas"][0]["regras"][0]["comPadrao"] = torto
    assert de_json(corpo).regras[0].com_padrao is False


# ───────────────────────────── o relógio do gravador ─────────────────────────────


def test_o_gravador_diz_onde_escreve_o_relogio(monkeypatch):
    texto = "\n".join([
        "table.VideoWidget[0].ChannelTitle.EncodeBlend=true",
        "table.VideoWidget[0].ChannelTitle.Rect[0]=186",
        "table.VideoWidget[0].TimeTitle.EncodeBlend=true",
        "table.VideoWidget[0].TimeTitle.PreviewBlend=true",
        "table.VideoWidget[0].TimeTitle.Rect[0]=3910",
        "table.VideoWidget[0].TimeTitle.Rect[1]=372",
        "table.VideoWidget[0].TimeTitle.Rect[2]=8192",
        "table.VideoWidget[0].TimeTitle.Rect[3]=1464",
        # canal 6: o relógio não é gravado na imagem
        "table.VideoWidget[5].TimeTitle.EncodeBlend=false",
        "table.VideoWidget[5].TimeTitle.Rect[0]=3910",
        "table.VideoWidget[5].TimeTitle.Rect[1]=372",
        "table.VideoWidget[5].TimeTitle.Rect[2]=8192",
        "table.VideoWidget[5].TimeTitle.Rect[3]=1464",
        # canal 13: retângulo incompleto
        "table.VideoWidget[12].TimeTitle.EncodeBlend=true",
        "table.VideoWidget[12].TimeTitle.Rect[0]=3910",
        # canal 15: retângulo sem tamanho
        "table.VideoWidget[14].TimeTitle.EncodeBlend=true",
        "table.VideoWidget[14].TimeTitle.Rect[0]=100",
        "table.VideoWidget[14].TimeTitle.Rect[1]=100",
        "table.VideoWidget[14].TimeTitle.Rect[2]=100",
        "table.VideoWidget[14].TimeTitle.Rect[3]=400",
    ])
    pedidos = []
    cliente = ClienteDahua("192.168.0.118", "admin", "segredo")
    monkeypatch.setattr(cliente, "_texto", lambda caminho: pedidos.append(caminho) or texto)

    relogios = cliente.relogios()

    assert pedidos == ["/cgi-bin/configManager.cgi?action=getConfig&name=VideoWidget"]
    assert list(relogios) == [1], "só o canal em que o relógio vai NA imagem, com retângulo inteiro e com tamanho"
    assert relogios[1] == pytest.approx((3910 / 8192, 372 / 8192, 1.0, 1464 / 8192))


# ───────────────────────────── o juiz ─────────────────────────────


INTEIRA = Zona(id="z1", nome="Quadro inteiro", poligono=[(0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0)], ponto_id="p1")
BANCADA = Zona(id="z2", nome="Bancada", poligono=[(0.1, 0.4), (0.6, 0.4), (0.6, 0.9), (0.1, 0.9)], ponto_id="p1")
CTX = {"regra_id": "r1", "zona_id": "z1", "ponto_id": "p1"}


class JuizDaNuvem:
    """Anota como foi chamado e responde o combinado."""

    nome = "nuvem-de-teste"

    def __init__(self, resultado=Resultado.NAO_CONFORME):
        self.resultado = resultado
        self.chamadas: list[dict] = []

    def julgar(self, imagem, criterio, *, contexto=None, referencias=None):
        self.chamadas.append({"imagem": imagem, "contexto": dict(contexto or {}), "referencias": referencias})
        return Veredito(
            resultado=self.resultado, confianca=0.9, motivo="há uma caixa sobre a bancada",
            via=Via.NUVEM, modelo="teste", custo_centavos=1.1,
        )


def padroes_com(tmp_path, **fotos: np.ndarray) -> Padroes:
    """As fotos dadas, já em disco, todas do canal p1 (na ordem dada)."""
    dados = {nome: em_bytes(img) for nome, img in fotos.items()}
    p = Padroes(tmp_path / "padroes", baixar=lambda foto_id: dados[foto_id])
    p.declarar({"p1": [PadraoRef(nome, nome, hashlib.sha256(d).hexdigest()) for nome, d in dados.items()]})
    assert p.baixar_o_que_falta() == len(dados)
    return p


def recorte_de_agora(tmp_path, img: np.ndarray, zona: Zona = INTEIRA, nome="agora.jpg") -> Path:
    """Como o motor grava: recorta a área, apaga o que é de fora, reduz e salva."""
    f, dentro = recorte.recortar_area(Frame(imagem=img, ts=BASE, ponto_id="p1"), zona)
    f = recorte.redimensionar(recorte.apagar_fora(f, dentro), 640)
    destino = tmp_path / nome
    assert imagens.escrever(str(destino), f.imagem, [cv2.IMWRITE_JPEG_QUALITY, 85])
    return destino


def test_canal_sem_foto_nao_e_atendido_e_o_motivo_ensina(tmp_path, regra):
    juiz = JuizDoPadrao(padroes_com(tmp_path, Noite=LIMPA), {"z1": INTEIRA})
    juiz.atende(replace(regra, zona=INTEIRA))
    outra = replace(INTEIRA, ponto_id="p9")
    with pytest.raises(ErroDoJuiz, match="falta a foto padrão deste canal") as e:
        juiz.atende(replace(regra, zona=outra))
    assert e.value.recuperavel is False


def test_igual_a_foto_padrao_e_conforme_e_nao_custa(tmp_path):
    nuvem = JuizDaNuvem()
    juiz = JuizDoPadrao(padroes_com(tmp_path, Noite=LIMPA), {"z1": INTEIRA}, escalar_para=nuvem)

    v = juiz.julgar(recorte_de_agora(tmp_path, LIMPA), "A bancada está como na foto padrão.", contexto=CTX)

    assert v.resultado is Resultado.CONFORME
    assert (v.via, v.custo_centavos, v.modelo) == (Via.COMPARACAO, 0.0, "foto-padrao")
    assert v.medida is not None and v.medida >= LIMIAR
    assert 0.8 <= v.confianca <= 1.0
    assert v.motivo.startswith("igual à foto padrão “Noite” (semelhança ") and v.motivo.endswith(")")
    assert nuvem.chamadas == [], "igual ao padrão não pergunta a ninguém"


def test_diferente_nao_e_irregular_vai_a_quem_sabe_julgar_com_a_foto_ao_lado(tmp_path):
    nuvem = JuizDaNuvem(Resultado.NAO_CONFORME)
    juiz = JuizDoPadrao(padroes_com(tmp_path, Noite=LIMPA), {"z1": INTEIRA}, escalar_para=nuvem)
    agora = recorte_de_agora(tmp_path, com_objeto(LIMPA, 0.4, 0.5, 0.02))

    v = juiz.julgar(agora, "A bancada está como na foto padrão.", contexto=CTX)

    assert v.resultado is Resultado.NAO_CONFORME and v.via is Via.NUVEM, "quem decidiu foi a nuvem"
    assert v.motivo == "há uma caixa sobre a bancada"
    assert v.medida is not None and v.medida < LIMIAR, "a semelhança que a loja mediu vai junto"
    (chamada,) = nuvem.chamadas
    assert chamada["imagem"] == agora
    assert chamada["contexto"]["foto_padrao"] == "Noite"
    (foto,) = chamada["referencias"]
    assert foto.is_file() and imagens.ler(str(foto)).shape == LIMPA.shape, "o recorte da foto padrão vai em arquivo"


def test_o_veredito_da_nuvem_pode_ser_conforme_e_a_medida_continua_a_da_loja(tmp_path):
    nuvem = JuizDaNuvem(Resultado.CONFORME)
    juiz = JuizDoPadrao(padroes_com(tmp_path, Noite=LIMPA), {"z1": INTEIRA}, escalar_para=nuvem)
    v = juiz.julgar(recorte_de_agora(tmp_path, com_objeto(LIMPA, 0.4, 0.5, 0.02)), "c", contexto=CTX)
    assert v.resultado is Resultado.CONFORME and v.via is Via.NUVEM and v.medida < LIMIAR


def test_diferente_e_sem_a_quem_perguntar_e_nao_deu_para_avaliar(tmp_path):
    juiz = JuizDoPadrao(padroes_com(tmp_path, Noite=LIMPA), {"z1": INTEIRA})
    v = juiz.julgar(recorte_de_agora(tmp_path, com_objeto(LIMPA, 0.4, 0.5, 0.02)), "c", contexto=CTX)

    assert v.resultado is Resultado.NAO_AVALIAVEL, "diferente não vira 'fora do critério' por conta da loja"
    assert (v.via, v.custo_centavos) == (Via.COMPARACAO, 0.0)
    assert v.motivo.startswith("diferente da foto padrão “Noite” (semelhança 0,") and "não tem a quem perguntar" in v.motivo
    assert v.medida is not None and v.medida < LIMIAR


def test_vale_a_foto_mais_parecida(tmp_path):
    de_dia = np.clip(255 - LIMPA.astype(np.int16), 0, 255).astype(np.uint8)     # outra cena inteira
    nuvem = JuizDaNuvem()
    juiz = JuizDoPadrao(padroes_com(tmp_path, Dia=de_dia, Noite=LIMPA), {"z1": INTEIRA}, escalar_para=nuvem)

    v = juiz.julgar(recorte_de_agora(tmp_path, LIMPA), "c", contexto=CTX)
    assert v.resultado is Resultado.CONFORME and "“Noite”" in v.motivo

    v = juiz.julgar(recorte_de_agora(tmp_path, de_dia, nome="dia.jpg"), "c", contexto=CTX)
    assert v.resultado is Resultado.CONFORME and "“Dia”" in v.motivo
    assert nuvem.chamadas == []


def test_foto_que_ainda_nao_chegou_a_loja_nao_vira_veredito(tmp_path):
    p = Padroes(tmp_path / "padroes")
    p.declarar({"p1": [PadraoRef("n1", "Noite", "a" * 64)]})
    nuvem = JuizDaNuvem()
    juiz = JuizDoPadrao(p, {"z1": INTEIRA}, escalar_para=nuvem)

    v = juiz.julgar(recorte_de_agora(tmp_path, LIMPA), "c", contexto=CTX)

    assert v.resultado is Resultado.NAO_AVALIAVEL and "ainda não chegou à loja" in v.motivo
    assert v.medida is None and nuvem.chamadas == []


def test_o_relogio_do_gravador_nao_faz_a_cena_parecer_outra(tmp_path):
    relogio = (0.48, 0.045, 1.0, 0.18)
    agora = recorte_de_agora(tmp_path, com_objeto(LIMPA, 0.70, 0.07, 0.01))       # só o "relógio" mudou
    p = padroes_com(tmp_path, Noite=LIMPA)

    sem_saber = JuizDoPadrao(p, {"z1": INTEIRA})
    assert sem_saber.julgar(agora, "c", contexto=CTX).resultado is Resultado.NAO_AVALIAVEL

    sabendo = JuizDoPadrao(p, {"z1": INTEIRA}, relogios={"p1": relogio})
    assert sabendo.julgar(agora, "c", contexto=CTX).resultado is Resultado.CONFORME

    # de outro canal, o retângulo não vale
    de_outro = JuizDoPadrao(p, {"z1": INTEIRA}, relogios={"p2": relogio})
    assert de_outro.julgar(agora, "c", contexto=CTX).resultado is Resultado.NAO_AVALIAVEL


def test_numa_area_menor_o_relogio_e_levado_para_o_recorte_dela(tmp_path):
    # A área pega o canto de cima, à direita — onde o relógio está.
    canto = Zona(id="z3", nome="Canto", poligono=[(0.5, 0.0), (1.0, 0.0), (1.0, 0.5), (0.5, 0.5)], ponto_id="p1")
    ctx = {**CTX, "zona_id": "z3"}
    agora = recorte_de_agora(tmp_path, com_objeto(LIMPA, 0.75, 0.07, 0.004), canto)
    p = padroes_com(tmp_path, Noite=LIMPA)

    assert JuizDoPadrao(p, {"z3": canto}).julgar(agora, "c", contexto=ctx).resultado is Resultado.NAO_AVALIAVEL
    sabendo = JuizDoPadrao(p, {"z3": canto}, relogios={"p1": (0.48, 0.045, 1.0, 0.18)})
    assert sabendo.julgar(agora, "c", contexto=ctx).resultado is Resultado.CONFORME


def test_compara_so_a_area_do_criterio(tmp_path):
    juiz = JuizDoPadrao(padroes_com(tmp_path, Noite=LIMPA), {"z1": INTEIRA, "z2": BANCADA})
    ctx = {**CTX, "zona_id": "z2"}
    fora_da_bancada = com_objeto(LIMPA, 0.8, 0.1, 0.02)
    na_bancada = com_objeto(LIMPA, 0.3, 0.6, 0.01)

    assert juiz.julgar(recorte_de_agora(tmp_path, fora_da_bancada, BANCADA), "c", contexto=ctx).resultado is Resultado.CONFORME
    assert juiz.julgar(recorte_de_agora(tmp_path, na_bancada, BANCADA, "b.jpg"), "c", contexto=ctx).resultado is Resultado.NAO_AVALIAVEL


def test_area_desenhada_por_pontos_compara_so_o_que_esta_dentro_do_desenho(tmp_path):
    tri = Zona(id="z4", nome="Triângulo", poligono=[(0.1, 0.1), (0.9, 0.1), (0.1, 0.9)], ponto_id="p1")
    juiz = JuizDoPadrao(padroes_com(tmp_path, Noite=LIMPA), {"z4": tri})
    ctx = {**CTX, "zona_id": "z4"}
    fora_do_desenho = com_objeto(LIMPA, 0.75, 0.75, 0.01)      # no retângulo em volta, fora do triângulo
    dentro_do_desenho = com_objeto(LIMPA, 0.25, 0.3, 0.01)

    assert juiz.julgar(recorte_de_agora(tmp_path, fora_do_desenho, tri), "c", contexto=ctx).resultado is Resultado.CONFORME
    assert juiz.julgar(recorte_de_agora(tmp_path, dentro_do_desenho, tri, "t.jpg"), "c", contexto=ctx).resultado is Resultado.NAO_AVALIAVEL


TRIANGULO = Zona(id="z4", nome="Triângulo", poligono=[(0.1, 0.1), (0.9, 0.1), (0.1, 0.9)], ponto_id="p1")


def test_o_desenho_da_area_vai_ao_comparador(tmp_path, monkeypatch):
    # É o que deixa a beirada do desenho de fora da conta.
    vistos = []
    original = comparar.semelhanca

    def espiar(atual, padrao, *, dentro=None, ignorar=()):
        vistos.append(None if dentro is None else float((dentro > 0).mean()))
        return original(atual, padrao, dentro=dentro, ignorar=ignorar)

    monkeypatch.setattr(comparar, "semelhanca", espiar)
    juiz = JuizDoPadrao(padroes_com(tmp_path, Noite=LIMPA), {"z4": TRIANGULO})

    juiz.julgar(recorte_de_agora(tmp_path, LIMPA, TRIANGULO), "c", contexto={**CTX, "zona_id": "z4"})

    assert len(vistos) == 1 and vistos[0] is not None
    assert vistos[0] == pytest.approx(0.5, abs=0.03), "o triângulo é metade do retângulo em volta dele"


def test_o_recorte_da_foto_que_vai_a_nuvem_tem_o_de_fora_apagado(tmp_path):
    # A nuvem é avisada de que o cinza é "fora da área" — a foto padrão tem
    # de chegar do mesmo jeito que a cena, e sem mostrar o que não é da área.
    nuvem = JuizDaNuvem()
    juiz = JuizDoPadrao(padroes_com(tmp_path, Noite=LIMPA), {"z4": TRIANGULO}, escalar_para=nuvem)
    agora = recorte_de_agora(tmp_path, com_objeto(LIMPA, 0.25, 0.3, 0.01), TRIANGULO)

    juiz.julgar(agora, "c", contexto={**CTX, "zona_id": "z4"})

    (foto,) = nuvem.chamadas[0]["referencias"]
    img = imagens.ler(str(foto))
    h, w = img.shape[:2]
    de_fora = img[int(h * 0.85):, int(w * 0.85):].astype(int)      # o canto oposto ao do triângulo
    assert np.abs(de_fora - recorte.COR_DE_FORA[0]).max() <= 6, "o que é de fora do desenho vai apagado"
    assert img[: h // 4, : w // 4].std() > 10, "o que é da área continua sendo cena"


def test_sem_area_no_contexto_o_juiz_diz_que_nao_sabe_onde_comparar(tmp_path):
    juiz = JuizDoPadrao(padroes_com(tmp_path, Noite=LIMPA), {"z1": INTEIRA})
    with pytest.raises(ErroDoJuiz, match="não sei com que recorte comparar"):
        juiz.julgar(recorte_de_agora(tmp_path, LIMPA), "c", contexto={"regra_id": "r1"})


def test_o_recorte_da_foto_e_guardado_uma_vez_e_refeito_se_a_area_mudar(tmp_path):
    juiz = JuizDoPadrao(padroes_com(tmp_path, Noite=LIMPA), {"z2": BANCADA})
    ctx = {**CTX, "zona_id": "z2"}
    agora = recorte_de_agora(tmp_path, LIMPA, BANCADA)

    caminho, achado = juiz.referencia_para(agora, ctx)
    assert achado.ref.nome == "Noite" and achado.semelhanca >= LIMIAR
    assert imagens.ler(str(caminho)).shape[:2] == (360, 640), "metade da largura e metade da altura da foto de 1280 × 720"
    gravado = caminho.stat().st_mtime_ns
    assert juiz.referencia_para(agora, ctx)[0] == caminho and caminho.stat().st_mtime_ns == gravado

    redesenhada = replace(BANCADA, poligono=[(0.1, 0.4), (0.7, 0.4), (0.7, 0.9), (0.1, 0.9)])
    juiz.zonas["z2"] = redesenhada
    outro, _ = juiz.referencia_para(recorte_de_agora(tmp_path, LIMPA, redesenhada, "r.jpg"), ctx)
    assert outro != caminho, "área redesenhada não manda o recorte antigo"
    assert outro.is_file() and not caminho.exists(), "e o recorte antigo sai do disco"

    assert juiz.referencia_para(agora, {"regra_id": "r1"}) is None, "sem área no contexto não há o que mandar"


def test_recorte_de_area_ou_de_foto_que_nao_existe_mais_sai_do_disco(tmp_path):
    p = padroes_com(tmp_path, Dia=LIMPA, Noite=LIMPA)
    juiz = JuizDoPadrao(p, {"z1": INTEIRA, "z2": BANCADA})
    for nome, zona in (("Dia", INTEIRA), ("Dia", BANCADA), ("Noite", BANCADA)):
        ref_, img = next(x for x in p.do_ponto("p1") if x[0].nome == nome)
        juiz._arquivo_do_recorte(type("A", (), {"ref": ref_, "imagem": img})(), zona)
    nomes = lambda: sorted(a.name.rsplit("_", 1)[0] for a in p.recortes.glob("*.jpg"))  # noqa: E731
    assert nomes() == ["Dia_z1", "Dia_z2", "Noite_z2"]

    # a área "Quadro inteiro" foi excluída: o juiz da configuração nova já nasce sem o recorte dela
    JuizDoPadrao(p, {"z2": BANCADA})
    assert nomes() == ["Dia_z2", "Noite_z2"]

    # a foto "Dia" foi excluída no console: a imagem e os recortes dela saem
    p.declarar({"p1": [r for r, _ in p.do_ponto("p1") if r.nome == "Noite"]})
    assert nomes() == ["Noite_z2"]
    assert [a.name for a in p.pasta.glob("*.jpg")] == ["Noite.jpg"]


# ───────────────────────── quem julga o quê ─────────────────────────


def seletor_com(tmp_path, nuvem, **fotos):
    padrao = JuizDoPadrao(padroes_com(tmp_path, **fotos), {"z1": INTEIRA}, escalar_para=nuvem)
    return SeletorDeJuiz("nuvem", nuvem=nuvem, padrao=padrao), padrao


def test_criterio_de_comparacao_e_do_juiz_da_foto_padrao(tmp_path, regra):
    nuvem = JuizDaNuvem()
    seletor, padrao = seletor_com(tmp_path, nuvem, Noite=LIMPA)
    comparacao = replace(regra, tipo=TipoRegra.COMPARACAO, zona=INTEIRA)

    assert seletor.para(comparacao) is padrao
    with pytest.raises(ErroDoJuiz, match="falta a foto padrão"):
        seletor.para(replace(comparacao, zona=replace(INTEIRA, ponto_id="p9")))
    assert seletor.para(replace(regra, zona=INTEIRA)) is nuvem, "estado continua indo à nuvem"


def test_estado_com_a_foto_padrao_leva_o_recorte_dela_a_nuvem(tmp_path, regra):
    nuvem = JuizDaNuvem(Resultado.CONFORME)
    seletor, _ = seletor_com(tmp_path, nuvem, Noite=LIMPA)
    com_foto = replace(regra, zona=INTEIRA, com_padrao=True)
    juiz = JuizPorRegra(seletor, {"r1": com_foto})
    agora = recorte_de_agora(tmp_path, com_objeto(LIMPA, 0.4, 0.5, 0.02))

    v = juiz.julgar(agora, "A bancada está limpa.", contexto=dict(CTX))

    assert v.resultado is Resultado.CONFORME
    (chamada,) = nuvem.chamadas
    (foto,) = chamada["referencias"]
    assert foto.is_file()
    assert chamada["contexto"] == {"regra_id": "r1", "foto_padrao": "Noite"}, "a área e o canal não vão ao modelo"


def test_estado_sem_a_escolha_segue_como_era(tmp_path, regra):
    nuvem = JuizDaNuvem()
    seletor, _ = seletor_com(tmp_path, nuvem, Noite=LIMPA)
    juiz = JuizPorRegra(seletor, {"r1": replace(regra, zona=INTEIRA)})

    juiz.julgar(recorte_de_agora(tmp_path, LIMPA), "A bancada está limpa.", contexto=dict(CTX))

    (chamada,) = nuvem.chamadas
    assert chamada["referencias"] is None
    assert chamada["contexto"] == {"regra_id": "r1"}


def test_canal_sem_foto_pergunta_sem_ela(tmp_path, regra):
    nuvem = JuizDaNuvem()
    seletor, _ = seletor_com(tmp_path, nuvem, Noite=LIMPA)
    outra = replace(INTEIRA, id="z9", ponto_id="p9")
    seletor.padrao.zonas["z9"] = outra
    juiz = JuizPorRegra(seletor, {"r1": replace(regra, zona=outra, com_padrao=True)})

    juiz.julgar(recorte_de_agora(tmp_path, LIMPA), "c", contexto={"regra_id": "r1", "zona_id": "z9", "ponto_id": "p9"})

    (chamada,) = nuvem.chamadas
    assert chamada["referencias"] is None and chamada["contexto"] == {"regra_id": "r1"}


def test_presenca_nao_leva_foto_mesmo_se_a_escolha_descer(tmp_path, regra):
    class Detector(JuizDaNuvem):
        def atende(self, parametros):
            return None

    detector = Detector(Resultado.CONFORME)
    padrao = JuizDoPadrao(padroes_com(tmp_path, Noite=LIMPA), {"z1": INTEIRA})
    seletor = SeletorDeJuiz("nuvem", detector=detector, padrao=padrao)
    presenca = replace(regra, tipo=TipoRegra.PRESENCA, zona=INTEIRA, com_padrao=True, parametros={"objeto": "pessoa", "minimo": 1})
    JuizPorRegra(seletor, {"r1": presenca}).julgar(recorte_de_agora(tmp_path, LIMPA), "c", contexto=dict(CTX))

    assert detector.chamadas[0]["referencias"] is None


def test_o_motor_poe_a_area_e_o_canal_no_que_vai_para_a_fila(tmp_path, regra, fonte):
    fila = Fila(tmp_path / "fila.db")
    try:
        MotorDeRegras(fila, [regra]).preparar(EventoGatilho(ponto_id=fonte.ponto_id, ts=BASE), fonte)
        (item,) = fila.proximos(BASE + timedelta(hours=1))
        assert item.contexto["zona_id"] == "z1" and item.contexto["ponto_id"] == "ponto-teste"
    finally:
        fila.fechar()


# ───────────────────────── o que a nuvem lê ─────────────────────────


def test_a_nuvem_e_avisada_de_que_a_referencia_e_a_foto_padrao_da_area():
    blocos = juiz_nuvem._conteudo("agora", "image/jpeg", "CRITÉRIO…", [("foto", "image/jpeg")], "Noite, loja aberta")
    textos = [b["text"] for b in blocos if b["type"] == "text"]

    assert textos[0] == juiz_nuvem.aviso_da_foto_padrao("Noite, loja aberta")
    assert "esta MESMA área (“Noite, loja aberta”)" in textos[0] and "NÃO a julgue" in textos[0]
    assert textos[1:] == ["FIM DA FOTO PADRÃO.", "AGORA A CENA A AUDITAR:", "CRITÉRIO…"]
    assert [b["type"] for b in blocos] == ["text", "image", "text", "text", "image", "text"], "a foto primeiro, a cena por último"
    assert blocos[2].get("cache_control") == {"type": "ephemeral"}


def test_referencia_de_objeto_continua_com_as_palavras_dela():
    blocos = juiz_nuvem._conteudo("agora", "image/jpeg", "CRITÉRIO…", [("ref", "image/jpeg")])
    assert blocos[0]["text"].startswith("REFERÊNCIA — as 1 imagens a seguir mostram o objeto/padrão correto")
    assert "FOTO PADRÃO" not in "".join(b.get("text", "") for b in blocos)


def test_o_endereco_do_agente_nao_vira_contexto_da_operacao():
    pedido = juiz_nuvem._montar_pedido("c", {"regra_id": "r1", "zona_id": "z1", "ponto_id": "p1", "foto_padrao": "Noite", "pedido": "X-burger"})
    assert pedido == "CRITÉRIO A AUDITAR:\nc\n\nCONTEXTO DA OPERAÇÃO:\n- regra_id: r1\n- pedido: X-burger"


def test_o_modelo_da_loja_tambem_nao_le_o_endereco_do_agente():
    from farol_agent.juizes import local

    contexto = {"regra_id": "r1", "zona_id": "z1", "ponto_id": "p1", "foto_padrao": "Noite", "fora_da_area": "apagado", "pedido": "X-burger"}
    assert local._pedido("c", contexto) == "CRITÉRIO A AUDITAR:\nc\n\nCONTEXTO DA OPERAÇÃO:\n- regra_id: r1\n- pedido: X-burger"


def test_o_juiz_da_nuvem_so_fala_de_foto_padrao_quando_ha_uma(monkeypatch, tmp_path):
    chamadas = []

    def falso_chamar(self, modelo, b64, tipo, texto, refs=None, padrao=None):
        chamadas.append({"refs": len(refs or []), "padrao": padrao})
        return Veredito(resultado=Resultado.CONFORME, confianca=0.99, custo_centavos=1.0)

    monkeypatch.setattr(juiz_nuvem.JuizNuvem, "_chamar", falso_chamar)
    juiz = juiz_nuvem.JuizNuvem.__new__(juiz_nuvem.JuizNuvem)
    juiz.modelo, juiz.modelo_forte, juiz.escalar_abaixo_de = "barato", None, 0.0
    agora = recorte_de_agora(tmp_path, LIMPA)

    juiz.julgar(agora, "c", contexto={"regra_id": "r1"})
    juiz.julgar(agora, "c", contexto={"regra_id": "r1", "foto_padrao": "Noite"}, referencias=[agora])

    assert chamadas == [{"refs": 0, "padrao": None}, {"refs": 1, "padrao": "Noite"}]


# ───────────────────────── o cliente da nuvem ─────────────────────────


class Resposta:
    def __init__(self, dados: bytes):
        self.dados = dados

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def read(self):
        return self.dados


def test_o_agente_baixa_a_foto_em_bytes_e_o_resto_continua_em_json(monkeypatch):
    pedidos = []

    def abrir(req, timeout=None):
        pedidos.append((req.get_method(), req.full_url, req.get_header("Accept"), req.get_header("Authorization")))
        return Resposta(NOITE if "/padroes/" in req.full_url else b'{"versao": 7}')

    monkeypatch.setattr("urllib.request.urlopen", abrir)
    cliente = ClienteNuvem("https://api.exemplo", "tok")

    assert cliente.baixar_padrao("n1") == NOITE
    assert cliente.configuracao() == {"versao": 7}
    assert pedidos == [
        ("GET", "https://api.exemplo/v1/agentes/padroes/n1", "image/*", "Bearer tok"),
        # O agente diz o que sabe fazer ao pedir a configuração (ver `nuvem.SABE`).
        ("GET", "https://api.exemplo/v1/agentes/configuracao?sabe=estados,estudo,bancada,fichas", "application/json", "Bearer tok"),
    ]


# ───────────────────────── o quadro de preview ─────────────────────────


class FonteFixa:
    ponto_id = "p1"

    def __init__(self, img):
        self.img = img

    def rajada(self, ts, quantidade=6, stream="main"):
        return [Frame(self.img.copy(), ts + timedelta(milliseconds=100 * i), self.ponto_id) for i in range(quantidade)]


def test_o_quadro_de_preview_conta_as_pessoas_no_quadro_como_veio():
    vistos = []

    def contar(img):
        vistos.append(img.shape)
        return 3

    q = preview.capturar(FonteFixa(cena(1920, 1080)), contar_pessoas=contar, borrar_rosto=False)

    assert q.pessoas == 3
    assert vistos == [(1080, 1920, 3)], "antes de reduzir: o detector conta melhor no quadro inteiro"


def test_sem_quem_conte_ou_com_a_conta_falhando_o_quadro_sai_do_mesmo_jeito():
    assert preview.capturar(FonteFixa(LIMPA), borrar_rosto=False).pessoas is None

    def falha(img):
        raise RuntimeError("detector caiu")

    q = preview.capturar(FonteFixa(LIMPA), contar_pessoas=falha, borrar_rosto=False)
    assert q.pessoas is None and q.bytes > 1000


def test_contar_pessoas_e_so_o_que_o_detector_ve_com_certeza(monkeypatch):
    from farol_agent import auditoria, servico

    monkeypatch.setattr(auditoria, "_detector_local", lambda: None)
    assert servico._contar_pessoas(LIMPA) is None, "sem detector não há medida — não é zero"

    class Motor:
        def pontuar(self, imagem, classe):
            assert classe == "person"
            return [0.95, 0.71, 0.70, 0.69, 0.40, 0.05]

    class Detector:
        motor = Motor()

    monkeypatch.setattr(auditoria, "_detector_local", lambda: Detector())
    assert servico._contar_pessoas(LIMPA) == 3


def quadro_capturado(monkeypatch, contagem) -> dict:
    """O que `capturar_quadro` devolve à nuvem, com a câmera e o detector de mentira."""
    from farol_agent import servico
    from farol_agent.fontes import rtsp

    class Fonte(FonteFixa):
        def __init__(self, ponto_id, url, **resto):
            super().__init__(LIMPA)

        def fechar(self):
            pass

    monkeypatch.setattr(rtsp, "FonteRTSP", Fonte)
    monkeypatch.setattr(servico, "url_do_ponto", lambda ponto: "rtsp://dublê")
    monkeypatch.setattr(servico, "_contar_pessoas", lambda img: contagem)
    return servico.capturar_quadro(replace(de_json(resposta()).pontos[0], host=None))


@pytest.mark.parametrize("contagem, esperado", [(2, 2), (0, 0), (None, "ausente")])
def test_o_quadro_que_sobe_leva_a_contagem_e_so_quando_houve_medida(monkeypatch, contagem, esperado):
    resultado = quadro_capturado(monkeypatch, contagem)

    # Zero é medida ("ninguém no quadro"); `None` é "não medi" e não sobe.
    assert resultado.get("pessoas", "ausente") == esperado
    assert (resultado["largura"], resultado["altura"]) == (1280, 720)


# ───────────────────────── o contrato com a nuvem ─────────────────────────


def _contrato() -> dict:
    caminho = Path(__file__).resolve().parents[2] / "contratos" / "foto-padrao.json"
    assert caminho.is_file(), f"contrato não encontrado em {caminho}"
    return json.loads(caminho.read_text(encoding="utf-8"))


def test_o_agente_le_a_configuracao_e_manda_o_quadro_como_no_contrato(monkeypatch):
    """A API confere o MESMO arquivo (api/testes/padroes.test.ts).

    Se um lado mudar o nome de um campo, o teste do outro quebra no CI — em
    vez de a loja ficar sem foto padrão sem ninguém saber (a forma do ERR-018).
    """
    contrato = _contrato()
    exemplo = contrato["configuracao"]["padroesDoPonto"][0]

    corpo = resposta()
    corpo["pontos"][0]["padroes"] = contrato["configuracao"]["padroesDoPonto"]
    corpo["pontos"][0]["zonas"][0]["regras"][0].update(contrato["configuracao"]["regra"])
    config = de_json(corpo)

    assert config.pontos[0].padroes == [PadraoRef(exemplo["id"], exemplo["nome"], exemplo["sha256"])]
    assert sorted(exemplo) == ["id", "nome", "sha256"], "campo novo no contrato: o agente tem de passar a ler"
    assert contrato["configuracao"]["regra"] == {"comPadrao": True} and config.regras[0].com_padrao is True

    # ...e o que o agente manda com o quadro tem o nome e o tipo do contrato
    resultado = quadro_capturado(monkeypatch, contrato["quadro"]["pessoas"])
    assert {k: resultado[k] for k in contrato["quadro"]} == contrato["quadro"]


# ───────────────────────── a auditoria, de ponta a ponta ─────────────────────────

# Terça-feira ao meio-dia: dentro da janela da regra do dublê de configuração.
MEIO_DIA = datetime(2026, 10, 6, 12, 0, 0)


class NuvemComFotos(NuvemDeTeste):
    def __init__(self, **imagens_por_id: bytes):
        super().__init__()
        self.imagens = dict(imagens_por_id)
        self.pedidos_de_foto: list[str] = []
        self.erro_de_foto: Exception | None = None

    def baixar_padrao(self, foto_id: str) -> bytes:
        self.pedidos_de_foto.append(foto_id)
        if self.erro_de_foto:
            raise self.erro_de_foto
        return self.imagens[foto_id]


def configuracao(versao=1, *, tipo="comparacao", fotos=(("n1", "Noite", NOITE),), **da_regra):
    corpo = resposta(versao=versao)
    corpo["pontos"][0]["padroes"] = [{"id": i, "nome": n, "sha256": hashlib.sha256(d).hexdigest()} for i, n, d in fotos]
    corpo["pontos"][0]["zonas"][0]["poligono"] = [[0, 0], [1, 0], [1, 1], [0, 1]]
    corpo["pontos"][0]["zonas"][0]["regras"][0].update({"tipo": tipo, **da_regra})
    return corpo


def auditoria(tmp_path, nuvem, img=LIMPA, *, construir_juiz=None):
    a = Auditoria(nuvem, str(tmp_path / "fila.db"), construir_fonte=lambda ponto: FonteFixa(img), construir_juiz=construir_juiz, medidor=None)
    a._perguntar_relogios = lambda ponto: {}
    return a


def linhas(a):
    return [dict(l) for l in a.fila._con.execute("select * from resumo_hora").fetchall()]


def test_a_loja_baixa_a_foto_compara_e_da_conforme_sem_chamar_ninguem(tmp_path, monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    nuvem = NuvemComFotos(n1=NOITE)
    a = auditoria(tmp_path, nuvem)
    a.montar(de_json(configuracao()))

    assert nuvem.pedidos_de_foto == ["n1"], "a foto desce na montagem"
    assert a.sem_juiz == [], "com foto no canal, o critério de comparação é atendido"

    r = a.passo(MEIO_DIA)

    assert r["enfileirados"] == 1 and r["alertas"] == 0
    (l,) = linhas(a)
    assert (l["conformes"], l["nao_conformes"], l["nao_avaliaveis"]) == (1, 0, 0)
    assert (l["julgadas_loja"], l["julgadas_nuvem"]) == (1, 0), "julgado na loja"
    assert l["custo_centavos"] == 0
    assert l["com_medida"] == 1 and l["max_medida"] >= LIMIAR, "a semelhança fica guardada como medida"
    a.fila.fechar()


def test_cena_diferente_sem_nuvem_para_perguntar_nao_vira_aviso(tmp_path, monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    a = auditoria(tmp_path, NuvemComFotos(n1=NOITE), com_objeto(LIMPA, 0.4, 0.5, 0.03))
    a.montar(de_json(configuracao()))

    r = a.passo(MEIO_DIA)

    assert r["alertas"] == 0
    (l,) = linhas(a)
    assert (l["conformes"], l["nao_conformes"], l["nao_avaliaveis"]) == (0, 0, 1)
    assert l["ultimo_motivo"].startswith("diferente da foto padrão “Noite”")
    a.fila.fechar()


def nuvem_que_julga(monkeypatch):
    """Põe um juiz de nuvem de mentira no lugar do de verdade. Devolve as chamadas que ele receber."""
    chamadas: list[dict] = []

    class Falsa:
        nome = "nuvem"

        def julgar(self, imagem, criterio, *, contexto=None, referencias=None):
            chamadas.append({"contexto": dict(contexto or {}), "referencias": list(referencias or [])})
            return Veredito(
                resultado=Resultado.NAO_CONFORME, confianca=0.95, motivo="há uma caixa sobre a bancada",
                via=Via.NUVEM, modelo="teste", custo_centavos=1.2,
            )

    monkeypatch.setattr(juiz_nuvem, "JuizNuvem", Falsa)
    return chamadas


def test_em_loja_que_usa_a_nuvem_o_diferente_vai_a_ela_com_a_foto_ao_lado(tmp_path, monkeypatch):
    chamadas = nuvem_que_julga(monkeypatch)
    a = auditoria(tmp_path, NuvemComFotos(n1=NOITE), com_objeto(LIMPA, 0.4, 0.5, 0.03))
    a.montar(de_json(configuracao()))

    a.passo(MEIO_DIA)

    (chamada,) = chamadas
    assert chamada["contexto"]["foto_padrao"] == "Noite"
    assert len(chamada["referencias"]) == 1 and chamada["referencias"][0].is_file()
    (l,) = linhas(a)
    assert (l["conformes"], l["nao_conformes"], l["nao_avaliaveis"]) == (0, 1, 0), "quem disse 'fora do critério' foi a nuvem"
    assert (l["julgadas_loja"], l["julgadas_nuvem"]) == (0, 1)
    assert l["com_medida"] == 1 and l["max_medida"] < LIMIAR, "a semelhança medida na loja fica guardada"
    a.fila.fechar()


def test_em_loja_de_modo_local_nada_sai_mesmo_com_a_nuvem_a_mao(tmp_path, monkeypatch):
    chamadas = nuvem_que_julga(monkeypatch)
    corpo = configuracao()
    corpo["loja"]["modoJulgamento"] = "local"
    a = auditoria(tmp_path, NuvemComFotos(n1=NOITE), com_objeto(LIMPA, 0.4, 0.5, 0.03))
    a.montar(de_json(corpo))

    a.passo(MEIO_DIA)

    assert chamadas == [], "modo local: a imagem não sai da loja"
    (l,) = linhas(a)
    assert (l["conformes"], l["nao_conformes"], l["nao_avaliaveis"]) == (0, 0, 1)
    a.fila.fechar()


def test_foto_guardada_depois_desce_na_montagem_seguinte_sem_esperar_o_minuto(tmp_path, monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    nuvem = NuvemComFotos(n1=NOITE, d1=DIA)
    a = auditoria(tmp_path, nuvem)
    a.montar(de_json(configuracao(versao=1)))

    a.montar(de_json(configuracao(versao=2, fotos=(("d1", "Dia", DIA), ("n1", "Noite", NOITE)))))
    assert nuvem.pedidos_de_foto == ["n1", "d1"], "a primeira olhada depois de guardar já tem com o que comparar"

    a.montar(de_json(configuracao(versao=3, fotos=(("d1", "Dia", DIA),))))
    assert [f.name for f in (tmp_path / "padroes").glob("*.jpg")] == ["d1.jpg"], "a foto excluída no console sai do disco da loja"
    a.fila.fechar()


def test_canal_sem_foto_o_criterio_de_comparacao_fica_de_fora_dizendo_por_que(tmp_path, monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    a = auditoria(tmp_path, NuvemComFotos())
    a.montar(de_json(configuracao(fotos=())))

    assert [motivo for _, motivo in a.sem_juiz] == ["falta a foto padrão deste canal: guarde uma em Canais → Quadro e área"]
    assert a.passo(MEIO_DIA)["enfileirados"] == 0
    (l,) = linhas(a)
    assert (l["capturas"], l["sem_juiz"]) == (1, 1)
    assert "falta a foto padrão" in l["ultimo_impedimento"]
    a.fila.fechar()


def test_foto_que_nao_desceu_e_pedida_de_novo_mas_nao_a_cada_volta(tmp_path):
    nuvem = NuvemComFotos(n1=NOITE)
    nuvem.erro_de_foto = OSError("sem internet")
    a = auditoria(tmp_path, nuvem, construir_juiz=lambda cfg: None)
    a.montar(de_json(configuracao()))
    assert nuvem.pedidos_de_foto == ["n1"]
    # A montagem marca a próxima tentativa pelo relógio da máquina; o teste
    # anda pelo dele: é como se a montagem tivesse sido um minuto antes.
    assert a._proxima_busca_de_padroes is not None
    a._proxima_busca_de_padroes = MEIO_DIA

    a.passo(MEIO_DIA)
    a.passo(MEIO_DIA + timedelta(seconds=30))
    assert len(nuvem.pedidos_de_foto) == 2, "tenta de novo, mas não a cada meio minuto"

    nuvem.erro_de_foto = None
    a.passo(MEIO_DIA + NOVA_BUSCA_DE_PADROES + timedelta(seconds=1))
    assert len(nuvem.pedidos_de_foto) == 3 and a.padroes.faltam() == []

    a.passo(MEIO_DIA + 3 * NOVA_BUSCA_DE_PADROES)
    assert len(nuvem.pedidos_de_foto) == 3, "com tudo em disco, não pede mais nada"
    a.fila.fechar()


def test_o_gravador_e_perguntado_uma_vez_e_so_quando_ha_o_que_comparar(tmp_path, monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    perguntas = []

    def perguntar(ponto):
        perguntas.append(ponto.host)
        return {1: (0.48, 0.045, 1.0, 0.18), 2: (0.0, 0.0, 0.5, 0.1)}

    a = auditoria(tmp_path, NuvemComFotos(n1=NOITE))
    a._perguntar_relogios = perguntar

    a.montar(de_json(configuracao(versao=1, tipo="estado")))
    assert perguntas == [], "sem critério que compare, o gravador não é incomodado"

    a.montar(de_json(configuracao(versao=2)))
    assert perguntas == ["192.168.1.108"]
    assert a.juiz.seletor.padrao.relogios == {"p1": (0.48, 0.045, 1.0, 0.18)}, "o retângulo é o do canal 1"

    a.montar(de_json(configuracao(versao=3)))
    assert perguntas == ["192.168.1.108"], "a resposta do gravador fica guardada"

    a.montar(de_json(configuracao(versao=4, tipo="estado", comPadrao=True)))
    assert a.juiz.seletor.padrao.relogios == {"p1": (0.48, 0.045, 1.0, 0.18)}, "estado com a foto junto também usa"
    a.fila.fechar()


def test_gravador_que_nao_responde_nao_derruba_a_montagem_e_e_perguntado_de_novo(tmp_path, monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    perguntas = []

    def perguntar(ponto):
        perguntas.append(ponto.host)
        raise OSError("gravador fora da rede")

    a = auditoria(tmp_path, NuvemComFotos(n1=NOITE))
    a._perguntar_relogios = perguntar

    a.montar(de_json(configuracao(versao=1)))
    assert a.juiz.seletor.padrao.relogios == {} and a.motor is not None
    a.montar(de_json(configuracao(versao=2)))
    assert len(perguntas) == 2, "falha não fica guardada como resposta"
    a.fila.fechar()


def test_canal_sem_foto_nao_faz_perguntar_ao_gravador(tmp_path, monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    perguntas = []
    a = auditoria(tmp_path, NuvemComFotos())
    a._perguntar_relogios = lambda ponto: perguntas.append(ponto.host) or {}
    a.montar(de_json(configuracao(fotos=())))
    assert perguntas == []
    a.fila.fechar()
