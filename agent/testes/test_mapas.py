"""O mapa do canal: a imagem fixa que situa o recorte (A19, onda 1).

Quando um critério vale num quadro, o que sai da loja é o recorte dele — e,
antes dele, o mapa: a câmera inteira, pequena, com os quadros numerados.

O recorte mostra só o que foi marcado; o mapa mostra a câmera inteira. Por
isso o que mais se protege aqui é **quem aparece nele**:

- o mapa nasce como ESQUEMA — o desenho dos quadros, sem um ponto sequer da
  imagem da câmera;
- só vira fotografia quando o detector de pessoas diz que não há ninguém,
  nem um "talvez"; sem detector, ou com o detector falhando, não vira;
- uma vez fotografia, é trocada devagar (de hora em hora, no máximo) e só
  por uma mais clara, ou quando envelhece — trocar o arquivo joga fora o
  cache do modelo;
- cada canal tem o seu, cada desenho de quadros tem o seu, e o que não
  vale mais sai do disco.
"""

from __future__ import annotations

import os
from datetime import datetime, timedelta

import cv2
import numpy as np
import pytest

from farol_agent import imagens, mapas
from farol_agent.contexto import Cena, Quadro
from farol_agent.mapas import ESQUEMA, FOTO, LADO_DO_MAPA, MAIS_CLARA, RENOVAR_APOS, TENTAR_MELHORAR_A_CADA, Mapas, desenhar
from farol_agent.modelos import Frame

from .test_foto_padrao import cena as cozinha

AGORA = datetime(2026, 10, 6, 12, 0, 0)

CUBAS = Quadro("z1", 1, "Cubas", "cuba", ((0.06, 0.07), (0.76, 0.07), (0.76, 0.29), (0.06, 0.29)))
MONTAGEM = Quadro("z2", 2, "Montagem", "montagem", ((0.06, 0.34), (0.70, 0.34), (0.70, 0.80), (0.06, 0.80)))


def a_cena(*quadros: Quadro) -> Cena:
    return Cena(tipo_negocio="hamburgueria", setor="Cozinha", canal="Montagem 1", texto="Bancada vista de cima.", quadros=quadros)


CENA = a_cena(CUBAS, MONTAGEM)


def quadro(img: np.ndarray, ts: datetime = AGORA) -> Frame:
    return Frame(imagem=img, ts=ts, ponto_id="p1")


class Olheiro:
    """Faz as vezes do detector de pessoas: responde o que mandarem, e anota o que viu."""

    def __init__(self, resposta: bool | None = True):
        self.resposta = resposta
        self.vistos: list[tuple[int, ...]] = []

    def __call__(self, imagem: np.ndarray) -> bool | None:
        self.vistos.append(imagem.shape)
        if isinstance(self.resposta, Exception):
            raise self.resposta
        return self.resposta


def tipo_de(caminho) -> str:
    return caminho.stem.rsplit("_", 1)[1]


# ───────────────────────── o desenho ─────────────────────────


def test_o_mapa_cabe_em_640_no_lado_maior_e_guarda_o_enquadramento():
    assert LADO_DO_MAPA == 640
    assert desenhar(None, (1920, 1080), CENA.quadros).shape == (360, 640, 3)
    assert desenhar(None, (1080, 1920), CENA.quadros).shape == (640, 360, 3), "câmera em pé continua em pé"
    assert desenhar(None, (320, 240), CENA.quadros).shape == (240, 320, 3), "nunca amplia"


def test_o_esquema_tem_os_quadros_desenhados_e_nenhum_ponto_da_camera():
    esquema = desenhar(None, (1920, 1080), CENA.quadros)
    amarelo = np.all(esquema == np.array(mapas.COR_DO_CONTORNO, dtype=np.uint8), axis=2)
    assert amarelo.sum() > 200, "os contornos estão lá"
    # Fora dos quadros, só o fundo liso.
    assert tuple(int(v) for v in esquema[350, 630]) == mapas.COR_DO_FUNDO
    # Dentro de um quadro (longe da borda e do número), o miolo liso.
    assert tuple(int(v) for v in esquema[200, 240]) == mapas.COR_DO_MIOLO


def test_a_fotografia_e_a_camera_reduzida_com_os_contornos_por_cima():
    img = cozinha(1920, 1080)
    foto = desenhar(img, (1920, 1080), CENA.quadros)
    reduzida = cv2.resize(img, (640, 360), interpolation=cv2.INTER_AREA)
    # Num canto sem desenho, é a própria imagem.
    assert np.array_equal(foto[300:356, 480:636], reduzida[300:356, 480:636])
    amarelo = np.all(foto == np.array(mapas.COR_DO_CONTORNO, dtype=np.uint8), axis=2)
    assert amarelo.sum() > 200
    # Imagem em tons de cinza (câmera no infravermelho) também vira mapa colorido.
    assert desenhar(cv2.cvtColor(img, cv2.COLOR_BGR2GRAY), (1920, 1080), CENA.quadros).shape == (360, 640, 3)


def test_cada_quadro_leva_o_seu_numero_e_o_desenho_e_sempre_o_mesmo():
    um = desenhar(None, (1920, 1080), (CUBAS,))
    dois = desenhar(None, (1920, 1080), (CUBAS, MONTAGEM))
    assert not np.array_equal(um, dois)
    # O arquivo tem de ser o MESMO a cada vez: é o que o cache do modelo exige.
    assert np.array_equal(dois, desenhar(None, (1920, 1080), (CUBAS, MONTAGEM)))
    outro_numero = desenhar(None, (1920, 1080), (Quadro("z1", 7, "Cubas", "cuba", CUBAS.poligono),))
    assert not np.array_equal(um, outro_numero), "o número é desenhado"


# ───────────────────── esquema primeiro ─────────────────────


def test_canal_sem_quadro_nao_tem_mapa(tmp_path):
    m = Mapas(tmp_path, sem_gente=Olheiro(True))
    so_a_imagem_completa = a_cena()
    assert m.cuidar("p1", so_a_imagem_completa, quadro(cozinha(1920, 1080)), AGORA) is None
    assert m.arquivo("p1", so_a_imagem_completa) is None
    assert list(tmp_path.glob("*.jpg")) == []


def test_sem_detector_o_mapa_e_o_esquema_e_nao_muda_com_a_imagem(tmp_path):
    m = Mapas(tmp_path)
    assert m.arquivo("p1", CENA) is None, "antes da primeira olhada não há mapa"

    primeiro = m.cuidar("p1", CENA, quadro(cozinha(1920, 1080, semente=1)), AGORA)
    assert tipo_de(primeiro) == ESQUEMA and m.e_esquema(primeiro)
    antes = primeiro.read_bytes()

    # Outra imagem, completamente diferente: o mapa é o mesmo arquivo, byte a byte.
    depois = m.cuidar("p1", CENA, quadro(cozinha(1920, 1080, semente=99)), AGORA + timedelta(hours=5))
    assert depois == primeiro == m.arquivo("p1", CENA)
    assert depois.read_bytes() == antes
    assert sorted(p.name for p in tmp_path.glob("*.jpg")) == [primeiro.name]


@pytest.mark.parametrize("resposta", [False, None])
def test_com_gente_ou_sem_saber_o_mapa_nunca_e_fotografia(tmp_path, resposta):
    olheiro = Olheiro(resposta)
    m = Mapas(tmp_path, sem_gente=olheiro)
    img = cozinha(1920, 1080)
    for volta in range(5):
        mapa = m.cuidar("p1", CENA, quadro(img), AGORA + timedelta(seconds=30 * volta))
        assert tipo_de(mapa) == ESQUEMA
    assert len(olheiro.vistos) == 5, "sem fotografia, pergunta em toda olhada"
    assert olheiro.vistos[0] == (1080, 1920, 3), "o detector olha o quadro INTEIRO, como a câmera entrega"
    # O que foi para o disco não tem a imagem da câmera: é igual ao esquema puro.
    guardado = imagens.ler(mapa)
    esperado = cv2.imdecode(cv2.imencode(".jpg", desenhar(None, (1920, 1080), CENA.quadros), [cv2.IMWRITE_JPEG_QUALITY, mapas.QUALIDADE_DO_MAPA])[1], cv2.IMREAD_COLOR)
    assert np.array_equal(guardado, esperado)


def test_detector_que_falha_nao_autoriza_fotografia(tmp_path, caplog):
    m = Mapas(tmp_path, sem_gente=Olheiro(RuntimeError("o modelo não carregou")))
    with caplog.at_level("WARNING", logger="farol_agent.mapas"):
        mapa = m.cuidar("p1", CENA, quadro(cozinha(1920, 1080)), AGORA)
    assert tipo_de(mapa) == ESQUEMA
    assert "não deu para conferir se o canal está vazio" in caplog.text


# ───────────────────── fotografia com o lugar vazio ─────────────────────


def test_com_o_lugar_vazio_o_mapa_vira_fotografia(tmp_path):
    olheiro = Olheiro(False)
    m = Mapas(tmp_path, sem_gente=olheiro)
    img = cozinha(1920, 1080)
    assert tipo_de(m.cuidar("p1", CENA, quadro(img), AGORA)) == ESQUEMA

    olheiro.resposta = True
    foto = m.cuidar("p1", CENA, quadro(img), AGORA + timedelta(seconds=30))
    assert tipo_de(foto) == FOTO and not m.e_esquema(foto)
    assert m.arquivo("p1", CENA) == foto, "com as duas no disco, vale a fotografia"
    guardada = imagens.ler(foto)
    assert guardada.shape == (360, 640, 3)
    reduzida = cv2.resize(img, (640, 360), interpolation=cv2.INTER_AREA)
    assert float(np.abs(guardada[300:356, 480:636].astype(int) - reduzida[300:356, 480:636].astype(int)).mean()) < 6, "é a câmera (a menos da compressão)"


def test_a_fotografia_passa_pelo_borrao_de_rosto_antes_de_ser_desenhada(tmp_path, monkeypatch):
    # O detector de pessoas pode não ver alguém; o de rosto é a segunda camada. O que se confere é
    # o RESULTADO: o que vai para o disco é o que saiu do borrão, não o quadro como veio.
    vistos = []

    def borrar(frame):
        vistos.append(frame.imagem.shape)
        return frame.copia_com(np.full_like(frame.imagem, 200)), True

    monkeypatch.setattr(mapas.recorte, "borrar_rostos", borrar)
    foto = Mapas(tmp_path, sem_gente=Olheiro(True)).cuidar("p1", CENA, quadro(cozinha(1920, 1080)), AGORA)
    assert tipo_de(foto) == FOTO and vistos == [(1080, 1920, 3)], "o quadro inteiro, antes de reduzir"
    guardada = imagens.ler(foto)
    assert abs(int(guardada[340, 620].mean()) - 200) <= 2, "o mapa foi desenhado sobre o que saiu do borrão"


def test_tela_de_sem_sinal_nao_vira_fotografia(tmp_path):
    olheiro = Olheiro(True)
    m = Mapas(tmp_path, sem_gente=olheiro)
    preta = np.zeros((1080, 1920, 3), dtype=np.uint8)
    assert tipo_de(m.cuidar("p1", CENA, quadro(preta), AGORA)) == ESQUEMA
    assert olheiro.vistos == [], "nem pergunta ao detector: não há cena"


def test_a_fotografia_e_trocada_no_maximo_de_hora_em_hora_e_so_por_uma_mais_clara(tmp_path):
    assert (TENTAR_MELHORAR_A_CADA, MAIS_CLARA, RENOVAR_APOS) == (timedelta(hours=1), 1.15, timedelta(days=7))
    olheiro = Olheiro(True)
    m = Mapas(tmp_path, sem_gente=olheiro)
    escura = (cozinha(1920, 1080).astype(np.float32) * 0.5).astype(np.uint8)
    clara = cozinha(1920, 1080)

    foto = m.cuidar("p1", CENA, quadro(escura), AGORA)
    assert tipo_de(foto) == FOTO
    da_madrugada = foto.read_bytes()
    os.utime(foto, (AGORA.timestamp(), AGORA.timestamp()))
    perguntas = len(olheiro.vistos)

    # Dentro da hora: nem olha, mesmo com imagem melhor na mão.
    for minutos in (1, 30, 59):
        assert m.cuidar("p1", CENA, quadro(clara), AGORA + timedelta(minutes=minutos)) == foto
    assert len(olheiro.vistos) == perguntas and foto.read_bytes() == da_madrugada

    # Passou a hora, mas a nova é igual: fica a que está (trocar joga fora o cache).
    m.cuidar("p1", CENA, quadro(escura), AGORA + timedelta(minutes=61))
    assert len(olheiro.vistos) == perguntas + 1 and foto.read_bytes() == da_madrugada

    # Mais uma hora, e agora a luz está acesa: troca.
    m.cuidar("p1", CENA, quadro(clara), AGORA + timedelta(minutes=125))
    assert foto.read_bytes() != da_madrugada
    do_dia = foto.read_bytes()
    os.utime(foto, ((AGORA + timedelta(minutes=125)).timestamp(),) * 2)

    # Com gente, a melhor imagem do mundo não entra.
    olheiro.resposta = False
    ainda_mais_clara = np.clip(clara.astype(np.float32) * 1.4, 0, 255).astype(np.uint8)
    m.cuidar("p1", CENA, quadro(ainda_mais_clara), AGORA + timedelta(hours=4))
    assert foto.read_bytes() == do_dia


def test_fotografia_velha_e_refeita_mesmo_sem_estar_mais_clara(tmp_path):
    olheiro = Olheiro(True)
    m = Mapas(tmp_path, sem_gente=olheiro)
    img = cozinha(1920, 1080, semente=3)
    foto = m.cuidar("p1", CENA, quadro(img), AGORA)
    os.utime(foto, (AGORA.timestamp(), AGORA.timestamp()))

    mudou = cozinha(1920, 1080, semente=4)      # o lugar mudou: equipamento novo
    m.cuidar("p1", CENA, quadro(mudou), AGORA + timedelta(days=6))
    antes = foto.read_bytes()
    os.utime(foto, (AGORA.timestamp(), AGORA.timestamp()))
    m.cuidar("p1", CENA, quadro(mudou), AGORA + RENOVAR_APOS + timedelta(hours=2))
    assert foto.read_bytes() != antes, "passou de uma semana: refaz"


# ───────────────────── um por canal, um por desenho ─────────────────────


def test_dois_canais_nao_dividem_o_mapa(tmp_path):
    m = Mapas(tmp_path, sem_gente=Olheiro(True))
    a = m.cuidar("canal-a", CENA, quadro(cozinha(1920, 1080, semente=1)), AGORA)
    b = m.cuidar("canal-b", CENA, quadro(cozinha(1920, 1080, semente=2)), AGORA)
    assert a != b and a.read_bytes() != b.read_bytes()
    assert m.arquivo("canal-a", CENA) == a and m.arquivo("canal-b", CENA) == b
    assert m.arquivo("canal-c", CENA) is None


def test_quadro_redesenhado_troca_o_mapa_e_o_antigo_sai_do_disco(tmp_path):
    m = Mapas(tmp_path, sem_gente=Olheiro(True))
    img = cozinha(1920, 1080)
    antigo = m.cuidar("p1", CENA, quadro(img), AGORA)
    do_vizinho = m.cuidar("p2", CENA, quadro(img), AGORA)

    redesenhada = a_cena(CUBAS, Quadro("z2", 2, "Montagem", "montagem", ((0.1, 0.4), (0.6, 0.4), (0.6, 0.9), (0.1, 0.9))))
    assert redesenhada.desenho() != CENA.desenho()
    assert m.arquivo("p1", redesenhada) is None, "o mapa antigo não vale para o desenho novo"
    novo = m.cuidar("p1", redesenhada, quadro(img), AGORA + timedelta(minutes=5))
    assert novo != antigo and antigo.is_file(), "até a montagem seguinte, o antigo ainda está no disco"

    m.largar({"p1": redesenhada, "p2": CENA})
    assert not antigo.is_file() and novo.is_file() and do_vizinho.is_file()

    # Renomear o quadro, ou reescrever a cena, não mexe no desenho: o mapa fica.
    renomeada = Cena(tipo_negocio="padaria", setor="Cozinha", canal="Outro nome", texto="Outra cena.", quadros=(
        Quadro("z1", 1, "Cubas de molho", "livre", CUBAS.poligono), redesenhada.quadros[1],
    ))
    assert renomeada.desenho() == redesenhada.desenho()
    assert m.arquivo("p1", renomeada) == novo


def test_largar_tira_o_mapa_do_canal_que_saiu_e_todos_quando_nada_mais_vale(tmp_path):
    m = Mapas(tmp_path, sem_gente=Olheiro(True))
    img = cozinha(1920, 1080)
    um, dois = m.cuidar("p1", CENA, quadro(img), AGORA), m.cuidar("p2", CENA, quadro(img), AGORA)

    m.largar({"p1": CENA})
    assert um.is_file() and not dois.is_file()
    # Canal que deixou de ter quadro (só a imagem completa) também não tem mais mapa.
    m.largar({"p1": a_cena()})
    assert list(tmp_path.glob("*.jpg")) == []
    Mapas(tmp_path / "nao-existe").largar({})     # pasta que nunca foi criada: nada a fazer


def test_erro_de_disco_sobe(tmp_path, monkeypatch):
    # Sem mapa o critério de quadro não pode perguntar: calar o erro aqui
    # faria o pedido sair sem ele, ou não sair, sem ninguém saber por quê.
    monkeypatch.setattr(imagens, "escrever", lambda *a, **k: False)
    with pytest.raises(OSError, match="não consegui gravar o mapa"):
        Mapas(tmp_path).cuidar("p1", CENA, quadro(cozinha(1920, 1080)), AGORA)
