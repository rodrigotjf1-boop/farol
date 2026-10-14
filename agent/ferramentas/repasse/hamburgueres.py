"""O teste dos hambúrgueres (R2 do repasse): as paradas da bancada perto dos pedidos, perguntadas a um modelo que vê.

Lê o que o leitor (R1) deixou na pasta do repasse — `paradas.csv` e os recortes —, escolhe as paradas das janelas
pedidas (a hora do pedido no Regem diz onde procurar) e pergunta, a cada uma, com as fichas da loja: o que está na
bancada? É um dos lanches da lista? Qual? Que ingredientes se veem?

**O que é do agente, e não daqui:** o modelo de rotina (o mesmo que, ao vivo, pergunta com contexto), a chamada
pela ferramenta forçada, a leitura da resposta, a conta do custo e o borrão de rosto — importados, como estão.

**O teto é duro:** antes de cada pergunta, se o gasto mais o custo da pergunta anterior passar do teto, para. Modelo
sem preço na tabela do agente não roda (sem preço não há teto). Chave recusada para tudo.

**Imagem de loja:** o recorte vai ao modelo como vão as análises pagas de sempre — da loja, com a chave da loja.
Se o borrão de rosto do agente achar rosto no recorte, vai o borrado. O que o modelo escreve (`motivo`) fica no
arquivo da loja e não é impresso.

    cd /d C:\\Farol\\agent && .venv\\Scripts\\python.exe -X utf8 <este arquivo>
        <pasta do repasse do canal> --fichas <fichas.json> --janela 19:50-20:01 --janela 22:50-22:59
        [--teto-centavos 100] [--modelo claude-haiku-5-5] [--rodada nome]
"""

from __future__ import annotations

import argparse
import base64
import csv
import json
import os
import sys
from collections import Counter
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from types import SimpleNamespace
from typing import Any

try:
    import farol_agent  # noqa: F401
except ImportError:  # na loja, rodando como arquivo solto
    sys.path.insert(0, r"C:\Farol\agent")

import cv2
import numpy as np

from farol_agent.juizes.nuvem import (
    MAX_TOKENS,
    MAX_TOKENS_ESCOLHA_LIVRE,
    MODELO_COM_CONTEXTO,
    PRECO_USD_MTOK,
    JuizNuvem,
    _extrair_resposta,
    criar_pedindo_a_ferramenta,
)
from farol_agent.modelos import Frame
from farol_agent.pipeline import recorte

# O lado maior da imagem que vai ao modelo: o teto dos modelos de resolução comum.
LADO_MAXIMO = 1568
# Quantos erros seguidos de API (que não sejam recusa da chave) fazem parar.
ERROS_SEGUIDOS = 3
# O que o modelo diz da cena.
CENAS = ("lanche_em_montagem", "lanche_fechado", "sem_lanche", "nao_da_para_ver")
FORA_DA_LISTA = ("outro", "nao_sei")

INSTRUCOES = """\
Você olha a câmera de cima de uma bancada de montagem de hambúrgueres de uma lanchonete. No alto da imagem ficam
cubas com ingredientes; à direita, bisnagas de molho; no meio, a folha onde o lanche é montado.

Diga o que está sobre a bancada, olhando SÓ a comida:
- `cena`: "lanche_em_montagem" (o lanche aberto, com o que vai dentro à vista), "lanche_fechado" (o pão de cima já
  posto: o recheio não se vê), "sem_lanche" ou "nao_da_para_ver" (mão ou objeto na frente, imagem escura).
- `produto`: o NOME EXATO de um lanche da lista abaixo, se o que se vê bate com a ficha dele; "outro", se é um lanche
  que não bate com nenhum da lista; "nao_sei", se não dá para dizer. Lanche fechado quase sempre é "nao_sei" — a
  menos que o pão, sozinho, já diga qual é.
- `confianca`: de 0 a 1.
- `ingredientes_vistos`: só os que você VÊ na imagem, com o nome da ficha quando der.
- `motivo`: uma frase curta sobre a comida. Não descreva pessoas.

Não invente: se não dá para ver, diga que não dá. Responda só pela ferramenta `responder`.

As fichas dos lanches desta loja (embalagem fica de fora):
"""

FERRAMENTA: dict[str, Any] = {
    "name": "responder",
    "description": "O que está sobre a bancada, olhando só a comida.",
    "input_schema": {
        "type": "object",
        "properties": {
            "cena": {"type": "string", "enum": list(CENAS)},
            "produto": {"type": "string"},
            "confianca": {"type": "number"},
            "ingredientes_vistos": {"type": "array", "items": {"type": "string"}},
            "motivo": {"type": "string"},
        },
        "required": ["cena", "produto", "confianca", "ingredientes_vistos", "motivo"],
    },
}


@dataclass
class Resposta:
    na_loja: str
    recorte: str
    cena: str = ""
    produto: str = ""
    confianca: float | None = None
    ingredientes_vistos: str = ""
    motivo: str = ""
    produto_da_lista: bool = False
    modelo: str = ""
    tokens_entrada: int | None = None
    tokens_saida: int | None = None
    custo_centavos: float | None = None
    borrou: bool = False
    erro: str = ""


# ───────────────────────────── o que perguntar ─────────────────────────────


def ler_paradas(pasta: Path) -> list[dict]:
    with (pasta / "paradas.csv").open(encoding="utf-8") as f:
        return list(csv.DictReader(f))


def janela(texto: str) -> tuple[str, str]:
    """"19:50-20:01" -> ("19:50:00", "20:01:00")."""
    de, ate = (t.strip() for t in texto.split("-"))
    for t in (de, ate):
        datetime.strptime(t, "%H:%M")
    return f"{de}:00", f"{ate}:00"


def nas_janelas(paradas: list[dict], janelas: list[tuple[str, str]]) -> list[dict]:
    """As paradas cuja hora NA LOJA cai em alguma janela [de, ate) — na ordem da hora."""
    escolhidas = [p for p in paradas if p.get("recorte") and any(de <= p["na_loja"][11:19] < ate for de, ate in janelas)]
    return sorted(escolhidas, key=lambda p: p["na_loja"])


def produtos_com_ficha(fichas: dict) -> list[dict]:
    """Os produtos da cópia de fichas da loja que têm ficha, com os ingredientes — na ordem do nome."""
    base = fichas.get("base", fichas) if isinstance(fichas, dict) else {}
    saida = []
    for p in base.get("produtos") or []:
        if not isinstance(p, dict) or not p.get("ficha"):
            continue
        itens = [i for i in (p["ficha"].get("ingredientes") or []) if isinstance(i, dict) and i.get("nome")]
        saida.append({"nome": str(p.get("nome") or "").strip(), "categoria": str(p.get("categoria") or ""), "ingredientes": itens})
    return sorted((p for p in saida if p["nome"]), key=lambda p: p["nome"].lower())


def agrupar_iguais(produtos: list[dict]) -> list[dict]:
    """Produtos com a MESMA ficha — os mesmos ingredientes, nas mesmas quantidades — são o mesmo lanche.

    Na loja do piloto o TRIO 01 leva o sanduíche do Numero 01 (fichas de 14/10/2026): o modelo vê o sanduíche, e
    não teria como escolher entre dois nomes para ele. Fica um nome por lanche — o que não é trio, quando há —, e
    os outros vão junto, como "o mesmo lanche vai em".
    """
    grupos: dict[tuple, list[dict]] = {}
    for p in produtos:
        chave = tuple(sorted(
            (str(i["nome"]).strip().lower(), str(i.get("quantidade")), str(i.get("unidade") or "").strip().lower())
            for i in p["ingredientes"]
        ))
        grupos.setdefault(chave, []).append(p)
    saida = []
    for membros in grupos.values():
        membros.sort(key=lambda p: (p["nome"].upper().startswith("TRIO"), p["nome"].lower()))
        principal = dict(membros[0])
        principal["mesmo_lanche"] = [n for n in dict.fromkeys(m["nome"] for m in membros[1:]) if n != principal["nome"]]
        saida.append(principal)
    return sorted(saida, key=lambda p: p["nome"].lower())


def texto_das_fichas(produtos: list[dict]) -> str:
    linhas = []
    for p in produtos:
        partes = []
        for i in p["ingredientes"]:
            q = i.get("quantidade")
            u = i.get("unidade") or ""
            partes.append(f"{i['nome']} ({q:g} {u})".replace(" )", ")") if isinstance(q, (int, float)) else str(i["nome"]))
        mesmo = p.get("mesmo_lanche") or []
        linhas.append(f"- {p['nome']}" + (f" (o mesmo lanche vai em: {', '.join(mesmo)})" if mesmo else "") + ": " + "; ".join(partes))
    return "\n".join(linhas)


def preparar_imagem(dados: bytes) -> tuple[str, bool, tuple[int, int]]:
    """O recorte como vai ao modelo: com o borrão de rosto do agente, no lado maior de até `LADO_MAXIMO`, em JPEG."""
    img = cv2.imdecode(np.frombuffer(dados, np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("o recorte não é uma imagem")
    f, borrou = recorte.borrar_rostos(Frame(img, datetime.min, "repasse"))
    img = f.imagem
    h, w = img.shape[:2]
    escala = min(1.0, LADO_MAXIMO / max(h, w))
    if escala < 1.0:
        img = cv2.resize(img, (max(1, round(w * escala)), max(1, round(h * escala))), interpolation=cv2.INTER_AREA)
    ok, jpg = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 85])
    if not ok:
        raise ValueError("não consegui codificar o recorte")
    return base64.standard_b64encode(jpg.tobytes()).decode("ascii"), bool(borrou), (img.shape[1], img.shape[0])


def custo_centavos(modelo: str, uso: Any, dolar: float) -> float | None:
    """A conta do agente (`JuizNuvem._custo`), com o dólar dado."""
    return JuizNuvem._custo(SimpleNamespace(dolar=dolar), modelo, uso)


# ───────────────────────────── a pergunta ─────────────────────────────


def perguntar(cliente: Any, modelo: str, instrucoes: str, b64: str, hora: str) -> Any:
    return criar_pedindo_a_ferramenta(
        cliente,
        ferramenta="responder",
        max_tokens=MAX_TOKENS,
        max_tokens_livre=MAX_TOKENS_ESCOLHA_LIVRE,
        model=modelo,
        system=[{"type": "text", "text": instrucoes, "cache_control": {"type": "ephemeral"}}],
        tools=[FERRAMENTA],
        messages=[{
            "role": "user",
            "content": [
                {"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": b64}},
                {"type": "text", "text": f"A bancada às {hora}. O que está sendo montado?"},
            ],
        }],
    )


def _definitivo(e: Exception) -> bool:
    """Erro que repetir não resolve: chave recusada, sem permissão, pedido torto, modelo que não existe."""
    return type(e).__name__ in ("AuthenticationError", "PermissionDeniedError", "BadRequestError", "NotFoundError")


def repassar(
    pasta: Path,
    fichas: dict,
    janelas: list[tuple[str, str]],
    cliente: Any,
    *,
    teto_centavos: float,
    modelo: str = MODELO_COM_CONTEXTO,
    dolar: float = 5.40,
    saida: Path | None = None,
    dizer=print,
) -> dict:
    """Pergunta, parada a parada, até o fim das janelas ou o teto. Escreve `respostas.csv` em `saida`."""
    if PRECO_USD_MTOK.get(modelo) is None:
        raise ValueError(f"o modelo {modelo} não tem preço na tabela do agente: sem preço não há teto")
    produtos = agrupar_iguais(produtos_com_ficha(fichas))
    if not produtos:
        raise ValueError("a cópia de fichas não tem nenhum produto com ficha")
    nomes = {p["nome"] for p in produtos} | {n for p in produtos for n in p.get("mesmo_lanche") or []}
    instrucoes = INSTRUCOES + texto_das_fichas(produtos)
    escolhidas = nas_janelas(ler_paradas(pasta), janelas)
    respostas: list[Resposta] = []
    gasto = 0.0
    ultimo: float | None = None
    erros_seguidos = 0
    motivo_do_fim = "acabaram as paradas das janelas"
    for p in escolhidas:
        if ultimo is not None and gasto + ultimo > teto_centavos:
            motivo_do_fim = f"o teto de {teto_centavos:g} centavos: gastos {gasto:.2f}, e a próxima custaria perto de {ultimo:.2f}"
            break
        r = Resposta(na_loja=p["na_loja"], recorte=p["recorte"], modelo=modelo)
        respostas.append(r)
        try:
            b64, r.borrou, _ = preparar_imagem((pasta / "recortes" / p["recorte"]).read_bytes())
        except (OSError, ValueError) as e:
            r.erro = f"recorte: {e}"
            continue
        try:
            resposta = perguntar(cliente, modelo, instrucoes, b64, p["na_loja"][11:19])
        except Exception as e:  # noqa: BLE001 — a chave recusada para tudo; o resto conta e segue
            r.erro = type(e).__name__
            if _definitivo(e):
                motivo_do_fim = f"erro que repetir não resolve: {type(e).__name__}"
                break
            erros_seguidos += 1
            if erros_seguidos >= ERROS_SEGUIDOS:
                motivo_do_fim = f"{erros_seguidos} erros seguidos"
                break
            continue
        erros_seguidos = 0
        uso = getattr(resposta, "usage", None)
        r.tokens_entrada = getattr(uso, "input_tokens", None)
        r.tokens_saida = getattr(uso, "output_tokens", None)
        r.custo_centavos = custo_centavos(modelo, uso, dolar)
        gasto += r.custo_centavos or 0.0
        ultimo = r.custo_centavos
        try:
            dados = _extrair_resposta(resposta)
        except Exception as e:  # noqa: BLE001 — veio sem a ferramenta: é erro desta parada, não da rodada
            r.erro = f"sem resposta: {e}"
            continue
        r.cena = str(dados.get("cena") or "")
        r.produto = str(dados.get("produto") or "").strip()
        try:
            r.confianca = max(0.0, min(1.0, float(dados.get("confianca"))))
        except (TypeError, ValueError):
            r.confianca = None
        r.ingredientes_vistos = "; ".join(str(i) for i in (dados.get("ingredientes_vistos") or []))
        r.motivo = str(dados.get("motivo") or "").strip()
        r.produto_da_lista = r.produto in nomes
        dizer(
            f"{r.na_loja[11:19]} · {r.cena} · {r.produto or '—'}{'' if r.produto_da_lista or r.produto in FORA_DA_LISTA else ' (FORA DA LISTA)'} · "
            f"confiança {r.confianca if r.confianca is not None else '—'} · {r.custo_centavos or 0:.3f} centavo" + (" · borrado" if r.borrou else "")
        )
    if saida is not None:
        saida.parent.mkdir(parents=True, exist_ok=True)
        with saida.open("w", newline="", encoding="utf-8") as f:
            w = csv.writer(f)
            campos = list(Resposta.__dataclass_fields__)
            w.writerow(campos)
            for r in respostas:
                w.writerow([getattr(r, c) for c in campos])
    produtos_vistos = Counter(r.produto for r in respostas if r.produto)
    return {
        "paradasNasJanelas": len(escolhidas),
        "perguntadas": sum(1 for r in respostas if r.tokens_entrada is not None),
        "erros": sum(1 for r in respostas if r.erro),
        "gastoCentavos": round(gasto, 4),
        "motivoDoFim": motivo_do_fim,
        "cenas": dict(Counter(r.cena for r in respostas if r.cena)),
        "produtos": dict(produtos_vistos),
        "borradas": sum(1 for r in respostas if r.borrou),
        "respostas": respostas,
    }


def main(argv: list[str] | None = None) -> int:
    if sys.stdout is not None:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    a = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    a.add_argument("pasta", type=Path)
    a.add_argument("--fichas", type=Path, default=Path(r"C:\Farol\agent\fichas.json"))
    a.add_argument("--janela", action="append", required=True)
    a.add_argument("--teto-centavos", type=float, required=True)
    a.add_argument("--modelo", default=MODELO_COM_CONTEXTO)
    a.add_argument("--rodada", default=datetime.now().strftime("%Y-%m-%d_%H-%M"))
    args = a.parse_args(argv)
    chave = os.environ.get("ANTHROPIC_API_KEY") or ""
    if not chave:
        print("NÃO há chave da plataforma neste usuário: nada foi perguntado")
        return 2
    import anthropic

    cliente = anthropic.Anthropic(api_key=chave, timeout=60.0, max_retries=2)
    r = repassar(
        args.pasta, json.loads(args.fichas.read_text(encoding="utf-8")), [janela(j) for j in args.janela], cliente,
        teto_centavos=args.teto_centavos, modelo=args.modelo, dolar=float(os.environ.get("FAROL_DOLAR", "5.40")),
        saida=args.pasta / "respostas" / f"{args.rodada}.csv", dizer=lambda s: print(s, flush=True),
    )
    print(
        f"FIM: {r['perguntadas']} perguntadas de {r['paradasNasJanelas']} paradas nas janelas · {r['erros']} erro(s) · "
        f"gasto {r['gastoCentavos']:.3f} centavos · borradas {r['borradas']} · por quê parou: {r['motivoDoFim']}",
        flush=True,
    )
    print(f"cenas: {r['cenas']} · produtos: {r['produtos']}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
