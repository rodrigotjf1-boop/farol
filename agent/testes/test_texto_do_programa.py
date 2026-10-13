"""O ajudante dos poucos testes que conferem o texto do programa.

Contra o pacote compilado não há texto do agente para ler. O teste que
precisa dele é pulado ali, e só ali: quem roda a suíte contra o módulo
compilado diz isso com `FAROL_PACOTE_COMPILADO=1`. Em qualquer outro lugar,
não achar o texto tem de ser falha — um teste que nunca roda passaria por
verde, e é assim que a guarda some sem ninguém ver.
"""

from __future__ import annotations

import pytest

from testes.conftest import texto_do_programa


def _uma_funcao_com_texto():
    return "estou escrita neste arquivo"


def _funcao_sem_arquivo():
    """Uma função de verdade cujo texto não está em arquivo nenhum.

    É o caso da função do pacote compilado, medido no ensaio de 12/10: pedir
    o texto dela dá `OSError`. (Com `len`, que é do interpretador, dá
    `TypeError` — os dois jeitos de "não há texto" são conferidos.)
    """
    onde: dict = {}
    exec(compile("def sem_arquivo():\n    return 1\n", "<nao-esta-em-disco>", "exec"), onde)
    return onde["sem_arquivo"]


SEM_TEXTO = [pytest.param(len, id="do-interpretador"), pytest.param(_funcao_sem_arquivo(), id="sem-arquivo")]


def _sem_pular(objeto) -> str:
    """Chama o ajudante; se ele PULAR, isto vira falha.

    Sem isto o pulo fora de hora sairia daqui como "teste pulado", que não
    derruba a suíte — justamente o defeito que estes testes guardam.
    """
    try:
        return texto_do_programa(objeto)
    except pytest.skip.Exception:
        pytest.fail("o ajudante pulou o teste onde tinha de falhar ou responder")


def test_os_dois_jeitos_de_nao_haver_texto_sao_os_que_o_python_da():
    # Se um dia o Python mudar o erro, o ajudante deixa de reconhecer a
    # função compilada — e é aqui que isso aparece.
    import inspect

    with pytest.raises(TypeError):
        inspect.getsource(len)
    with pytest.raises(OSError):
        inspect.getsource(_funcao_sem_arquivo())


def test_devolve_o_texto_de_quem_tem_texto(monkeypatch):
    for valor in (None, "1"):
        if valor is None:
            monkeypatch.delenv("FAROL_PACOTE_COMPILADO", raising=False)
        else:
            monkeypatch.setenv("FAROL_PACOTE_COMPILADO", valor)
        texto = _sem_pular(_uma_funcao_com_texto)
        assert "def _uma_funcao_com_texto" in texto
        assert "estou escrita neste arquivo" in texto


@pytest.mark.parametrize("objeto", SEM_TEXTO)
def test_sem_texto_e_sem_o_aviso_do_pacote_compilado_e_falha(monkeypatch, objeto):
    monkeypatch.delenv("FAROL_PACOTE_COMPILADO", raising=False)
    with pytest.raises((OSError, TypeError)):
        _sem_pular(objeto)


@pytest.mark.parametrize("objeto", SEM_TEXTO)
@pytest.mark.parametrize("valor", ["0", "", "sim", "true", "2", "11", " 1"])
def test_so_o_valor_combinado_pula(monkeypatch, valor, objeto):
    # Variável posta por engano, com outro valor, não desliga a guarda.
    monkeypatch.setenv("FAROL_PACOTE_COMPILADO", valor)
    with pytest.raises((OSError, TypeError)):
        _sem_pular(objeto)


@pytest.mark.parametrize("objeto", SEM_TEXTO)
def test_contra_o_pacote_compilado_o_teste_e_pulado_com_o_motivo(monkeypatch, objeto):
    monkeypatch.setenv("FAROL_PACOTE_COMPILADO", "1")
    with pytest.raises(pytest.skip.Exception) as pulo:
        texto_do_programa(objeto)
    assert "pacote compilado" in str(pulo.value)
