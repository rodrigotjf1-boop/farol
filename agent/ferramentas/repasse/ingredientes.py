"""O teste dos hambúrgueres, rodadas de ingredientes (R2): o que se vê em CADA lanche da montagem, e as fichas que batem.

O dono, 14/10/2026: "ideal agora no material que separamos [...] e so verificar a identificação dos ingredientes e
pesquisar nas fichas se batem, ainda nao vamos conseguir distinguir trio do sanduiche". E: a câmera do canal 4 vê só
a bancada 1, que no pico monta só os pedidos do balcão — e o Regem, hoje, só tem os de delivery. Pedido não serve de
gabarito para esta noite.

Então o modelo NÃO escolhe o lanche: ele diz só quais ingredientes vê numa sequência da montagem, com os nomes das
fichas da loja. Quais fichas batem — as que têm TODOS os ingredientes vistos — é conta daqui, sem custo.

Medido na terceira rodada (14/10): com dois lanches montados ao mesmo tempo, a lista única misturava os dois e não
batia com ficha nenhuma. Desde a quarta, o modelo dá uma lista para cada lanche, e cada uma é conferida sozinha.

Medido nas rodadas 4 a 6: o nome comercial ("Pão gold mix Prime") não diz ao modelo como o ingrediente é, e o que
separa uma ficha da outra é o pão, a carne e quantas carnes. Desde a sétima:

- **a loja conta como cada ingrediente aparece** (`--da-loja`, um arquivo da loja e não regra daqui): a descrição
  vai ao lado do nome na pergunta. O dono, 14/10: "é um pão de brioche com gergelim mesclado"; "o de 120 é bem maior
  que o de 56, e o blend 150gr é mais deformado, não é simétrico o círculo";
- **as peças se contam:** carne, fatia e fita (a unidade da ficha diz o que é peça). Ficha com MENOS peças do que se
  contou não bate. Molho não se conta — o dono: "a medida em ml não é necessária, o importante é detectar a presença
  do molho e ser similar";
- **o parecido vale:** o mesmo arquivo da loja junta o que é parecido ("molho vermelho": ketchup e geleia de
  pimenta); visto um, a ficha com o outro bate. O modelo que não sabe qual molho é escreve "outro: molho <cor>", e
  isso vale como o grupo daquela cor;
- **a conta das parecidas:** além das fichas que batem, a que fica sozinha na frente quando o ingrediente raro pesa
  mais do que o comum. Ordena; não diz que acertou.

O resto é das rodadas anteriores: a sequência de paradas seguidas, o borrão como o agente faz na bancada quieta, o
custo do agente e o teto duro.

    cd /d C:\\Farol\\agent && .venv\\Scripts\\python.exe -X utf8 <este arquivo>
        <pasta do repasse do canal> --fichas <fichas.json> --janela 19:50-20:01 --teto-centavos 100
        [--da-loja <descricoes-e-parecidos.json>] [--juntar-s 40] [--quadros 5] [--rodada nome]

O arquivo da loja: {"descricoes": {"<ingrediente>": "<como aparece de cima>"},
                    "parecidos": {"<nome do grupo>": ["<ingrediente>", ...]}}
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import os
import re
import sys
from collections import Counter
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any, Callable

try:
    from ferramentas.repasse import com_pedidos as rp
    from ferramentas.repasse import hamburgueres as r2
except ImportError:  # na loja, os arquivos soltos na mesma pasta
    import hamburgueres as r2  # type: ignore[no-redef]
    import com_pedidos as rp  # type: ignore[no-redef]

import numpy as np

from farol_agent.juizes.nuvem import (
    MAX_TOKENS_ESCOLHA_LIVRE,
    MODELO_COM_CONTEXTO,
    PRECO_USD_MTOK,
    _extrair_resposta,
    criar_pedindo_a_ferramenta,
)

INSTRUCOES = """\
Você olha a câmera de cima de uma bancada de montagem de hambúrgueres de uma lanchonete. No alto ficam cubas com
ingredientes; à direita, bisnagas de molho; a montagem acontece sobre papel ou dentro da embalagem.

Você recebe algumas imagens da MESMA bancada, em ordem de tempo. Olhando SÓ os lanches que estão sendo montados — não
as cubas nem as bisnagas —, diga quais ingredientes estão em CADA lanche:
- `cena`: "lanche_em_montagem", "lanche_fechado", "sem_lanche" ou "nao_da_para_ver".
- `lanches`: um item para CADA lanche que está sendo montado — muitas vezes são dois ou três ao mesmo tempo, e o
  ingrediente de um não é do outro. Em cada item: `onde` (esquerda, meio ou direita da imagem) e
  `ingredientes_vistos`, só o que você VÊ naquele lanche, juntando as imagens. Para cada ingrediente: `nome` — o
  nome EXATO da lista abaixo quando ele estiver nela, só o nome, sem a descrição que vem depois do travessão; o que
  não estiver, "outro: <o que é>" — e `quantos`: quantas
  peças dele você vê naquele lanche (discos de carne, fatias, fitas), contando as camadas que aparecem ao longo das
  imagens; 0 quando não der para contar. O pão conta 1 por lanche, mesmo cortado em partes. Nenhum lanche: lista
  vazia. Molho que você vê e não sabe qual é da lista:
  "outro: molho <cor>" (vermelho, branco, amarelo, laranja, marrom, verde, rosado).
- `confianca`: de 0 a 1, sobre as listas que você deu.
- `motivo`: uma frase curta sobre a comida. Não descreva pessoas.

Não invente e não deduza pelo que costuma ir junto: só o que se vê. Responda só pela ferramenta `responder`.

Os ingredientes das fichas desta loja (embalagem fica de fora). Quando a loja contou como o ingrediente aparece, a
descrição vem depois do travessão:
"""

FERRAMENTA: dict[str, Any] = {
    "name": "responder",
    "description": "Os ingredientes que se veem em cada lanche que está sendo montado.",
    "input_schema": {
        "type": "object",
        "properties": {
            "cena": {"type": "string", "enum": list(r2.CENAS)},
            "lanches": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "onde": {"type": "string"},
                        "ingredientes_vistos": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "properties": {"nome": {"type": "string"}, "quantos": {"type": "integer"}},
                                "required": ["nome", "quantos"],
                            },
                        },
                    },
                    "required": ["onde", "ingredientes_vistos"],
                },
            },
            "confianca": {"type": "number"},
            "motivo": {"type": "string"},
        },
        "required": ["cena", "lanches", "confianca", "motivo"],
    },
}


@dataclass
class Lanche:
    """Um lanche da montagem: onde está, o que se viu nele (e quantas peças), as fichas que batem e a que ficou na
    frente na conta das parecidas."""

    onde: str
    vistos: list[str]
    fora: list[str]
    batem: list[tuple[dict, float]]
    quantos: dict[str, int] = field(default_factory=dict)
    frente: dict | None = None
    folga: float = 0.0

    def texto(self) -> str:
        nomes = "; ".join(_nome_com_iguais(l) for l, _ in self.batem[:4])
        vistos = ", ".join(v + (f" ×{self.quantos[_chave(v)]}" if self.quantos.get(_chave(v)) else "")
                           for v in self.vistos)
        return (
            f"{self.onde or '?'}: {vistos or '—'}"
            + (f" (fora da lista: {', '.join(self.fora)})" if self.fora else "")
            + f" → batem {len(self.batem)}" + (f": {nomes}" if nomes else "")
            + (f" · na frente: {_nome_com_iguais(self.frente)} (folga {self.folga:.1f})" if self.frente else "")
        )


@dataclass
class Montagem:
    de: str
    ate: str
    paradas: int
    recortes: list[str] = field(default_factory=list)
    cena: str = ""
    lanches: list[Lanche] = field(default_factory=list)
    confianca: float | None = None
    motivo: str = ""
    tokens_entrada: int | None = None
    tokens_saida: int | None = None
    custo_centavos: float | None = None
    borradas: int = 0
    erro: str = ""


CAMPOS_DO_ARQUIVO = ("de", "ate", "paradas", "recortes", "cena", "lanches", "confianca", "motivo", "tokens_entrada",
                     "tokens_saida", "custo_centavos", "borradas", "erro")

# A lista por lanche é maior que a resposta do agente: na quarta rodada (14/10/2026), 2 de 15 respostas pararam nos
# 300 do agente (ERR-116). O teto aqui é desta ferramenta — e a resposta cortada nele é erro, não dado.
TETO_DE_SAIDA = 1000


def _chave(texto: str) -> str:
    return " ".join(str(texto).lower().split())


def vocabulario(lanches: list[dict]) -> list[str]:
    """Os nomes de ingrediente das fichas, um de cada (sem diferença de maiúscula), na ordem do nome."""
    vistos: dict[str, str] = {}
    for l in lanches:
        for i in l["ingredientes"]:
            vistos.setdefault(_chave(i["nome"]), str(i["nome"]).strip())
    return sorted(vistos.values(), key=lambda n: n.lower())


def separar(
    vistos: list[str], vocab: list[str], grupos: dict[str, str] | None = None
) -> tuple[list[str], list[str]]:
    """Os ingredientes vistos que são da lista (com o nome da lista) e os que não são. O "outro: molho vermelho"
    que tem o nome de um grupo de parecidos da loja vale como o grupo (`grupos`: chave → nome do grupo)."""
    da_lista = {_chave(n): n for n in vocab}
    grupos = grupos or {}
    dentro, fora = [], []
    for v in vistos:
        k = _chave(v)
        sem_outro = _chave(re.sub(r"^\s*outro\s*:\s*", "", str(v), flags=re.IGNORECASE))
        nome = da_lista.get(k) or grupos.get(sem_outro)
        if nome:
            if nome not in dentro:
                dentro.append(nome)
        elif k:
            fora.append(str(v).strip())
    return dentro, fora


def grupos_de_parecidos(grupos: dict[str, list[str]] | None) -> tuple[dict[str, frozenset[str]], dict[str, str]]:
    """O que a loja diz que é parecido: para cada membro e para o nome do grupo, o conjunto de membros; e o nome de
    cada grupo pela chave. Membro em dois grupos fica com o último."""
    parecidos: dict[str, frozenset[str]] = {}
    nomes: dict[str, str] = {}
    for nome, membros in (grupos or {}).items():
        conjunto = frozenset(_chave(m) for m in membros or [] if str(m).strip())
        if not conjunto or not str(nome).strip():
            continue
        nomes[_chave(nome)] = str(nome).strip()
        parecidos[_chave(nome)] = conjunto
        for m in conjunto:
            parecidos[m] = conjunto
    return parecidos, nomes


def texto_do_vocabulario(vocab: list[str], descricoes: dict[str, str] | None = None) -> str:
    """Uma linha por ingrediente; quando a loja contou como ele aparece, a descrição vem depois do travessão."""
    por_chave = {_chave(k): str(v).strip() for k, v in (descricoes or {}).items() if str(v).strip()}
    return "\n".join(f"- {n}" + (f" — {por_chave[_chave(n)]}" if _chave(n) in por_chave else "") for n in vocab)


def descricoes_sem_ingrediente(vocab: list[str], descricoes: dict[str, str] | None) -> list[str]:
    """As descrições cujo nome não está em ficha nenhuma: digitação, ou ingrediente que saiu das fichas."""
    da_lista = {_chave(n) for n in vocab}
    return [k for k in (descricoes or {}) if _chave(k) not in da_lista]


def _so_o_nome(texto: str) -> str:
    """O nome sem a descrição que a pergunta pôs ao lado dele. Medido na loja em 14/10/2026 (rodada 7, ERR-117): o
    modelo copiou a linha inteira da lista — "Carne 56gr — o disco de carne pequeno" — e o nome ficava fora da lista."""
    return re.split(r"\s+—\s+", str(texto), maxsplit=1)[0]


def ler_itens(itens: list[Any]) -> tuple[list[str], dict[str, int]]:
    """Os nomes e as contagens de uma lista de ingredientes vistos. O item em texto, sem contagem, também vale: o
    modelo nem sempre segue o formato. Nome repetido fica com a MAIOR contagem — contar a mais tiraria da lista uma
    ficha certa; contar a menos só deixa mais fichas nela."""
    nomes: list[str] = []
    quantos: dict[str, int] = {}
    for it in itens or []:
        if isinstance(it, dict):
            nome = _so_o_nome(it.get("nome") or "")
            try:
                n = int(it.get("quantos") or 0)
            except (TypeError, ValueError):
                n = 0
        else:
            nome, n = _so_o_nome(it), 0
        if not nome.strip():
            continue
        nomes.append(nome)
        if n > 0:
            k = _chave(nome)
            quantos[k] = max(quantos.get(k, 0), n)
    return nomes, quantos


# As unidades em que a ficha conta PEÇAS que se veem de cima (discos, fatias, fitas). Porção, grama, ml: não.
CONTAVEIS = frozenset({"unidade", "un", "fita", "fatia"})


def _pecas(l: dict) -> dict[str, float]:
    """Quantas peças de cada ingrediente a ficha leva — só onde a unidade é peça."""
    total: dict[str, float] = {}
    for i in l["ingredientes"]:
        if _chave(i.get("unidade") or "") not in CONTAVEIS:
            continue
        try:
            q = float(i.get("quantidade") or 0)
        except (TypeError, ValueError):
            continue
        k = _chave(i["nome"])
        total[k] = total.get(k, 0.0) + q
    return total


def _cabe(
    k: str, quantos: dict[str, int], da_ficha: set[str], pecas: dict[str, float],
    parecidos: dict[str, frozenset[str]],
) -> bool:
    """O ingrediente visto — ou um parecido com ele, para a loja — está na ficha, e não com mais peças do que ela
    leva."""
    return bool(parecidos.get(k, {k}) & da_ficha) and quantos.get(k, 0) <= pecas.get(k, math.inf)


def fichas_que_batem(
    vistos: list[str], lanches: list[dict], quantos: dict[str, int] | None = None,
    parecidos: dict[str, frozenset[str]] | None = None,
) -> list[tuple[dict, float]]:
    """As fichas que têm TODOS os ingredientes vistos (ou um parecido) — e nenhum com menos peças do que se contou —,
    com quanto da ficha foi visto (de 0 a 1), da mais vista para a menos. Sem ingrediente visto, nenhuma: "não vi
    nada" não é "bate com tudo"."""
    if not vistos:
        return []
    alvo = {_chave(v) for v in vistos}
    quantos = quantos or {}
    parecidos = parecidos or {}
    saida = []
    for l in lanches:
        da_ficha = {_chave(i["nome"]) for i in l["ingredientes"]}
        pecas = _pecas(l)
        if all(_cabe(k, quantos, da_ficha, pecas, parecidos) for k in alvo):
            saida.append((l, len(alvo) / len(da_ficha)))
    return sorted(saida, key=lambda t: (-t[1], t[0]["nome"].lower()))


def pesos_por_raridade(lanches: list[dict], parecidos: dict[str, frozenset[str]] | None = None) -> dict[str, float]:
    """O peso de cada ingrediente (e de cada grupo de parecidos): o que está em poucas fichas diz mais do que o que
    está em quase todas."""
    parecidos = parecidos or {}
    n = len(lanches)
    fichas = [{_chave(i["nome"]) for i in l["ingredientes"]} for l in lanches]
    chaves = set().union(*fichas) | set(parecidos)
    return {k: math.log((n + 1) / (sum(1 for f in fichas if parecidos.get(k, {k}) & f) + 0.5)) for k in chaves}


def fichas_parecidas(
    vistos: list[str], lanches: list[dict], peso: dict[str, float], quantos: dict[str, int] | None = None,
    parecidos: dict[str, frozenset[str]] | None = None,
) -> list[tuple[dict, float]]:
    """Todas as fichas, da mais parecida para a menos: soma o peso de cada visto que a ficha tem e tira o de cada um
    que ela não tem (ou tem com menos peças do que se contou). Ordena; não diz que acertou."""
    alvo = {_chave(v) for v in vistos}
    quantos = quantos or {}
    parecidos = parecidos or {}
    saida = []
    for l in lanches:
        da_ficha = {_chave(i["nome"]) for i in l["ingredientes"]}
        pecas = _pecas(l)
        pontos = sum(
            peso.get(k, 0.0) if _cabe(k, quantos, da_ficha, pecas, parecidos) else -peso.get(k, 0.0) for k in alvo
        )
        saida.append((l, pontos))
    return sorted(saida, key=lambda t: (-t[1], t[0]["nome"].lower()))


def na_frente(parecidas: list[tuple[dict, float]]) -> tuple[dict | None, float]:
    """A ficha que ficou SOZINHA na frente, e por quanto. Empate na frente, ou nada a favor: nenhuma."""
    if not parecidas or parecidas[0][1] <= 0:
        return None, 0.0
    folga = parecidas[0][1] - (parecidas[1][1] if len(parecidas) > 1 else 0.0)
    return (parecidas[0][0], folga) if folga > 0 else (None, 0.0)


def _nome_com_iguais(l: dict) -> str:
    mesmo = l.get("mesmo_lanche") or []
    return l["nome"] + (f" (= {', '.join(mesmo)})" if mesmo else "")


def repassar(
    pasta: Path,
    fichas: dict,
    janelas: list[tuple[str, str]],
    cliente: Any,
    *,
    teto_centavos: float,
    pessoas: Callable[[np.ndarray], list[float] | None] | None,
    juntar_s: float = 40.0,
    quadros: int = 5,
    modelo: str = MODELO_COM_CONTEXTO,
    dolar: float = 5.40,
    da_loja: dict | None = None,
    saida: Path | None = None,
    dizer=print,
) -> dict:
    if PRECO_USD_MTOK.get(modelo) is None:
        raise ValueError(f"o modelo {modelo} não tem preço na tabela do agente: sem preço não há teto")
    lanches = r2.agrupar_iguais(r2.produtos_com_ficha(fichas))
    if not lanches:
        raise ValueError("a cópia de fichas não tem nenhum produto com ficha")
    vocab = vocabulario(lanches)
    da_loja = da_loja or {}
    instrucoes = INSTRUCOES + texto_do_vocabulario(vocab, da_loja.get("descricoes"))
    parecidos, nomes_dos_grupos = grupos_de_parecidos(da_loja.get("parecidos"))
    peso = pesos_por_raridade(lanches, parecidos)
    seqs = rp.sequencias(r2.nas_janelas(r2.ler_paradas(pasta), janelas), juntar_s)
    montagens: list[Montagem] = []
    gasto = 0.0
    ultimo: float | None = None
    erros_seguidos = 0
    motivo_do_fim = "acabaram as sequências das janelas"
    for seq in seqs:
        m = Montagem(de=seq[0]["na_loja"][:19], ate=seq[-1]["na_loja"][:19], paradas=len(seq))
        montagens.append(m)
        if ultimo is not None and gasto + ultimo > teto_centavos:
            m.erro = "teto"
            motivo_do_fim = f"o teto de {teto_centavos:g} centavos: gastos {gasto:.2f}, e a próxima custaria perto de {ultimo:.2f}"
            break
        imagens = []
        try:
            for p in rp.espalhar(seq, quadros):
                b64, borrou = rp.preparar_da_bancada((pasta / "recortes" / p["recorte"]).read_bytes(), pessoas)
                m.borradas += int(borrou)
                m.recortes.append(p["recorte"])
                imagens.append({"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": b64}})
        except (OSError, ValueError) as e:
            m.erro = f"recorte: {e}"
            continue
        try:
            resposta = criar_pedindo_a_ferramenta(
                cliente,
                ferramenta="responder",
                max_tokens=TETO_DE_SAIDA,
                max_tokens_livre=MAX_TOKENS_ESCOLHA_LIVRE + TETO_DE_SAIDA,
                model=modelo,
                system=[{"type": "text", "text": instrucoes, "cache_control": {"type": "ephemeral"}}],
                tools=[FERRAMENTA],
                messages=[{"role": "user", "content": [*imagens, {"type": "text", "text": f"A bancada de {m.de[11:]} a {m.ate[11:]}, em ordem. Quais ingredientes estão no lanche?"}]}],
            )
        except Exception as e:  # noqa: BLE001 — a chave recusada para tudo; o resto conta e segue
            m.erro = type(e).__name__
            if r2._definitivo(e):
                motivo_do_fim = f"erro que repetir não resolve: {type(e).__name__}"
                break
            erros_seguidos += 1
            if erros_seguidos >= r2.ERROS_SEGUIDOS:
                motivo_do_fim = f"{erros_seguidos} erros seguidos"
                break
            continue
        erros_seguidos = 0
        uso = getattr(resposta, "usage", None)
        m.tokens_entrada = getattr(uso, "input_tokens", None)
        m.tokens_saida = getattr(uso, "output_tokens", None)
        m.custo_centavos = r2.custo_centavos(modelo, uso, dolar)
        gasto += m.custo_centavos or 0.0
        ultimo = m.custo_centavos
        if getattr(resposta, "stop_reason", None) == "max_tokens":
            m.erro = f"cortada no teto de saída ({m.tokens_saida} tokens)"
            continue
        try:
            dados = _extrair_resposta(resposta)
        except Exception as e:  # noqa: BLE001 — veio sem a ferramenta: é erro desta montagem, não da rodada
            m.erro = f"sem resposta: {e}"
            continue
        m.cena = str(dados.get("cena") or "")
        for item in dados.get("lanches") or []:
            if not isinstance(item, dict):
                continue
            nomes, quantos = ler_itens(item.get("ingredientes_vistos") or [])
            dentro, fora = separar(nomes, vocab, nomes_dos_grupos)
            if not dentro and not fora:
                continue
            frente, folga = na_frente(fichas_parecidas(dentro, lanches, peso, quantos, parecidos))
            m.lanches.append(Lanche(str(item.get("onde") or "").strip(), dentro, fora,
                                    fichas_que_batem(dentro, lanches, quantos, parecidos), quantos, frente, folga))
        try:
            m.confianca = max(0.0, min(1.0, float(dados.get("confianca"))))
        except (TypeError, ValueError):
            m.confianca = None
        m.motivo = str(dados.get("motivo") or "").strip()
        dizer(
            f"{m.de[11:]}–{m.ate[11:]} · {len(m.recortes)} quadros · {m.cena} · "
            + (" | ".join(l.texto() for l in m.lanches) or "nenhum lanche visto")
            + f" · {m.custo_centavos or 0:.3f} centavo" + (f" · borradas {m.borradas}" if m.borradas else "")
        )
    if saida is not None:
        saida.parent.mkdir(parents=True, exist_ok=True)
        with saida.open("w", newline="", encoding="utf-8") as f:
            w = csv.writer(f)
            w.writerow(CAMPOS_DO_ARQUIVO)
            for m in montagens:
                linha = []
                for c in CAMPOS_DO_ARQUIVO:
                    v = getattr(m, c)
                    if c == "recortes":
                        v = "|".join(v)
                    elif c == "lanches":
                        v = " | ".join(l.texto() for l in v)
                    linha.append(v)
                w.writerow(linha)
    lidas = [m for m in montagens if m.tokens_entrada is not None]
    todos = [l for m in lidas for l in m.lanches]
    return {
        "sequencias": len(seqs),
        "perguntadas": len(lidas),
        "erros": sum(1 for m in montagens if m.erro),
        "gastoCentavos": round(gasto, 4),
        "motivoDoFim": motivo_do_fim,
        "cenas": dict(Counter(m.cena for m in lidas if m.cena)),
        "lanches": len(todos),
        "comIngrediente": sum(1 for l in todos if l.vistos),
        "batemUma": sum(1 for l in todos if len(l.batem) == 1),
        "batemVarias": sum(1 for l in todos if len(l.batem) > 1),
        "nenhumaBate": sum(1 for l in todos if l.vistos and not l.batem),
        "comContagem": sum(1 for l in todos if l.quantos),
        "naFrente": sum(1 for l in todos if l.frente is not None),
        "borradas": sum(m.borradas for m in montagens),
        "montagens": montagens,
    }


def main(argv: list[str] | None = None) -> int:
    if sys.stdout is not None:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    a = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    a.add_argument("pasta", type=Path)
    a.add_argument("--fichas", type=Path, default=Path(r"C:\Farol\agent\fichas.json"))
    a.add_argument("--janela", action="append", required=True)
    a.add_argument("--teto-centavos", type=float, required=True)
    a.add_argument("--juntar-s", type=float, default=40.0)
    a.add_argument("--quadros", type=int, default=5)
    a.add_argument("--modelo", default=MODELO_COM_CONTEXTO)
    a.add_argument("--da-loja", type=Path, default=None)
    a.add_argument("--rodada", default=datetime.now().strftime("%Y-%m-%d_%H-%M"))
    args = a.parse_args(argv)
    chave = os.environ.get("ANTHROPIC_API_KEY") or ""
    if not chave:
        print("NÃO há chave da plataforma neste usuário: nada foi perguntado")
        return 2
    fichas = json.loads(args.fichas.read_text(encoding="utf-8"))
    da_loja = json.loads(args.da_loja.read_text(encoding="utf-8")) if args.da_loja else {}
    if da_loja:
        vocab = vocabulario(r2.agrupar_iguais(r2.produtos_com_ficha(fichas)))
        soltas = descricoes_sem_ingrediente(vocab, da_loja.get("descricoes"))
        grupos, _ = grupos_de_parecidos(da_loja.get("parecidos"))
        membros_soltos = sorted({m for k, g in grupos.items() for m in g} - {_chave(n) for n in vocab})
        print(f"da loja: {len(da_loja.get('descricoes') or {})} descrições ({len(soltas)} sem ingrediente nas fichas"
              + (f": {', '.join(soltas)}" if soltas else "") + f") · {len(da_loja.get('parecidos') or {})} grupos de "
              f"parecidos" + (f" (membros fora das fichas: {', '.join(membros_soltos)})" if membros_soltos else ""),
              flush=True)
    pessoas = rp.pessoas_pelo_detector_do_agente()
    print(f"detector de pessoas do agente: {'pronto' if pessoas else 'NÃO há — todo recorte vai borrado'}", flush=True)
    import anthropic

    cliente = anthropic.Anthropic(api_key=chave, timeout=60.0, max_retries=2)
    r = repassar(
        args.pasta, fichas, [r2.janela(j) for j in args.janela], cliente,
        teto_centavos=args.teto_centavos, pessoas=pessoas, juntar_s=args.juntar_s, quadros=args.quadros,
        modelo=args.modelo, dolar=float(os.environ.get("FAROL_DOLAR", "5.40")), da_loja=da_loja,
        saida=args.pasta / "respostas" / f"{args.rodada}.csv", dizer=lambda s: print(s, flush=True),
    )
    print(
        f"FIM: {r['perguntadas']} montagens perguntadas de {r['sequencias']} · {r['erros']} erro(s) · gasto "
        f"{r['gastoCentavos']:.3f} centavos · {r['lanches']} lanches vistos — com ingrediente da lista "
        f"{r['comIngrediente']}, batem com UMA ficha {r['batemUma']}, com várias {r['batemVarias']}, com nenhuma "
        f"{r['nenhumaBate']} · com contagem {r['comContagem']} · uma ficha na frente {r['naFrente']} · recortes "
        f"borrados {r['borradas']} · por quê parou: {r['motivoDoFim']}",
        flush=True,
    )
    print(f"cenas: {r['cenas']}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
