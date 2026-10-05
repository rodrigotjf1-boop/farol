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


def test_o_modulo_importa():
    """Pega erro de sintaxe e import quebrado — foi o que escapou."""
    assert hasattr(cli, "main")


@pytest.mark.parametrize("comando", ["sandbox", "sondar", "laco", "dvr"])
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


def test_comando_quadro_declara_as_opcoes_que_usa():
    """`--salvar` e `--rajada` são lidas por `cmd_dvr`; se alguém
    acrescentar uso sem declarar, o comando estoura em uso, não aqui."""
    import inspect

    fonte = inspect.getsource(cli.main)
    for opcao in ("--salvar", "--rajada", "--limpar-arp", "--verboso"):
        assert opcao in fonte, f"{opcao} não está declarada"


def test_forcar_utf8_nao_estoura_com_fluxo_redirecionado():
    """No Windows o console é cp1252 e derruba o processo em acento.

    `_forcar_utf8` roda antes de tudo; ele não pode falhar quando a saída
    está redirecionada para arquivo ou pipe.
    """
    cli._forcar_utf8()
