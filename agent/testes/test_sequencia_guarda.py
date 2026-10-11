"""A sequência guardada no computador da loja, com teto e rodízio.

O que tem de ficar provado:

- a grade vira dois arquivos com o mesmo nome (a imagem e a ficha), e a ficha
  devolve o instante de cada número;
- passou do teto, saem as mais ANTIGAS até caber — e a que acabou de entrar
  nunca sai;
- o nome não sai da pasta;
- disco que não grava não deixa meia sequência.
"""

from __future__ import annotations

import json
import os
from datetime import datetime, timedelta
from pathlib import Path

import numpy as np
import pytest

from farol_agent import imagens
from farol_agent.sequencia import guarda as modulo
from farol_agent.sequencia.bloco import QuadroGravado
from farol_agent.sequencia.grade import Grade, montar
from farol_agent.sequencia.guarda import Guarda

DE = datetime(2026, 10, 9, 23, 50, 18)


def grade(tom: int = 90, quadros: int = 6, lado: int = 96) -> Grade:
    """Uma grade pequena, com ruído (para o arquivo não encolher a quase nada)."""
    rng = np.random.default_rng(tom)
    qs = [
        QuadroGravado(i, DE + timedelta(seconds=i / 3), rng.integers(0, 255, (lado, lado, 3), dtype=np.uint8))
        for i in range(quadros)
    ]
    return montar(qs)


def envelhecer(pasta: Path, nome: str, segundos_atras: int) -> None:
    """Põe os arquivos da sequência no passado: é pela data deles que o rodízio escolhe."""
    quando = datetime.now().timestamp() - segundos_atras
    for arq in pasta.glob(f"{nome}.*"):
        os.utime(arq, (quando, quando))


def test_o_teto_e_a_qualidade_de_fabrica_sao_escolha_do_produto():
    assert (modulo.TETO_PADRAO, modulo.QUALIDADE_DO_JPEG) == (200 * 1024 * 1024, 80)
    assert Guarda("x").teto == modulo.TETO_PADRAO


def test_guardar_grava_a_imagem_e_a_ficha_e_ler_devolve_os_instantes(tmp_path: Path):
    pasta = tmp_path / "sequencias"
    g = Guarda(pasta)
    feita = grade()

    imagem = g.guardar("a19-canal4-235018", feita, {"janela": ["23:50:18", "23:50:20"], "desfecho": "mao"})

    assert imagem == pasta / "a19-canal4-235018.jpg"
    assert sorted(a.name for a in pasta.iterdir()) == ["a19-canal4-235018.jpg", "a19-canal4-235018.json"], "sem temporário"
    assert g.imagem_de("a19-canal4-235018") == imagem
    lida = imagens.ler(imagem)
    assert lida is not None and lida.shape == feita.imagem.shape, "a imagem guardada é a grade inteira"

    ficha = g.ler("a19-canal4-235018")
    assert ficha["instantes"] == list(feita.instantes), "os instantes voltam em data e hora"
    assert (ficha["colunas"], ficha["celula"]) == (3, [96, 96])
    assert (ficha["janela"], ficha["desfecho"]) == (["23:50:18", "23:50:20"], "mao"), "o que quem guardou anotou"
    assert abs((datetime.fromisoformat(ficha["guardada_em"]) - datetime.now()).total_seconds()) < 60
    # Em disco, a ficha é JSON simples.
    cru = json.loads((pasta / "a19-canal4-235018.json").read_text(encoding="utf-8"))
    assert cru["instantes"] == [t.isoformat() for t in feita.instantes]


def test_a_anotacao_nao_troca_o_que_e_da_grade(tmp_path: Path):
    g = Guarda(tmp_path)
    feita = grade()
    g.guardar("s1", feita, {"instantes": ["mentira"], "colunas": 99, "celula": [1, 1], "guardada_em": "ontem", "nota": "fica"})
    ficha = g.ler("s1")
    assert ficha["instantes"] == list(feita.instantes) and ficha["colunas"] == 3 and ficha["celula"] == [96, 96]
    assert ficha["guardada_em"] != "ontem" and ficha["nota"] == "fica"
    # Sem anotação nenhuma, também vale.
    g.guardar("s2", feita)
    assert g.ler("s2")["instantes"] == list(feita.instantes)


def test_guardar_de_novo_com_o_mesmo_nome_troca_a_sequencia(tmp_path: Path):
    g = Guarda(tmp_path)
    g.guardar("s1", grade(tom=1), {"vez": 1})
    antes = (tmp_path / "s1.jpg").read_bytes()
    g.guardar("s1", grade(tom=2), {"vez": 2})
    assert g.ler("s1")["vez"] == 2 and (tmp_path / "s1.jpg").read_bytes() != antes
    assert g.nomes() == ["s1"]


def test_o_que_nao_esta_guardado_nao_se_le(tmp_path: Path):
    g = Guarda(tmp_path / "ainda-nao-existe")
    assert (g.ler("nada"), g.imagem_de("nada"), g.tamanho(), g.nomes()) == (None, None, 0, [])

    g = Guarda(tmp_path)
    g.guardar("s1", grade())
    # Ficha estragada, ou sem os instantes, ou com instante que não é hora: não se lê.
    for estrago in ("{", "[]", json.dumps({"colunas": 3}), json.dumps({"instantes": ["não é hora"]}), json.dumps({"instantes": 7})):
        (tmp_path / "s1.json").write_text(estrago, encoding="utf-8")
        assert g.ler("s1") is None, estrago
    # Ficha sem imagem: não é uma sequência.
    g.guardar("s2", grade())
    (tmp_path / "s2.jpg").unlink()
    assert g.ler("s2") is None and g.imagem_de("s2") is None
    # Imagem sem ficha: também não.
    g.guardar("s3", grade())
    (tmp_path / "s3.json").unlink()
    assert g.ler("s3") is None


@pytest.mark.parametrize("nome", ["", ".", "..", "../fora", "a/b", "a\\b", "C:fora", ".escondido", "nome.", "a" * 101, "com espaço", "ação"])
def test_o_nome_nao_sai_da_pasta(tmp_path: Path, nome: str):
    g = Guarda(tmp_path / "sequencias")
    for chamada in (lambda: g.guardar(nome, grade()), lambda: g.ler(nome), lambda: g.imagem_de(nome)):
        with pytest.raises(ValueError, match="nome de sequência"):
            chamada()
    assert not (tmp_path / "sequencias").exists() and list(tmp_path.iterdir()) == []


def test_nomes_que_valem(tmp_path: Path):
    g = Guarda(tmp_path)
    for nome in ("a", "A1", "9", "x" * 100, "evento_12-34.v2", "0b6f3a1e-5d2c-4e8f-9a17-3c4d5e6f7a80"):
        g.guardar(nome, grade())
        assert g.ler(nome) is not None, nome


# ───────────────────────── o teto e o rodízio ─────────────────────────


def test_passou_do_teto_saem_as_mais_antigas_ate_caber(tmp_path: Path):
    solta = Guarda(tmp_path, teto=10**9)
    for i, nome in enumerate(["velha", "media", "nova"]):
        solta.guardar(nome, grade(tom=i))
    envelhecer(tmp_path, "velha", 300)
    envelhecer(tmp_path, "media", 200)
    envelhecer(tmp_path, "nova", 100)
    assert solta.nomes() == ["velha", "media", "nova"], "da mais antiga para a mais nova"
    uma = solta.tamanho() // 3

    # Cabem três e pouco: entrando a quarta, sai só a mais antiga.
    g = Guarda(tmp_path, teto=solta.tamanho() + uma // 2)
    g.guardar("agora", grade(tom=9))
    assert g.nomes() == ["media", "nova", "agora"]
    assert not list(tmp_path.glob("velha.*")), "a imagem e a ficha saem juntas"
    assert g.tamanho() <= g.teto

    # Cabe uma e pouco: saem as antigas, na ordem, até caber.
    g = Guarda(tmp_path, teto=uma + uma // 2)
    g.guardar("mais-uma", grade(tom=10))
    assert g.nomes() == ["mais-uma"] and g.tamanho() <= g.teto


def test_no_teto_exato_nada_sai(tmp_path: Path):
    solta = Guarda(tmp_path, teto=10**9)
    solta.guardar("a", grade(tom=1))
    solta.guardar("b", grade(tom=2))
    envelhecer(tmp_path, "a", 100)
    # Regravar "b" não muda o tamanho: com o teto igual ao que há, as duas ficam.
    g = Guarda(tmp_path, teto=solta.tamanho())
    g.guardar("b", grade(tom=2))
    assert g.tamanho() == g.teto and g.nomes() == ["a", "b"]
    # Um byte a menos, e a antiga sai.
    g = Guarda(tmp_path, teto=solta.tamanho() - 1)
    g.guardar("b", grade(tom=2))
    assert g.nomes() == ["b"]


def test_a_que_acabou_de_entrar_nunca_sai_mesmo_sozinha_acima_do_teto(tmp_path: Path, caplog):
    g = Guarda(tmp_path, teto=100)
    g.guardar("antiga", grade(tom=1))
    envelhecer(tmp_path, "antiga", 100)

    with caplog.at_level("WARNING", logger="farol_agent.sequencia.guarda"):
        g.guardar("grande", grade(tom=2))

    assert g.nomes() == ["grande"] and g.ler("grande") is not None
    assert "continua acima do teto" in caplog.text and "grande" in caplog.text

    # E a mais antiga do rodízio é pela DATA, não pelo nome: "zz" velha sai antes de "aa" nova.
    g = Guarda(tmp_path / "outra", teto=10**9)
    g.guardar("zz", grade(tom=3))
    g.guardar("aa", grade(tom=4))
    envelhecer(tmp_path / "outra", "zz", 500)
    # Cabem duas e meia: entrando a terceira, sai uma — a mais antiga.
    apertada = Guarda(tmp_path / "outra", teto=g.tamanho() + g.tamanho() // 4)
    apertada.guardar("mm", grade(tom=5))
    assert apertada.nomes() == ["aa", "mm"]


def test_dentro_do_teto_o_rodizio_nao_avisa_nem_apaga(tmp_path: Path, caplog):
    g = Guarda(tmp_path, teto=10**9)
    with caplog.at_level("WARNING", logger="farol_agent.sequencia.guarda"):
        g.guardar("a", grade(tom=1))
        envelhecer(tmp_path, "a", 100)
        g.guardar("b", grade(tom=2))
    assert caplog.text == ""
    assert g.nomes() == ["a", "b"]


def test_empate_de_data_sai_pelo_nome_e_arquivo_solto_tambem_entra_na_conta(tmp_path: Path):
    g = Guarda(tmp_path, teto=10**9)
    for nome in ("b", "a", "c"):
        g.guardar(nome, grade(tom=ord(nome)))
    quando = datetime.now().timestamp() - 50
    for arq in tmp_path.iterdir():
        os.utime(arq, (quando, quando))
    assert g.nomes() == ["a", "b", "c"], "na mesma data, a ordem é a do nome"

    # Uma imagem sem ficha (sobra de uma queda de luz) conta no tamanho e sai no rodízio como as outras.
    (tmp_path / "sobra.jpg").write_bytes(b"x" * 5000)
    os.utime(tmp_path / "sobra.jpg", (quando - 100, quando - 100))
    assert g.tamanho() >= 5000 and g.nomes()[0] == "sobra"
    apertada = Guarda(tmp_path, teto=g.tamanho() - 1)
    apertada.guardar("c", grade(tom=ord("c")))
    assert "sobra" not in apertada.nomes() and not (tmp_path / "sobra.jpg").exists()
    # O que não é da guarda (outro tipo de arquivo, uma pasta) não é contado nem apagado.
    (tmp_path / "leia-me.txt").write_text("não é sequência", encoding="utf-8")
    (tmp_path / "pasta.jpg").mkdir()
    antes = g.tamanho()
    Guarda(tmp_path, teto=1).guardar("ultima", grade(tom=1))
    assert (tmp_path / "leia-me.txt").is_file() and (tmp_path / "pasta.jpg").is_dir()
    assert Guarda(tmp_path).nomes() == ["ultima"] and antes > 0


def test_teto_que_nao_e_teto(tmp_path: Path):
    for teto in (0, -1):
        with pytest.raises(ValueError, match="pelo menos um byte"):
            Guarda(tmp_path, teto=teto)
    assert Guarda(tmp_path, teto=1).teto == 1


# ───────────────────────── o disco que falha ─────────────────────────


def test_imagem_que_nao_grava_nao_deixa_ficha_solta(tmp_path: Path, monkeypatch):
    g = Guarda(tmp_path)
    g.guardar("antes", grade(tom=1))
    monkeypatch.setattr(modulo.imagens, "escrever", lambda *a, **k: False)

    with pytest.raises(OSError, match="não consegui gravar a imagem da sequência falhou"):
        g.guardar("falhou", grade(tom=2))

    assert sorted(a.name for a in tmp_path.iterdir()) == ["antes.jpg", "antes.json"], "nem ficha, nem temporário"
    assert g.ler("falhou") is None and g.ler("antes") is not None


def test_arquivo_que_nao_sai_no_rodizio_nao_derruba_quem_guarda(tmp_path: Path, monkeypatch, caplog):
    g = Guarda(tmp_path, teto=10**9)
    g.guardar("presa", grade(tom=1))
    envelhecer(tmp_path, "presa", 100)
    de_verdade = Path.unlink

    def recusar(self, *a, **k):
        if self.name.startswith("presa"):
            raise PermissionError("em uso por outro programa")
        return de_verdade(self, *a, **k)

    monkeypatch.setattr(Path, "unlink", recusar)
    apertada = Guarda(tmp_path, teto=100)
    with caplog.at_level("WARNING", logger="farol_agent.sequencia.guarda"):
        apertada.guardar("nova", grade(tom=2))

    assert "não apaguei presa.jpg do rodízio das sequências" in caplog.text
    assert "não apaguei presa.json do rodízio das sequências" in caplog.text
    assert "continua acima do teto" in caplog.text
    assert apertada.ler("nova") is not None and (tmp_path / "presa.jpg").exists()
