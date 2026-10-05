"""O catálogo que resolve a URL do gravador."""

from __future__ import annotations

import pytest

from farol_agent.perfis import achar


def test_acha_o_modelo_exato_e_ele_esta_verificado():
    p = achar("intelbras", "MHDX 3116-C")
    assert p is not None
    assert p.verificado, "foi medido num aparelho real em 05/10/2026"
    assert p.canais == 16
    assert p.evento_religa, "a transmissão fecha a cada evento"


def test_modelo_desconhecido_cai_no_generico_do_fabricante():
    """Recusar por não ter o modelo na lista travaria instalação à toa.

    Gravador Dahua desconhecido quase sempre fala o dialeto Dahua. Quem
    usa o genérico sabe, porque `verificado` é falso.
    """
    p = achar("dahua", "XVR-QUE-NAO-EXISTE")
    assert p is not None
    assert p.modelo is None
    assert not p.verificado


def test_fabricante_desconhecido_devolve_nada():
    assert achar("marca-inventada") is None


def test_url_main_e_sub_do_mhdx():
    p = achar("intelbras", "MHDX 3116-C")
    comum = dict(host="192.168.1.108", usuario="admin", senha="x", canal=11)

    assert p.url(**comum).endswith("/cam/realmonitor?channel=11&subtype=0")
    assert p.url(**comum, sub=True).endswith("subtype=1")


def test_senha_com_caractere_especial_e_escapada():
    """@ ou / na senha quebraria a URL e o login falharia sem explicação."""
    p = achar("intelbras", "MHDX 3116-C")
    url = p.url(host="h", usuario="admin", senha="a@b/c", canal=1)

    assert "a%40b%2Fc" in url
    assert url.count("@") == 1


def test_canal_zero_e_recusado():
    p = achar("dahua")
    with pytest.raises(ValueError, match="canal"):
        p.url(host="h", usuario="u", senha="s", canal=0)


def test_hikvision_usa_o_proprio_dialeto():
    p = achar("hikvision")
    url = p.url(host="h", usuario="u", senha="s", canal=3)
    assert "/Streaming/Channels/301" in url
