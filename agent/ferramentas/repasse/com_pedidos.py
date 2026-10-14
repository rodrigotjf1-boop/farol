"""O teste dos hambúrgueres, segunda rodada (R2): a montagem em SEQUÊNCIA, com os pedidos do Regem como candidatos.

A primeira rodada mostrou que uma foto só não diz qual lanche: num instante aparece uma parte da montagem, e o que
aparece (alface, molho) é comum a muitos lanches. Aqui:

- **uma sequência, e não uma foto:** as paradas da bancada seguidas (a menos de `--juntar-s` uma da outra) são uma
  montagem; vão até `--quadros` recortes dela, em ordem, numa pergunta só — o pão, a carne e o recheio aparecem em
  instantes diferentes;
- **os candidatos são os pedidos:** os lanches pedidos no Regem nos `--antes-min` minutos antes da sequência, pela
  ficha — "qual destes está sendo montado?". Sequência sem pedido com ficha antes dela não é perguntada;
- **o borrão como o agente faz na bancada:** o quadro quieto (toda parada é) sai sem o borrão de rosto quando o
  detector de pessoas do agente não vê ninguém nele, nem um "talvez"; vendo alguém — ou sem detector —, sai borrado.

O resto é da primeira rodada: as fichas iguais viram um lanche só, o custo é a conta do agente e o teto é duro.

Medido na loja em 14/10/2026: as 15 sequências deram "não sei". E o dono contou por quê os pedidos não servem para a
noite de 12/10: no pico, a bancada do canal 4 monta só os pedidos do balcão, e o Regem só tem os de delivery. Os
pedidos valem como candidatos onde a bancada filmada monta o que o Regem recebe; a rodada seguinte
(`ingredientes.py`) pergunta só os ingredientes.

    cd /d C:\\Farol\\agent && set FAROL_MODELOS=C:\\Farol\\agent\\modelos&& .venv\\Scripts\\python.exe -X utf8 <este arquivo>
        <pasta do repasse do canal> --fichas <fichas.json> --pedidos <pedidos.csv> --janela 19:50-20:01
        --teto-centavos 50 [--antes-min 15] [--juntar-s 40] [--quadros 5] [--rodada nome]
"""

from __future__ import annotations

import argparse
import base64
import csv
import json
import os
import re
import sys
from collections import Counter
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Callable

try:
    from ferramentas.repasse import hamburgueres as r2
except ImportError:  # na loja, os dois arquivos soltos na mesma pasta
    import hamburgueres as r2  # type: ignore[no-redef]

import cv2
import numpy as np

from farol_agent.juizes.detector import DUVIDA
from farol_agent.juizes.nuvem import (
    MAX_TOKENS,
    MAX_TOKENS_ESCOLHA_LIVRE,
    MODELO_COM_CONTEXTO,
    PRECO_USD_MTOK,
    _extrair_resposta,
    criar_pedindo_a_ferramenta,
)
from farol_agent.modelos import Frame
from farol_agent.pipeline import recorte

F = "%Y-%m-%d %H:%M:%S"

INSTRUCOES = """\
Você olha a câmera de cima de uma bancada de montagem de hambúrgueres de uma lanchonete. No alto ficam cubas com
ingredientes; à direita, bisnagas de molho; a montagem acontece sobre papel ou dentro da embalagem.

Você recebe algumas imagens da MESMA bancada, em ordem de tempo, durante uma montagem, e a lista dos lanches que
foram pedidos pouco antes, com a ficha de cada um. Olhando SÓ a comida, junte o que aparece nas imagens — o pão, as
carnes, o queijo, as folhas, os molhos — e diga qual daqueles lanches está sendo montado:
- `cena`: "lanche_em_montagem", "lanche_fechado", "sem_lanche" ou "nao_da_para_ver".
- `produto`: o NOME EXATO de um lanche da lista; "outro", se o que se vê não bate com nenhum deles; "nao_sei", se
  não dá para dizer.
- `confianca`: de 0 a 1.
- `ingredientes_vistos`: só os que você VÊ, com o nome da ficha quando der.
- `motivo`: uma frase curta sobre a comida. Não descreva pessoas.

Não invente: se as imagens não mostram o bastante, diga "nao_sei". Responda só pela ferramenta `responder`.
"""


@dataclass
class Pedido:
    hora: datetime
    descricao: str
    quantidade: int


@dataclass
class Pergunta:
    de: str
    ate: str
    paradas: int
    recortes: list[str] = field(default_factory=list)
    candidatos: str = ""
    sem_ficha: str = ""
    cena: str = ""
    produto: str = ""
    confianca: float | None = None
    ingredientes_vistos: str = ""
    motivo: str = ""
    produto_candidato: bool = False
    tokens_entrada: int | None = None
    tokens_saida: int | None = None
    custo_centavos: float | None = None
    borradas: int = 0
    erro: str = ""


# ───────────────────────────── os pedidos ─────────────────────────────


def ler_pedidos(arquivo: Path) -> list[Pedido]:
    with arquivo.open(encoding="utf-8") as f:
        return [Pedido(datetime.strptime(l["hora"], F), l["descricao"].strip(), int(l["quantidade"])) for l in csv.DictReader(f)]


def _chave(texto: str) -> str:
    return " ".join(texto.lower().split())


def nome_na_ficha(descricao: str, nomes: set[str]) -> str | None:
    """O produto da ficha que o item do pedido é. O nome do pedido varia ("Trio 01  + Batata + Refri Lata",
    "TRIOS 01", "NUmero 03", "Numero 09 - 3 Triplo"); o que não se acha pela regra fica sem ficha — nada é suposto."""
    indice = {_chave(n): n for n in nomes}
    d = _chave(descricao)
    if d in indice:
        return indice[d]
    for padrao, forma in ((r"^trios?\s+(\d{1,2})\b", "trio {:02d}"), (r"^n[uú]mero\s+(\d{1,2})\b", "numero {:02d}")):
        achou = re.match(padrao, d)
        if achou:
            return indice.get(forma.format(int(achou.group(1))))
    return None


def candidatos(
    pedidos: list[Pedido], de: datetime, ate: datetime, lanches: list[dict], antes_min: float
) -> tuple[list[tuple[dict, int]], list[str]]:
    """Os lanches pedidos entre `antes_min` antes de `de` e `ate` — pela ficha, um por lanche, com quantos —, e os
    itens pedidos que não têm ficha (para o relatório; não viram candidatos)."""
    do_lanche: dict[str, dict] = {}
    for l in lanches:
        for n in [l["nome"], *(l.get("mesmo_lanche") or [])]:
            do_lanche[n] = l
    contagem: Counter[str] = Counter()
    sem_ficha: Counter[str] = Counter()
    for p in pedidos:
        if not (de - timedelta(minutes=antes_min) <= p.hora <= ate):
            continue
        nome = nome_na_ficha(p.descricao, set(do_lanche))
        if nome is None:
            sem_ficha[p.descricao] += p.quantidade
        else:
            contagem[do_lanche[nome]["nome"]] += p.quantidade
    principais = {l["nome"]: l for l in lanches}
    ordem = sorted(contagem.items(), key=lambda kv: (-kv[1], kv[0].lower()))
    return [(principais[n], q) for n, q in ordem], [f"{d} ×{q}" for d, q in sorted(sem_ficha.items())]


# ───────────────────────────── as sequências ─────────────────────────────


def sequencias(paradas: list[dict], juntar_s: float) -> list[list[dict]]:
    """Paradas seguidas, a menos de `juntar_s` uma da outra, são uma montagem."""
    saida: list[list[dict]] = []
    anterior: datetime | None = None
    for p in sorted(paradas, key=lambda p: p["na_loja"]):
        t = datetime.strptime(p["na_loja"][:19], F)
        if anterior is None or (t - anterior).total_seconds() > juntar_s:
            saida.append([])
        saida[-1].append(p)
        anterior = t
    return saida


def espalhar(seq: list, n: int) -> list:
    """Até `n` itens espalhados pela sequência, com o primeiro e o último."""
    if len(seq) <= n:
        return list(seq)
    if n == 1:
        return [seq[len(seq) // 2]]
    return [seq[round(i * (len(seq) - 1) / (n - 1))] for i in range(n)]


def preparar_da_bancada(
    dados: bytes, pessoas: Callable[[np.ndarray], list[float] | None] | None, *, com_borrao: bool = True,
) -> tuple[str, bool]:
    """O recorte como vai ao modelo, com a regra do agente para a bancada quieta: sem o borrão quando o detector de
    pessoas não vê ninguém, nem um "talvez"; com ele, se vê alguém ou se não há detector (o que não se sabe conta
    como "pode haver alguém").

    `com_borrao=False` é a decisão do dono para o teste da bancada (14/10/2026: "retira o borrão de rosto para não
    atrapalhar"): de cima, as mãos sempre aparecem e o borrão caía na comida (ERR-056). Só por pedido explícito de
    quem chama — a regra de fábrica continua a do agente."""
    img = cv2.imdecode(np.frombuffer(dados, np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("o recorte não é uma imagem")
    pontos = None
    if com_borrao and pessoas is not None:
        try:
            pontos = pessoas(img)
        except Exception:  # noqa: BLE001 — sem a resposta do detector, vale "pode haver alguém"
            pontos = None
    borrar = com_borrao and (pontos is None or any(p >= DUVIDA for p in pontos))
    if borrar:
        img = recorte.borrar_rostos(Frame(img, datetime.min, "repasse"))[0].imagem
    h, w = img.shape[:2]
    escala = min(1.0, r2.LADO_MAXIMO / max(h, w))
    if escala < 1.0:
        img = cv2.resize(img, (max(1, round(w * escala)), max(1, round(h * escala))), interpolation=cv2.INTER_AREA)
    ok, jpg = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 85])
    if not ok:
        raise ValueError("não consegui codificar o recorte")
    return base64.standard_b64encode(jpg.tobytes()).decode("ascii"), borrar


def texto_da_pergunta(de: str, ate: str, cands: list[tuple[dict, int]]) -> str:
    lista = r2.texto_das_fichas([c for c, _ in cands])
    pedidos = ", ".join(f"{c['nome']} ×{q}" for c, q in cands)
    return (
        f"As imagens vão de {de} a {ate}, em ordem. Os lanches pedidos pouco antes ({pedidos}), com as fichas:\n"
        f"{lista}\nQual destes está sendo montado?"
    )


# ───────────────────────────── a rodada ─────────────────────────────


def repassar(
    pasta: Path,
    fichas: dict,
    pedidos: list[Pedido],
    janelas: list[tuple[str, str]],
    cliente: Any,
    *,
    teto_centavos: float,
    pessoas: Callable[[np.ndarray], list[float] | None] | None,
    antes_min: float = 15.0,
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
    seqs = sequencias(r2.nas_janelas(r2.ler_paradas(pasta), janelas), juntar_s)
    perguntas: list[Pergunta] = []
    gasto = 0.0
    ultimo: float | None = None
    erros_seguidos = 0
    motivo_do_fim = "acabaram as sequências das janelas"
    for seq in seqs:
        de, ate = seq[0]["na_loja"][:19], seq[-1]["na_loja"][:19]
        cands, sem_ficha = candidatos(pedidos, datetime.strptime(de, F), datetime.strptime(ate, F), lanches, antes_min)
        q = Pergunta(de=de, ate=ate, paradas=len(seq), candidatos="; ".join(f"{c['nome']} ×{n}" for c, n in cands), sem_ficha="; ".join(sem_ficha))
        perguntas.append(q)
        if not cands:
            q.erro = "sem pedido com ficha antes da sequência"
            continue
        if ultimo is not None and gasto + ultimo > teto_centavos:
            q.erro = "teto"
            motivo_do_fim = f"o teto de {teto_centavos:g} centavos: gastos {gasto:.2f}, e a próxima custaria perto de {ultimo:.2f}"
            break
        imagens = []
        try:
            for p in espalhar(seq, quadros):
                b64, borrou = preparar_da_bancada((pasta / "recortes" / p["recorte"]).read_bytes(), pessoas)
                q.borradas += int(borrou)
                q.recortes.append(p["recorte"])
                imagens.append({"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": b64}})
        except (OSError, ValueError) as e:
            q.erro = f"recorte: {e}"
            continue
        try:
            resposta = criar_pedindo_a_ferramenta(
                cliente,
                ferramenta="responder",
                max_tokens=MAX_TOKENS,
                max_tokens_livre=MAX_TOKENS_ESCOLHA_LIVRE,
                model=modelo,
                system=[{"type": "text", "text": INSTRUCOES, "cache_control": {"type": "ephemeral"}}],
                tools=[r2.FERRAMENTA],
                messages=[{"role": "user", "content": [*imagens, {"type": "text", "text": texto_da_pergunta(de[11:], ate[11:], cands)}]}],
            )
        except Exception as e:  # noqa: BLE001 — a chave recusada para tudo; o resto conta e segue
            q.erro = type(e).__name__
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
        q.tokens_entrada = getattr(uso, "input_tokens", None)
        q.tokens_saida = getattr(uso, "output_tokens", None)
        q.custo_centavos = r2.custo_centavos(modelo, uso, dolar)
        gasto += q.custo_centavos or 0.0
        ultimo = q.custo_centavos
        try:
            dados = _extrair_resposta(resposta)
        except Exception as e:  # noqa: BLE001 — veio sem a ferramenta: é erro desta pergunta, não da rodada
            q.erro = f"sem resposta: {e}"
            continue
        q.cena = str(dados.get("cena") or "")
        q.produto = str(dados.get("produto") or "").strip()
        try:
            q.confianca = max(0.0, min(1.0, float(dados.get("confianca"))))
        except (TypeError, ValueError):
            q.confianca = None
        q.ingredientes_vistos = "; ".join(str(i) for i in (dados.get("ingredientes_vistos") or []))
        q.motivo = str(dados.get("motivo") or "").strip()
        q.produto_candidato = q.produto in {c["nome"] for c, _ in cands}
        dizer(
            f"{de[11:]}–{ate[11:]} · {len(q.recortes)} quadros de {q.paradas} paradas · candidatos: {q.candidatos} · "
            f"{q.cena} · {q.produto or '—'}{'' if q.produto_candidato or q.produto in r2.FORA_DA_LISTA else ' (NÃO É CANDIDATO)'} · "
            f"confiança {q.confianca if q.confianca is not None else '—'} · {q.custo_centavos or 0:.3f} centavo"
            + (f" · borradas {q.borradas}" if q.borradas else "")
        )
    if saida is not None:
        saida.parent.mkdir(parents=True, exist_ok=True)
        with saida.open("w", newline="", encoding="utf-8") as f:
            w = csv.writer(f)
            campos = list(Pergunta.__dataclass_fields__)
            w.writerow(campos)
            for q in perguntas:
                w.writerow(["|".join(getattr(q, c)) if c == "recortes" else getattr(q, c) for c in campos])
    perguntadas = [q for q in perguntas if q.tokens_entrada is not None]
    return {
        "sequencias": len(seqs),
        "semCandidato": sum(1 for q in perguntas if q.erro.startswith("sem pedido")),
        "perguntadas": len(perguntadas),
        "erros": sum(1 for q in perguntas if q.erro and not q.erro.startswith("sem pedido")),
        "gastoCentavos": round(gasto, 4),
        "motivoDoFim": motivo_do_fim,
        "produtos": dict(Counter(q.produto for q in perguntadas if q.produto)),
        "borradas": sum(q.borradas for q in perguntas),
        "perguntas": perguntas,
    }


def pessoas_pelo_detector_do_agente() -> Callable[[np.ndarray], list[float] | None] | None:
    """O detector de pessoas do agente, como a auditoria o monta (o modelo de `FAROL_MODELOS`). `None` = sem detector."""
    from farol_agent.auditoria import _detector_local
    from farol_agent.juizes.detector import OBJETOS

    motor = getattr(_detector_local(), "motor", None)
    if motor is None:
        return None
    return lambda img: [float(p) for p in motor.pontuar(img, OBJETOS["pessoa"])]


def main(argv: list[str] | None = None) -> int:
    if sys.stdout is not None:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    a = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    a.add_argument("pasta", type=Path)
    a.add_argument("--fichas", type=Path, default=Path(r"C:\Farol\agent\fichas.json"))
    a.add_argument("--pedidos", type=Path, required=True)
    a.add_argument("--janela", action="append", required=True)
    a.add_argument("--teto-centavos", type=float, required=True)
    a.add_argument("--antes-min", type=float, default=15.0)
    a.add_argument("--juntar-s", type=float, default=40.0)
    a.add_argument("--quadros", type=int, default=5)
    a.add_argument("--modelo", default=MODELO_COM_CONTEXTO)
    a.add_argument("--rodada", default=datetime.now().strftime("%Y-%m-%d_%H-%M"))
    args = a.parse_args(argv)
    chave = os.environ.get("ANTHROPIC_API_KEY") or ""
    if not chave:
        print("NÃO há chave da plataforma neste usuário: nada foi perguntado")
        return 2
    pessoas = pessoas_pelo_detector_do_agente()
    print(f"detector de pessoas do agente: {'pronto' if pessoas else 'NÃO há — todo recorte vai borrado'}", flush=True)
    import anthropic

    cliente = anthropic.Anthropic(api_key=chave, timeout=60.0, max_retries=2)
    r = repassar(
        args.pasta, json.loads(args.fichas.read_text(encoding="utf-8")), ler_pedidos(args.pedidos),
        [r2.janela(j) for j in args.janela], cliente, teto_centavos=args.teto_centavos, pessoas=pessoas,
        antes_min=args.antes_min, juntar_s=args.juntar_s, quadros=args.quadros, modelo=args.modelo,
        dolar=float(os.environ.get("FAROL_DOLAR", "5.40")),
        saida=args.pasta / "respostas" / f"{args.rodada}.csv", dizer=lambda s: print(s, flush=True),
    )
    print(
        f"FIM: {r['perguntadas']} perguntadas de {r['sequencias']} sequências ({r['semCandidato']} sem pedido com ficha "
        f"antes) · {r['erros']} erro(s) · gasto {r['gastoCentavos']:.3f} centavos · recortes borrados {r['borradas']} · "
        f"por quê parou: {r['motivoDoFim']}",
        flush=True,
    )
    print(f"produtos: {r['produtos']}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
