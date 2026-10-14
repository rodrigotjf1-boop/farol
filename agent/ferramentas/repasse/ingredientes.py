"""O teste dos hambúrgueres, rodadas de ingredientes (R2): o que se vê em CADA lanche da montagem, e as fichas que batem.

O dono, 14/10/2026: "ideal agora no material que separamos [...] e so verificar a identificação dos ingredientes e
pesquisar nas fichas se batem, ainda nao vamos conseguir distinguir trio do sanduiche". E: a câmera do canal 4 vê só
a bancada 1, que no pico monta só os pedidos do balcão — e o Regem, hoje, só tem os de delivery. Pedido não serve de
gabarito para esta noite.

Então o modelo NÃO escolhe o lanche: ele diz só quais ingredientes vê numa sequência da montagem, com os nomes das
fichas da loja. Quais fichas batem — as que têm TODOS os ingredientes vistos — é conta daqui, sem custo.

Medido na terceira rodada (14/10): com dois lanches montados ao mesmo tempo, a lista única misturava os dois e não
batia com ficha nenhuma. Desde a quarta, o modelo dá uma lista para cada lanche, e cada uma é conferida sozinha.

O resto é das rodadas anteriores: a sequência de paradas seguidas, o borrão como o agente faz na bancada quieta, o
custo do agente e o teto duro.

    cd /d C:\\Farol\\agent && .venv\\Scripts\\python.exe -X utf8 <este arquivo>
        <pasta do repasse do canal> --fichas <fichas.json> --janela 19:50-20:01 --teto-centavos 100
        [--juntar-s 40] [--quadros 5] [--rodada nome]
"""

from __future__ import annotations

import argparse
import csv
import json
import os
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
  `ingredientes_vistos`, só o que você VÊ naquele lanche, juntando as imagens. Use o nome EXATO da lista abaixo
  quando o ingrediente estiver nela; o que não estiver, escreva "outro: <o que é>". Nenhum lanche: lista vazia.
- `confianca`: de 0 a 1, sobre as listas que você deu.
- `motivo`: uma frase curta sobre a comida. Não descreva pessoas.

Não invente e não deduza pelo que costuma ir junto: só o que se vê. Responda só pela ferramenta `responder`.

Os ingredientes das fichas desta loja (embalagem fica de fora):
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
                        "ingredientes_vistos": {"type": "array", "items": {"type": "string"}},
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
    """Um lanche da montagem: onde está, o que se viu nele e as fichas que batem."""

    onde: str
    vistos: list[str]
    fora: list[str]
    batem: list[tuple[dict, float]]

    def texto(self) -> str:
        nomes = "; ".join(_nome_com_iguais(l) for l, _ in self.batem[:4])
        return (
            f"{self.onde or '?'}: {', '.join(self.vistos) or '—'}"
            + (f" (fora da lista: {', '.join(self.fora)})" if self.fora else "")
            + f" → batem {len(self.batem)}" + (f": {nomes}" if nomes else "")
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


def separar(vistos: list[str], vocab: list[str]) -> tuple[list[str], list[str]]:
    """Os ingredientes vistos que são da lista (com o nome da lista) e os que não são."""
    da_lista = {_chave(n): n for n in vocab}
    dentro, fora = [], []
    for v in vistos:
        k = _chave(v)
        if k in da_lista:
            if da_lista[k] not in dentro:
                dentro.append(da_lista[k])
        elif k:
            fora.append(str(v).strip())
    return dentro, fora


def fichas_que_batem(vistos: list[str], lanches: list[dict]) -> list[tuple[dict, float]]:
    """As fichas que têm TODOS os ingredientes vistos, com quanto da ficha foi visto (de 0 a 1) — da mais vista para
    a menos. Sem ingrediente visto, nenhuma: "não vi nada" não é "bate com tudo"."""
    if not vistos:
        return []
    alvo = {_chave(v) for v in vistos}
    saida = []
    for l in lanches:
        da_ficha = {_chave(i["nome"]) for i in l["ingredientes"]}
        if alvo <= da_ficha:
            saida.append((l, len(alvo) / len(da_ficha)))
    return sorted(saida, key=lambda t: (-t[1], t[0]["nome"].lower()))


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
    saida: Path | None = None,
    dizer=print,
) -> dict:
    if PRECO_USD_MTOK.get(modelo) is None:
        raise ValueError(f"o modelo {modelo} não tem preço na tabela do agente: sem preço não há teto")
    lanches = r2.agrupar_iguais(r2.produtos_com_ficha(fichas))
    if not lanches:
        raise ValueError("a cópia de fichas não tem nenhum produto com ficha")
    vocab = vocabulario(lanches)
    instrucoes = INSTRUCOES + "\n".join(f"- {n}" for n in vocab)
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
            dentro, fora = separar([str(v) for v in (item.get("ingredientes_vistos") or [])], vocab)
            if not dentro and not fora:
                continue
            m.lanches.append(Lanche(str(item.get("onde") or "").strip(), dentro, fora, fichas_que_batem(dentro, lanches)))
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
    a.add_argument("--rodada", default=datetime.now().strftime("%Y-%m-%d_%H-%M"))
    args = a.parse_args(argv)
    chave = os.environ.get("ANTHROPIC_API_KEY") or ""
    if not chave:
        print("NÃO há chave da plataforma neste usuário: nada foi perguntado")
        return 2
    pessoas = rp.pessoas_pelo_detector_do_agente()
    print(f"detector de pessoas do agente: {'pronto' if pessoas else 'NÃO há — todo recorte vai borrado'}", flush=True)
    import anthropic

    cliente = anthropic.Anthropic(api_key=chave, timeout=60.0, max_retries=2)
    r = repassar(
        args.pasta, json.loads(args.fichas.read_text(encoding="utf-8")), [r2.janela(j) for j in args.janela], cliente,
        teto_centavos=args.teto_centavos, pessoas=pessoas, juntar_s=args.juntar_s, quadros=args.quadros,
        modelo=args.modelo, dolar=float(os.environ.get("FAROL_DOLAR", "5.40")),
        saida=args.pasta / "respostas" / f"{args.rodada}.csv", dizer=lambda s: print(s, flush=True),
    )
    print(
        f"FIM: {r['perguntadas']} montagens perguntadas de {r['sequencias']} · {r['erros']} erro(s) · gasto "
        f"{r['gastoCentavos']:.3f} centavos · {r['lanches']} lanches vistos — com ingrediente da lista "
        f"{r['comIngrediente']}, batem com UMA ficha {r['batemUma']}, com várias {r['batemVarias']}, com nenhuma "
        f"{r['nenhumaBate']} · recortes borrados {r['borradas']} · por quê parou: {r['motivoDoFim']}",
        flush=True,
    )
    print(f"cenas: {r['cenas']}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
