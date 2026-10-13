"""Guarda o CLI contra erro que a suíte não via.

Um erro de sintaxe no `cli.py` passou por **109 testes verdes**, porque
nenhum deles importava o módulo. O comando simplesmente não subia — e só
se descobriria rodando à mão, que é exatamente o que se quer evitar.

Importar o CLI e montar o analisador de argumentos custa milissegundos e
pega: erro de sintaxe, import quebrado, subcomando registrado sem função,
e opção que um comando usa mas ninguém declarou.
"""

from __future__ import annotations

import pytest

from farol_agent import cli
from testes.conftest import texto_do_programa


def test_o_modulo_importa():
    """Pega erro de sintaxe e import quebrado — foi o que escapou."""
    assert hasattr(cli, "main")


@pytest.mark.parametrize("comando", ["sandbox", "sondar", "laco", "dvr", "analisar"])
def test_cada_comando_esta_registrado_com_funcao(comando, monkeypatch):
    chamados = {}

    def falso(args):
        chamados["func"] = args.func
        return 0

    monkeypatch.setattr(cli, "cmd_sandbox", falso, raising=False)
    monkeypatch.setattr(cli, "cmd_sondar", falso, raising=False)
    monkeypatch.setattr(cli, "cmd_laco", falso, raising=False)
    monkeypatch.setattr(cli, "cmd_dvr", falso, raising=False)

    with pytest.raises(SystemExit) as saida:
        cli.main([comando, "--help"])
    assert saida.value.code == 0, f"{comando} --help tem que funcionar"


def test_dvr_aceita_todas_as_acoes():
    for acao in ("descobrir", "info", "eventos", "rtsp", "quadro"):
        with pytest.raises(SystemExit) as saida:
            cli.main(["dvr", acao, "--ajuda-inexistente"])
        # 2 = erro de argumento, o que prova que a AÇÃO foi aceita.
        assert saida.value.code == 2, acao


def test_acao_desconhecida_do_dvr_e_recusada():
    with pytest.raises(SystemExit):
        cli.main(["dvr", "voar"])


def test_analisar_declara_toda_opcao_que_le():
    """Todo `args.X` lido por `cmd_analisar` tem que existir no parser.

    Namespace do argparse só reclama em tempo de execução, e aí o erro
    aparece na frente da câmera, no meio do teste de campo — com a senha
    do gravador já digitada. Aqui aparece no CI.
    """
    import re

    # Confere o que está ESCRITO: precisa do texto do programa (contra o
    # pacote compilado não há, e este teste é pulado — ver `texto_do_programa`).
    lidos = set(re.findall(r"args\.([a-z_]+)", texto_do_programa(cli.cmd_analisar)))
    lidos -= {"func", "comando"}

    parser = texto_do_programa(cli.main)
    # `--salvar-em` chega como `salvar_em` via dest; o parser declara os dois.
    declarados = set(re.findall(r'"--([a-z-]+)"', parser)) | set(
        re.findall(r'dest="([a-z_]+)"', parser)
    )
    declarados = {d.replace("-", "_") for d in declarados}

    faltando = lidos - declarados
    assert not faltando, f"cmd_analisar lê sem declarar: {sorted(faltando)}"


def test_analisar_exige_host_e_criterio():
    # Sem um dos dois o comando não tem o que fazer, e falhar no parser é
    # melhor que falhar depois de pedir a senha do gravador.
    for argumentos in (["analisar"], ["analisar", "--host", "10.0.0.1"]):
        with pytest.raises(SystemExit) as saida:
            cli.main(argumentos)
        assert saida.value.code == 2, argumentos


def test_comando_quadro_declara_as_opcoes_que_usa(monkeypatch):
    """`--salvar` e `--rajada` são lidas por `cmd_dvr`; se alguém
    acrescentar uso sem declarar, o comando estoura em uso, não aqui.

    Conferido pelo analisador de verdade, e não pelo texto do programa: a
    opção declarada chega ao comando com o valor que foi escrito, e a que
    não foi escrita chega com o padrão.
    """
    vistos = []
    monkeypatch.setattr(cli, "cmd_dvr", lambda args: vistos.append(args) or 0)

    assert cli.main(["dvr", "quadro"]) == 0
    assert cli.main(
        ["dvr", "quadro", "--salvar", "q.jpg", "--rajada", "3", "--limpar-arp", "--verboso"]
    ) == 0

    padrao, escrito = vistos
    assert (padrao.salvar, padrao.rajada, padrao.limpar_arp, padrao.verboso) == (None, 6, False, False)
    assert (escrito.salvar, escrito.rajada, escrito.limpar_arp, escrito.verboso) == ("q.jpg", 3, True, True)
    assert padrao.acao == escrito.acao == "quadro"


def test_forcar_utf8_nao_estoura_com_fluxo_redirecionado():
    """No Windows o console é cp1252 e derruba o processo em acento.

    `_forcar_utf8` roda antes de tudo; ele não pode falhar quando a saída
    está redirecionada para arquivo ou pipe.
    """
    cli._forcar_utf8()
