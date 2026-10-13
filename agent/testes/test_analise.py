"""A análise completa: canal → área → envio → veredito.

O que estes testes protegem não é a chamada à API — é a cadeia em volta
dela, que é onde o dinheiro e a confiança se perdem:

- o recorte da área marcada tem que ser EXATO (margem zero);
- o px/cm relatado tem que ser o do que o modelo viu, não o da câmera;
- cena inutilizável não pode chegar a custar uma chamada.
"""

from __future__ import annotations

from datetime import datetime, timedelta

import numpy as np
import pytest

from farol_agent.analise import analisar
from farol_agent.cli import _area_para_zona
from farol_agent.juizes.base import ErroDoJuiz
from farol_agent.modelos import Frame, Resultado, Zona

from .conftest import JuizFixo


class FonteDeTeste:
    """Fonte com tamanho e conteúdo escolhidos pelo teste."""

    def __init__(self, largura: int, altura: int, *, preta: bool = False, vazia: bool = False):
        self.largura_q = largura
        self.altura_q = altura
        self.preta = preta
        self.vazia = vazia
        self.ponto_id = "ponto-teste"

    def _imagem(self, i: int) -> np.ndarray:
        if self.preta:
            return np.zeros((self.altura_q, self.largura_q, 3), dtype=np.uint8)
        rng = np.random.default_rng(i)
        return rng.integers(0, 255, (self.altura_q, self.largura_q, 3), dtype=np.uint8)

    def quadro(self, ts, stream="main"):
        return None if self.vazia else Frame(self._imagem(0), ts, self.ponto_id)

    def rajada(self, ts, quantidade=6, stream="main"):
        if self.vazia:
            return []
        return [
            Frame(self._imagem(i), ts + timedelta(milliseconds=200 * i), self.ponto_id)
            for i in range(quantidade)
        ]

    def fechar(self) -> None:
        pass


def area(x1: float, y1: float, x2: float, y2: float) -> Zona:
    return Zona(
        id="a", nome="área", poligono=[(x1, y1), (x2, y1), (x2, y2), (x1, y2)]
    )


# ─────────────────────────── o quadro inteiro ───────────────────────────


def test_sem_area_analisa_o_quadro_todo_e_reduz_ao_degrau(tmp_path):
    # É a opção de análise completa: nenhuma área marcada, a cena toda é a
    # pergunta. O envio ainda cai ao degrau — 1920 vira 640.
    juiz = JuizFixo(Resultado.CONFORME)
    r = analisar(
        FonteDeTeste(1920, 1080),
        juiz,
        "a bancada está limpa",
        envio="r640",
        borrar_rosto=False,
        salvar_em=tmp_path / "enviado.jpg",
    )

    assert r.veredito is not None
    assert r.veredito.resultado is Resultado.CONFORME
    assert (r.enviado_largura, r.enviado_altura) == (640, 360)
    assert juiz.chamadas == 1


def test_a_imagem_enviada_fica_em_disco_e_e_a_que_foi_medida(tmp_path):
    # Sem isto não se audita veredito nenhum: a primeira pergunta diante de
    # um resultado estranho é "o que ele estava olhando?".
    from farol_agent import imagens

    destino = tmp_path / "enviado.jpg"
    r = analisar(
        FonteDeTeste(1280, 720),
        JuizFixo(),
        "critério",
        envio="r640",
        borrar_rosto=False,
        salvar_em=destino,
    )

    assert r.caminho_enviado == str(destino)
    assert destino.is_file()
    assert r.enviado_bytes == destino.stat().st_size > 0

    gravada = imagens.ler(destino)
    assert gravada is not None
    assert gravada.shape[1] == r.enviado_largura
    assert gravada.shape[0] == r.enviado_altura


# ──────────────────────────── a área marcada ────────────────────────────


def test_area_marcada_recorta_exatamente_sem_margem(tmp_path):
    # A margem de 5% do padrão existe para polígono desenhado a olho. Área
    # que o usuário marcou é a resposta dele: 50% de 1000 px = 500 px, não
    # 550. Se a margem voltasse, o px/cm relatado passaria a mentir.
    r = analisar(
        FonteDeTeste(1000, 1000),
        JuizFixo(),
        "critério",
        zona=area(0.25, 0.25, 0.75, 0.75),
        margem=0.0,
        envio="r640",
        borrar_rosto=False,
    )

    assert (r.enviado_largura, r.enviado_altura) == (500, 500)


def test_a_margem_padrao_alarga_o_recorte(tmp_path):
    # O contraste do teste acima: com os 5% o mesmo retângulo sai com 550.
    r = analisar(
        FonteDeTeste(1000, 1000),
        JuizFixo(),
        "critério",
        zona=area(0.25, 0.25, 0.75, 0.75),
        margem=0.05,
        envio="r640",
        borrar_rosto=False,
    )

    assert r.enviado_largura == 550


def test_area_estreita_sustenta_px_por_cm_alto_com_envio_pequeno():
    # O coração da economia do produto. A mesma câmera, a mesma distância:
    # recortar 20 cm de cena e mandar 640 px dá 32 px/cm — acima dos 12,8
    # que a montagem exige — sem pagar 1080.
    r = analisar(
        FonteDeTeste(1920, 1080),
        JuizFixo(),
        "o sanduíche tem os quatro itens",
        zona=area(0.4, 0.4, 0.6, 0.6),
        margem=0.0,
        envio="r640",
        largura_zona_cm=20.0,
        borrar_rosto=False,
    )

    # 20% de 1920 = 384 px de recorte; cabe em r640, então não reduz.
    assert r.enviado_largura == 384
    assert r.px_por_cm == pytest.approx(19.2, abs=0.1)
    assert r.px_por_cm > 12.8


def test_px_por_cm_e_o_do_modelo_nao_o_da_camera():
    # A câmera pode ter muita resolução e nada disso chega se o envio for
    # pequeno. O número que decide o veredito é este.
    r = analisar(
        FonteDeTeste(1920, 1080),
        JuizFixo(),
        "critério",
        envio="r384",
        largura_zona_cm=100.0,
        borrar_rosto=False,
    )

    assert r.enviado_largura == 384
    assert r.px_por_cm == pytest.approx(3.84, abs=0.01)


def test_sem_largura_informada_nao_inventa_px_por_cm():
    # Número inventado aqui vira recomendação de compra errada.
    r = analisar(
        FonteDeTeste(1280, 720), JuizFixo(), "critério", borrar_rosto=False
    )
    assert r.px_por_cm is None


# ───────────────────────── as portas que economizam ─────────────────────


def test_cena_inutilizavel_nao_chega_a_custar_uma_chamada(tmp_path):
    # Canal sem câmera transmite tela preta. Perguntar ao modelo se a
    # bancada está limpa a respeito de um retângulo preto custa dinheiro e
    # devolve absurdo — e um "não conforme" sobre nada viraria alerta.
    juiz = JuizFixo()
    r = analisar(
        FonteDeTeste(1280, 720, preta=True),
        juiz,
        "critério",
        borrar_rosto=False,
        salvar_em=tmp_path / "preta.jpg",
    )

    assert juiz.chamadas == 0
    assert r.veredito is None
    assert r.cena_utilizavel is False
    assert "sem cena" in str(r.erro)

    # Mas a imagem fica salva: é a prova de por que não foi julgada.
    assert (tmp_path / "preta.jpg").is_file()


def test_canal_sem_quadro_falha_antes_de_gastar():
    juiz = JuizFixo()
    r = analisar(FonteDeTeste(640, 480, vazia=True), juiz, "critério")

    assert juiz.chamadas == 0
    assert r.veredito is None
    assert "nenhum quadro" in str(r.erro)
    assert r.quadros_capturados == 0


def test_erro_do_juiz_vira_relato_nao_excecao():
    # O comando roda em laço; uma falha de rede na terceira análise não
    # pode derrubar as outras.
    juiz = JuizFixo(erro=ErroDoJuiz("429 devagar aí"))
    r = analisar(FonteDeTeste(640, 480), juiz, "critério", borrar_rosto=False)

    assert r.veredito is None
    assert "429" in str(r.erro)
    assert r.ms_total >= 0


def test_mede_a_qualidade_do_que_foi_enviado():
    r = analisar(
        FonteDeTeste(1280, 720), JuizFixo(), "critério", borrar_rosto=False
    )

    assert r.quadros_capturados == 6
    assert r.nitidez is not None and r.nitidez > 0
    assert r.detalhe is not None
    assert r.estourado is not None
    assert r.cena_utilizavel is True


# ─────────────────────────── a área pela linha ───────────────────────────


def test_area_do_cli_nasce_sem_margem():
    zona, margem = _area_para_zona("0.1,0.2,0.8,0.9")

    assert margem == 0.0
    assert zona is not None
    assert zona.bbox(1000, 1000, margem) == (100, 200, 800, 900)


def test_sem_area_o_cli_pede_o_quadro_inteiro():
    zona, _ = _area_para_zona(None)
    assert zona is None


@pytest.mark.parametrize(
    "texto",
    [
        "0.1,0.2,0.8",            # falta um número
        "0.1,0.2,0.8,0.9,1.0",    # sobra um
        "a,b,c,d",                # não é número
        "100,200,800,900",        # pixels em vez de fração
        "0.8,0.2,0.1,0.9",        # x2 < x1
        "0.1,0.9,0.8,0.2",        # y2 < y1
    ],
)
def test_area_invalida_para_em_vez_de_recortar_errado(texto):
    # Recortar a área errada não dá erro visível: dá veredito confiante
    # sobre o lugar errado. Melhor recusar.
    with pytest.raises(SystemExit):
        _area_para_zona(texto)


# ───────────── o que o primeiro uso em campo ensinou (ERR-008) ─────────────


def _analise_de_confianca_baixa(simulada: bool):
    from farol_agent.analise import Analise
    from farol_agent.modelos import Veredito, Via

    return Analise(
        veredito=Veredito(
            resultado=Resultado.CONFORME,
            confianca=0.63,
            via=Via.LOCAL if simulada else Via.NUVEM,
            modelo="x",
        ),
        enviado_largura=640,
        enviado_altura=360,
        enviado_bytes=31707,
        nitidez=198.6,
        ms_total=2028,
    )


def test_confianca_sorteada_pelo_simulador_nao_vira_conselho(capsys):
    """O simulador SORTEIA a confiança entre 0,60 e 0,95 pelo hash da imagem.

    No primeiro uso em campo o relatório saiu dizendo "confiança abaixo de
    70% — este veredito não se sustenta" e recomendando marcar área, por
    causa de um número inventado. Mandar alguém investigar equipamento com
    base nisso queima a confiança no diagnóstico inteiro.
    """
    from farol_agent.cli import _mostrar_analise

    _mostrar_analise(1, _analise_de_confianca_baixa(True), False, simulado=True)
    saida = capsys.readouterr().out

    assert "sorteada pelo simulador" in saida
    assert "não se sustenta" not in saida
    assert "marcar a área" not in saida


def test_com_juiz_de_verdade_a_confianca_baixa_aponta_a_causa(capsys):
    # O contraste: com juiz real o diagnóstico tem que sair, e apontando a
    # causa medida — é o embrião da recomendação de equipamento.
    from farol_agent.cli import _mostrar_analise

    _mostrar_analise(1, _analise_de_confianca_baixa(False), False, simulado=False)
    saida = capsys.readouterr().out

    assert "não se sustenta" in saida
    assert "marcar a área" in saida
    assert "sorteada" not in saida


def test_silenciador_do_opencv_devolve_o_nivel_de_log():
    """Calar o WARNING não pode virar calar para sempre.

    O aviso do YuNet ("Targets are not supported by the new graph engine")
    caía no meio do relatório e parecia erro. Some só durante a criação do
    detector — depois disso, aviso de FFMPEG no RTSP tem que voltar a
    aparecer, que é onde ele ajuda.
    """
    from farol_agent.pipeline.recorte import _opencv_sem_aviso

    try:
        from cv2.utils import logging as cvlog
    except ImportError:
        pytest.skip("esta build do OpenCV não expõe cv2.utils.logging")

    antes = cvlog.getLogLevel()
    with _opencv_sem_aviso():
        assert cvlog.getLogLevel() == cvlog.LOG_LEVEL_ERROR
    assert cvlog.getLogLevel() == antes


def test_silenciador_devolve_o_nivel_mesmo_com_excecao():
    from farol_agent.pipeline.recorte import _opencv_sem_aviso

    try:
        from cv2.utils import logging as cvlog
    except ImportError:
        pytest.skip("esta build do OpenCV não expõe cv2.utils.logging")

    antes = cvlog.getLogLevel()
    with pytest.raises(ValueError):
        with _opencv_sem_aviso():
            raise ValueError("falha no meio da detecção")
    assert cvlog.getLogLevel() == antes


# ──────── chave recusada: parar na primeira, não martelar seis (ERR-010) ────────


@pytest.mark.parametrize(
    "chave, pedaco",
    [
        ("", "não está definida"),
        ("sk-ant-...", "EXEMPLO"),
        ("sk-ant-…", "EXEMPLO"),
        ("minha-chave-secreta-de-verdade-com-muitos-caracteres", "sk-ant-"),
        ("sk-ant-abc", "curta demais"),
    ],
)
def test_chave_impossivel_e_pega_antes_de_tocar_no_gravador(
    chave, pedaco, monkeypatch
):
    """Conferir a chave ANTES de pedir a senha do DVR e abrir o RTSP.

    Sem isto o comando captura, redimensiona e tenta julgar — seis vezes —
    para só então dizer que a chave não presta. Aconteceu duas vezes
    seguidas em 05/10/2026, com o exemplo `sk-ant-...` colado literalmente.
    """
    from farol_agent.cli import _conferir_chave

    monkeypatch.setenv("ANTHROPIC_API_KEY", chave)
    problema = _conferir_chave()

    assert problema is not None
    assert pedaco in problema


def test_chave_plausivel_passa(monkeypatch):
    from farol_agent.cli import _conferir_chave

    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-" + "a" * 60)
    assert _conferir_chave() is None


@pytest.mark.parametrize(
    "bruto, esperado",
    [
        ("AuthenticationError: Error code: 401 - {'type': 'authentication_error'}",
         "recusada (401)"),
        ("RateLimitError: Error code: 429", "mais devagar"),
        ("Error code: 529 overloaded_error", "sobrecarregada"),
        ("your credit balance is too low", "sem crédito"),
    ],
)
def test_erro_da_api_vira_frase_que_diz_o_que_fazer(bruto, esperado):
    # Seis linhas de despejo do SDK nao ajudam ninguem a resolver nada.
    from farol_agent.cli import _erro_legivel

    assert esperado in _erro_legivel(bruto)


def test_erro_desconhecido_sai_inteiro():
    # Traduzir o que se conhece, nunca engolir o que não se conhece.
    from farol_agent.cli import _erro_legivel

    assert _erro_legivel("coisa nunca vista") == "coisa nunca vista"


def test_analise_carrega_se_o_erro_vale_retentar():
    definitivo = JuizFixo(erro=ErroDoJuiz("401", recuperavel=False))
    r = analisar(FonteDeTeste(640, 480), definitivo, "c", borrar_rosto=False)
    assert r.recuperavel is False

    passageiro = JuizFixo(erro=ErroDoJuiz("429", recuperavel=True))
    r = analisar(FonteDeTeste(640, 480), passageiro, "c", borrar_rosto=False)
    assert r.recuperavel is True


def test_o_laco_para_na_primeira_falha_definitiva(monkeypatch, tmp_path, capsys):
    """Seis capturas e seis 401 iguais escondem a causa e gastam à toa."""
    import farol_agent.analise as mod_analise
    import farol_agent.dvr.dahua as mod_dahua
    import farol_agent.fontes.rtsp as mod_rtsp
    from farol_agent import cli
    from farol_agent.analise import Analise

    chamadas = {"n": 0}

    def falsa_analise(*a, **k):
        chamadas["n"] += 1
        return Analise(erro="401 authentication_error", recuperavel=False)

    class FalsoCliente:
        def __init__(self, *a, **k):
            pass

        def url_rtsp(self, canal, sub=False):
            return "rtsp://exemplo/1"

    monkeypatch.setattr(mod_analise, "analisar", falsa_analise)
    monkeypatch.setattr(mod_dahua, "ClienteDahua", FalsoCliente)
    monkeypatch.setattr(mod_rtsp, "FonteRTSP", lambda *a, **k: object())
    monkeypatch.setattr(cli, "_senha_do_dvr", lambda args: "x")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-" + "a" * 60)

    codigo = cli.main([
        "analisar", "--host", "10.0.0.1", "--criterio", "c",
        "--repetir", "6", "--intervalo", "0",
        "--salvar-em", str(tmp_path), "--simulado",
    ])

    assert chamadas["n"] == 1, "tentou de novo um erro que não melhora repetindo"
    assert codigo == 1
    assert "parei aqui" in capsys.readouterr().out


def test_erro_passageiro_nao_interrompe_o_laco(monkeypatch, tmp_path):
    # O contraste: 429 e queda de rede valem retentar, e as análises
    # seguintes podem muito bem dar certo.
    import farol_agent.analise as mod_analise
    import farol_agent.dvr.dahua as mod_dahua
    import farol_agent.fontes.rtsp as mod_rtsp
    from farol_agent import cli
    from farol_agent.analise import Analise

    chamadas = {"n": 0}

    def falsa_analise(*a, **k):
        chamadas["n"] += 1
        return Analise(erro="429 devagar", recuperavel=True)

    class FalsoCliente:
        def __init__(self, *a, **k):
            pass

        def url_rtsp(self, canal, sub=False):
            return "rtsp://exemplo/1"

    monkeypatch.setattr(mod_analise, "analisar", falsa_analise)
    monkeypatch.setattr(mod_dahua, "ClienteDahua", FalsoCliente)
    monkeypatch.setattr(mod_rtsp, "FonteRTSP", lambda *a, **k: object())
    monkeypatch.setattr(cli, "_senha_do_dvr", lambda args: "x")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-" + "a" * 60)

    cli.main([
        "analisar", "--host", "10.0.0.1", "--criterio", "c",
        "--repetir", "4", "--intervalo", "0",
        "--salvar-em", str(tmp_path), "--simulado",
    ])

    assert chamadas["n"] == 4


# ──────────── a chave não escolhe modelo; o código escolhe ────────────


def test_cascata_desligada_nunca_consulta_o_modelo_forte(tmp_path, monkeypatch):
    """`--so-haiku` trava o custo por análise.

    A cascata melhora a acurácia do que veio inseguro, mas torna o custo
    por análise variável — e o número que uma rede de lojas precisa para
    orçar é o custo FIXO por análise. Quem opera decide qual quer.
    """
    from farol_agent.juizes.nuvem import JuizNuvem
    from farol_agent.modelos import Resultado, Veredito, Via

    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-" + "a" * 60)
    pytest.importorskip("anthropic")

    chamados: list[str] = []

    def falso_chamar(self, modelo, b64, tipo, texto, refs=None):
        chamados.append(modelo)
        # Confiança baixa: com cascata ligada, isto escalaria.
        return Veredito(
            resultado=Resultado.CONFORME, confianca=0.40, via=Via.NUVEM, modelo=modelo
        )

    monkeypatch.setattr(JuizNuvem, "_chamar", falso_chamar)
    monkeypatch.setattr(
        "farol_agent.juizes.nuvem._ler_imagem", lambda p: ("ZmFsc28=", "image/jpeg")
    )

    imagem = tmp_path / "x.jpg"
    imagem.write_bytes(b"falso")

    juiz = JuizNuvem(modelo_forte=None)
    juiz.julgar(imagem, "critério")
    assert len(chamados) == 1, "não podia ter reconsultado ninguém"

    chamados.clear()
    com_cascata = JuizNuvem()
    com_cascata.julgar(imagem, "critério")
    assert len(chamados) == 2, "com cascata, confiança 0,40 tem que escalar"
    assert chamados[0] != chamados[1]


def test_a_flag_so_haiku_existe_e_nasce_desligada(monkeypatch):
    # Nasce desligada porque a cascata é o comportamento que protege o
    # veredito; desligá-la é escolha de quem opera, não padrão silencioso.
    #
    # Conferido pelo analisador de verdade, e não pelo texto do programa: o
    # comando recebe `so_haiku` desligado quando ninguém pede, e ligado só
    # quando a opção é escrita.
    from farol_agent import cli

    vistos = []
    monkeypatch.setattr(cli, "cmd_analisar", lambda args: vistos.append(args) or 0)

    with pytest.raises(SystemExit):
        cli.main(["analisar", "--ajuda-inexistente"])
    assert vistos == [], "com argumento que não existe o comando nem chega a rodar"

    pedido = ["analisar", "--host", "10.0.0.1", "--criterio", "a bancada está limpa?"]
    assert cli.main(pedido) == 0
    assert cli.main([*pedido, "--so-haiku"]) == 0
    assert [a.so_haiku for a in vistos] == [False, True]


# ───────── referências e ensaio: medir em vez de achar (05/10/2026) ─────────


def test_referencias_entram_antes_da_cena_e_rotuladas():
    """A ordem e o rótulo não são enfeite.

    Sem rótulo, o modelo não sabe qual imagem julgar e pode dar veredito
    confiante sobre a foto de referência — erro silencioso, porque o
    `motivo` descreveria uma cena que existe, só que a errada.
    """
    from farol_agent.juizes.nuvem import _conteudo

    blocos = _conteudo("CENA", "image/jpeg", "critério",
                       [("REF1", "image/jpeg"), ("REF2", "image/png")])

    textos = [b["text"] for b in blocos if b["type"] == "text"]
    imagens_b64 = [b["source"]["data"] for b in blocos if b["type"] == "image"]

    # as referências vêm primeiro, a cena por último
    assert imagens_b64 == ["REF1", "REF2", "CENA"]
    assert "REFERÊNCIA" in textos[0]
    assert "NÃO as julgue" in textos[0]
    assert any("AGORA A CENA A AUDITAR" in x for x in textos)


def test_bloco_de_referencia_e_cacheavel():
    # As referências são fixas por regra e repetidas em toda análise dela:
    # é o prefixo grande e estável que torna o cache vantajoso (0,1× a
    # entrada). Sem elas o prefixo é pequeno demais e o cache não pega —
    # foi o que a medição de 05/10 mostrou.
    from farol_agent.juizes.nuvem import _conteudo

    blocos = _conteudo("CENA", "image/jpeg", "c", [("R", "image/jpeg")])
    marcados = [b for b in blocos if b.get("cache_control")]

    assert len(marcados) == 1, "exatamente um marcador, no fim do bloco fixo"
    # tudo depois do marcador varia por análise
    corte = blocos.index(marcados[0])
    assert all(b["type"] != "image" or b["source"]["data"] == "CENA"
               for b in blocos[corte:])


def test_sem_referencia_o_pedido_nao_muda():
    # Quem não usa referência não pode pagar por bloco nenhum a mais.
    from farol_agent.juizes.nuvem import _conteudo

    blocos = _conteudo("CENA", "image/jpeg", "critério", None)
    assert len(blocos) == 2
    assert blocos[0]["type"] == "image"
    assert blocos[1]["text"] == "critério"
    assert not any(b.get("cache_control") for b in blocos)


def test_custo_de_modelo_sem_preco_some_em_vez_de_virar_zero():
    # Custo falso é pior que custo ausente: R$ 0,0000 num relatório de
    # orçamento lê-se como "de graça".
    from farol_agent.juizes.nuvem import JuizNuvem

    class Uso:
        input_tokens = 1000
        cache_creation_input_tokens = 0
        cache_read_input_tokens = 0
        output_tokens = 100

    custo = JuizNuvem._custo(object(), "modelo-que-nao-existe", Uso())
    assert custo is None


# ─────────────────────────── o banco de ensaio ───────────────────────────


def _veredito(resultado, confianca):
    from farol_agent.modelos import Veredito, Via

    return Veredito(resultado=resultado, confianca=confianca, via=Via.NUVEM,
                    modelo="x", custo_centavos=1.0)


class JuizDeRoteiro:
    """Devolve vereditos de uma lista, em ordem."""

    nome = "roteiro"

    def __init__(self, vereditos):
        self.vereditos = list(vereditos)
        self.referencias_vistas = None

    def julgar(self, imagem, criterio, *, contexto=None, referencias=None):
        self.referencias_vistas = referencias
        return self.vereditos.pop(0)


def test_ensaio_mede_acuracia_contra_o_gabarito(tmp_path):
    from farol_agent.ensaio import rodar

    arquivos = []
    for i in range(3):
        a = tmp_path / f"q{i}.jpg"
        a.write_bytes(b"x")
        arquivos.append(a)

    juiz = JuizDeRoteiro([
        _veredito(Resultado.CONFORME, 0.95),       # gabarito: nao_conforme → erra
        _veredito(Resultado.NAO_CONFORME, 0.90),   # gabarito: nao_conforme → acerta
        _veredito(Resultado.CONFORME, 0.95),       # gabarito: conforme     → acerta
    ])
    gabarito = {
        "q0.jpg": Resultado.NAO_CONFORME,
        "q1.jpg": Resultado.NAO_CONFORME,
        "q2.jpg": Resultado.CONFORME,
    }

    e = rodar(juiz, arquivos, "critério", gabarito=gabarito)

    assert e.acertos == 2
    assert e.acuracia == pytest.approx(2 / 3)
    assert e.centavos == 3.0


def test_ensaio_separa_o_erro_CONFIANTE_do_erro_qualquer(tmp_path):
    """O número que decide se dá para confiar no produto.

    A cascata escala o que vem com confiança BAIXA — então um erro a 95%
    passa por ela intocado. Contar esses à parte é o que impede de ler
    "67% de acurácia" como se todos os erros fossem iguais.
    """
    from farol_agent.ensaio import rodar

    arquivos = []
    for i in range(2):
        a = tmp_path / f"q{i}.jpg"
        a.write_bytes(b"x")
        arquivos.append(a)

    juiz = JuizDeRoteiro([
        _veredito(Resultado.CONFORME, 0.95),  # erra CONFIANTE
        _veredito(Resultado.CONFORME, 0.40),  # erra, mas avisou que não sabia
    ])
    gabarito = {"q0.jpg": Resultado.NAO_CONFORME, "q1.jpg": Resultado.NAO_CONFORME}

    e = rodar(juiz, arquivos, "c", gabarito=gabarito)

    assert e.acertos == 0
    assert len(e.erros_confiantes) == 1
    assert e.erros_confiantes[0].arquivo.name == "q0.jpg"


def test_ensaio_repassa_as_referencias_ao_juiz(tmp_path):
    from farol_agent.ensaio import rodar

    a = tmp_path / "q.jpg"
    a.write_bytes(b"x")
    ref = tmp_path / "espatula.jpg"
    ref.write_bytes(b"x")

    juiz = JuizDeRoteiro([_veredito(Resultado.CONFORME, 0.9)])
    rodar(juiz, [a], "c", referencias=[ref])

    assert juiz.referencias_vistas == [ref]


def test_ensaio_para_na_falha_definitiva(tmp_path):
    from farol_agent.ensaio import rodar

    arquivos = []
    for i in range(5):
        x = tmp_path / f"q{i}.jpg"
        x.write_bytes(b"x")
        arquivos.append(x)

    class JuizQueMorre:
        nome = "morre"

        def __init__(self):
            self.chamadas = 0

        def julgar(self, imagem, criterio, *, contexto=None, referencias=None):
            self.chamadas += 1
            raise ErroDoJuiz("401", recuperavel=False)

    juiz = JuizQueMorre()
    e = rodar(juiz, arquivos, "c")

    assert juiz.chamadas == 1, "não adianta martelar chave recusada em 5 imagens"
    assert len(e.casos) == 1


def test_gabarito_com_resultado_invalido_e_recusado(tmp_path):
    """Gabarito errado contamina toda conclusão tirada dele — e o estrago
    só aparece depois de uma decisão de produto já tomada."""
    from farol_agent.ensaio import carregar_gabarito

    arquivo = tmp_path / "g.json"
    arquivo.write_text('{"a.jpg": "mais ou menos"}', encoding="utf-8")

    with pytest.raises(ValueError, match="não é resultado válido"):
        carregar_gabarito(arquivo)


def test_gabarito_valido_vira_resultado(tmp_path):
    from farol_agent.ensaio import carregar_gabarito

    arquivo = tmp_path / "g.json"
    arquivo.write_text('{"a.jpg": "conforme", "b.jpg": "nao_avaliavel"}',
                       encoding="utf-8")

    g = carregar_gabarito(arquivo)
    assert g["a.jpg"] is Resultado.CONFORME
    assert g["b.jpg"] is Resultado.NAO_AVALIAVEL


def test_sem_gabarito_nao_inventa_acuracia(tmp_path):
    from farol_agent.ensaio import carregar_gabarito, rodar

    a = tmp_path / "q.jpg"
    a.write_bytes(b"x")
    e = rodar(JuizDeRoteiro([_veredito(Resultado.CONFORME, 0.9)]), [a], "c",
              gabarito=carregar_gabarito(None))

    assert e.acuracia is None
    assert e.com_gabarito == []
