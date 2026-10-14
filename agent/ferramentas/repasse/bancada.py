"""O teste dos hambúrgueres, a bancada com memória (R2, rodada 9): a tabela de itens que o dono desenhou.

O dono, 14/10/2026: "o frame detecta que o colaborador coloque 5 pares de tampos de pães, então logicamente está
produzindo 5 hambúrgueres e serão 5 fichas, já teria uma tabela com 5 colunas item 1, item 2 [...] depois iria
adicionando ingredientes em cada item conforme detectar nos frames [...] e ao final vai filtrando as fichas". E:
"ao montar os ingredientes o colaborador coloca um tampo sobre o outro, o que permite ver mais detalhes do pão ao fim
da montagem"; e o Numero 08, "o único sanduíche que leva 3 anéis de cebola, vai bacon, ovo [...] ou ao menos
detectar [...] 10 ingredientes detectados de 11 (pão não definido)".

Então, em cada montagem (as paradas seguidas da bancada, em pedaços de no máximo `--max-s`):

- os quadros vão UM A UM, em ordem, e cada pergunta leva a TABELA como está: item 1, item 2... com o que cada um já
  tem e quantas peças;
- o modelo devolve a tabela depois daquele quadro. A memória é daqui: o nome que entrou não sai, a contagem não
  diminui (a camada coberta continua lá), o pão visto no fechamento fica e o item fechado não reabre;
- no fim, cada item vai às fichas: as que batem (todos os vistos, nenhuma peça a mais), as mais parecidas com "N de M
  ingredientes da ficha vistos" e, no item fechado, a ficha de contagem exata.

O resto é das rodadas anteriores: o arquivo da loja (descrições e parecidos), o borrão como o agente faz na bancada
quieta, o custo do agente, o teto duro, a resposta cortada como erro.

    cd /d C:\\Farol\\agent && .venv\\Scripts\\python.exe -X utf8 <este arquivo>
        <pasta do repasse do canal> --fichas <fichas.json> --janela 19:50-20:01 --teto-centavos 100
        [--da-loja <arquivo>] [--juntar-s 300] [--max-s 1200] [--intervalo-s 20] [--quadros 40] [--rodada nome]
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
    from ferramentas.repasse import ingredientes as ri
except ImportError:  # na loja, os arquivos soltos na mesma pasta
    import hamburgueres as r2  # type: ignore[no-redef]
    import com_pedidos as rp  # type: ignore[no-redef]
    import ingredientes as ri  # type: ignore[no-redef]

import numpy as np

from farol_agent.juizes.nuvem import (
    MAX_TOKENS_ESCOLHA_LIVRE,
    MODELO_COM_CONTEXTO,
    PRECO_USD_MTOK,
    _extrair_resposta,
    criar_pedindo_a_ferramenta,
)

F = "%Y-%m-%d %H:%M:%S"

INSTRUCOES = """\
Você olha a câmera de cima de uma bancada de montagem de hambúrgueres de uma lanchonete. No alto ficam cubas com
ingredientes; à direita, bisnagas de molho; a montagem acontece sobre papel ou dentro da embalagem.

A rotina da bancada: o colaborador abre os pães que vai montar — um par, base e tampo, para cada lanche —, põe os
ingredientes sobre cada base e, ao terminar, põe o tampo por cima. É no fechamento que o pão aparece melhor.

Você recebe UMA imagem da bancada e a TABELA dos lanches desta montagem como estava até a imagem anterior. Devolva a
tabela DEPOIS desta imagem:
- `itens`: um item para cada lanche, numerados da esquerda para a direita como na tabela; lanche novo (mais um par de
  pão aberto) ganha o próximo número. Em cada item:
  - `ingredientes`: TUDO o que o lanche já tem — o que estava na tabela, mais o que apareceu nesta imagem. Para cada
    um: `nome` — o nome EXATO da lista abaixo, só o nome, sem a descrição que vem depois do travessão; o que não
    estiver na lista, "outro: <o que é>"; molho que você vê e não sabe qual é, "outro: molho <cor>" — e `quantos`:
    quantas peças ele tem no total (discos de carne, fatias, fitas, anéis). A camada coberta por outra continua
    contando. 0 quando não der para contar. O pão não entra aqui.
  - `pao`: o nome do pão da lista assim que der para ver qual é — pela base aberta ou, melhor, pelo tampo no
    fechamento; senão, "".
  - `fechado`: true quando o tampo já está por cima.
  O lanche que fechou e saiu da bancada fica na tabela como está: não precisa repeti-lo. Pão aberto num lugar onde
  antes havia um lanche que saiu é lanche novo.
- `cena`: "lanche_em_montagem", "lanche_fechado", "sem_lanche" ou "nao_da_para_ver".
- `motivo`: uma frase curta sobre a comida. Não descreva pessoas.

Não invente e não deduza pelo que costuma ir junto: só o que se vê nesta imagem ou já estava na tabela. Responda só
pela ferramenta `responder`.

Os ingredientes das fichas desta loja (embalagem fica de fora). Quando a loja contou como o ingrediente aparece, a
descrição vem depois do travessão:
"""

FERRAMENTA: dict[str, Any] = {
    "name": "responder",
    "description": "A tabela dos lanches desta montagem depois da imagem.",
    "input_schema": {
        "type": "object",
        "properties": {
            "cena": {"type": "string", "enum": list(r2.CENAS)},
            "itens": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "item": {"type": "integer"},
                        "ingredientes": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "properties": {"nome": {"type": "string"}, "quantos": {"type": "integer"}},
                                "required": ["nome", "quantos"],
                            },
                        },
                        "pao": {"type": "string"},
                        "fechado": {"type": "boolean"},
                    },
                    "required": ["item", "ingredientes", "pao", "fechado"],
                },
            },
            "motivo": {"type": "string"},
        },
        "required": ["cena", "itens", "motivo"],
    },
}

# A tabela inteira volta a cada quadro: cinco lanches com oito ingredientes cada passam fácil dos 1.000 da rodada
# anterior. O teto é desta ferramenta (V114), e a resposta cortada nele é erro.
TETO_DE_SAIDA = 1500


@dataclass
class Item:
    """Um lanche da tabela: o que ele já tem, quantas peças, o pão e se fechou."""

    numero: int
    nomes: dict[str, str] = field(default_factory=dict)
    quantos: dict[str, int] = field(default_factory=dict)
    pao: str = ""
    pao_no_fechamento: bool = False
    fechado: bool = False
    visto_em: int = 0
    ultimo_quadro: str = ""

    def juntar(self, nomes: list[str], quantos: dict[str, int], pao: str, fechado: bool) -> None:
        """A memória da tabela: o nome que entrou não sai, a contagem não diminui (a camada coberta continua lá), o
        pão visto no fechamento fica e o item fechado não reabre."""
        for n in nomes:
            self.nomes.setdefault(ri._chave(n), n.strip())
        for k, q in quantos.items():
            self.quantos[k] = max(self.quantos.get(k, 0), q)
        pao = ri._so_o_nome(pao).strip()
        if pao and (fechado or not self.pao_no_fechamento):
            self.pao = pao
            self.pao_no_fechamento = self.pao_no_fechamento or fechado
        self.fechado = self.fechado or fechado
        self.visto_em += 1

    def texto(self) -> str:
        partes = [n + (f" ×{self.quantos[k]}" if self.quantos.get(k) else "") for k, n in self.nomes.items()]
        return (
            f"item {self.numero}: " + ("; ".join(partes) or "só o pão aberto")
            + f" · pão: {self.pao or 'não definido'}" + (" · fechado" if self.fechado else "")
        )


def texto_da_tabela(itens: list[Item]) -> str:
    if not itens:
        return "A tabela até a imagem anterior: nenhum lanche ainda."
    return "A tabela até a imagem anterior:\n" + "\n".join(f"- {i.texto()}" for i in itens)


def aplicar(itens: list[Item], dados: dict, quadro: str = "") -> None:
    """Junta à tabela o que o modelo devolveu. Item com número que não vale é ignorado; número novo é lanche novo. O
    quadro fica anotado no item: é o que se mostraria ao perguntar sobre ele."""
    por_numero = {i.numero: i for i in itens}
    for bruto in dados.get("itens") or []:
        if not isinstance(bruto, dict):
            continue
        try:
            numero = int(bruto.get("item"))
        except (TypeError, ValueError):
            continue
        if numero < 1:
            continue
        nomes, quantos = ri.ler_itens(bruto.get("ingredientes") or [])
        item = por_numero.get(numero)
        if item is None:
            item = Item(numero)
            itens.append(item)
            por_numero[numero] = item
        item.juntar(nomes, quantos, str(bruto.get("pao") or ""), bruto.get("fechado") is True)
        if quadro:
            item.ultimo_quadro = quadro
    itens.sort(key=lambda i: i.numero)


def montagens(paradas: list[dict], juntar_s: float, max_s: float) -> list[list[dict]]:
    """As paradas seguidas (a menos de `juntar_s` uma da outra) são uma montagem; a que passa de `max_s` desde a
    primeira parada é cortada — num trecho movimentado, juntar tudo daria uma "montagem" de meia hora."""
    saida: list[list[dict]] = []
    for seq in rp.sequencias(paradas, juntar_s):
        atual: list[dict] = []
        inicio: datetime | None = None
        for p in seq:
            t = datetime.strptime(p["na_loja"][:19], F)
            if atual and inicio is not None and (t - inicio).total_seconds() > max_s:
                saida.append(atual)
                atual = []
            if not atual:
                inicio = t
            atual.append(p)
        if atual:
            saida.append(atual)
    return saida


def espacar(seq: list[dict], intervalo_s: float, maximo: int) -> list[dict]:
    """Os quadros que vão ao modelo: um a cada `intervalo_s` no mínimo (o primeiro sempre), e, se ainda passarem de
    `maximo`, espalhados. Medido na rodada 9 (14/10/2026): a tabela que recomeçava a cada pausa de 2 minutos perdia
    os pães abertos antes de chegar o recheio — a montagem passou a ser longa, e o que limita o custo é o intervalo."""
    escolhidos: list[dict] = []
    anterior: datetime | None = None
    for p in seq:
        t = datetime.strptime(p["na_loja"][:19], F)
        if anterior is None or (t - anterior).total_seconds() >= intervalo_s:
            escolhidos.append(p)
            anterior = t
    return rp.espalhar(escolhidos, maximo)


def cobertura(vistos: list[str], ficha: dict, parecidos: dict[str, frozenset[str]]) -> tuple[int, int]:
    """Quantos ingredientes da ficha foram vistos (o parecido conta), de quantos ela tem: o "10 de 11" do dono."""
    da_ficha = {ri._chave(i["nome"]) for i in ficha["ingredientes"]}
    return len(da_ficha) - len(faltando(vistos, ficha, parecidos)), len(da_ficha)


def faltando(vistos: list[str], ficha: dict, parecidos: dict[str, frozenset[str]]) -> list[str]:
    """Os ingredientes da ficha que não foram vistos (nem um parecido com eles), na ordem da ficha, sem repetir."""
    chaves = [ri._chave(v) for v in vistos]
    saida: dict[str, str] = {}
    for i in ficha["ingredientes"]:
        k = ri._chave(i["nome"])
        if not any(k in parecidos.get(v, {v}) for v in chaves):
            saida.setdefault(k, str(i["nome"]).strip())
    return list(saida.values())


def contagem_exata(batem: list[tuple[dict, float]], quantos: dict[str, int]) -> list[dict]:
    """Das fichas que batem, as que têm EXATAMENTE as peças contadas — no lanche fechado, é o que separa o Numero 01
    (duas carnes) do Numero 11 (quatro). Sem nada contado, nenhuma."""
    contadas = {k: q for k, q in quantos.items() if q > 0}
    saida = []
    for l, _ in batem:
        pecas = ri._pecas(l)
        da_ficha = {k: pecas[k] for k in contadas if k in pecas}
        if da_ficha and all(abs(da_ficha[k] - contadas[k]) < 1e-9 for k in da_ficha):
            saida.append(l)
    return saida


@dataclass
class Avaliado:
    item: Item
    vistos: list[str]
    fora: list[str]
    batem: list[tuple[dict, float]]
    parecidas: list[tuple[dict, float, int, int]]
    frente: dict | None
    folga: float
    exatas: list[dict]
    # O ciclo de aprendizado que o dono desenhou (14/10/2026), como se mostraria — a tela é depois, com protótipo:
    # o lanche fechado que nenhuma ficha explica é "fora do padrão" (alerta; guardado; se repetir, pergunta-se o que
    # é), e o que bate com uma ficha a menos de UM ingrediente vira pergunta, com o quadro: "qual é o que faltou?".
    fora_do_padrao: bool = False
    falta: tuple[dict, list[str]] | None = None

    def texto(self) -> str:
        nomes = "; ".join(ri._nome_com_iguais(l) for l, _ in self.batem[:4])
        top = "; ".join(f"{ri._nome_com_iguais(l)} {n} de {m}" for l, _, n, m in self.parecidas[:3])
        return (
            self.item.texto()
            + (f" (fora da lista: {', '.join(self.fora)})" if self.fora else "")
            + f" → batem {len(self.batem)}" + (f": {nomes}" if nomes else "")
            + (f" · parecidas: {top}" if top else "")
            + (f" · na frente: {ri._nome_com_iguais(self.frente)} (folga {self.folga:.1f})" if self.frente else "")
            + (f" · contagem exata: {'; '.join(ri._nome_com_iguais(l) for l in self.exatas)}" if self.exatas else "")
            + (" · FORA DO PADRÃO: nenhuma ficha explica (guardar; se repetir, perguntar)" if self.fora_do_padrao else "")
            + (f" · falta 1 de {ri._nome_com_iguais(self.falta[0])}: {self.falta[1][0]} (perguntar no quadro "
               f"{self.item.ultimo_quadro or '?'})" if self.falta else "")
        )


def avaliar(
    item: Item, vocab: list[str], lanches: list[dict], peso: dict[str, float],
    parecidos: dict[str, frozenset[str]], grupos: dict[str, str],
) -> Avaliado:
    nomes = list(item.nomes.values()) + ([item.pao] if item.pao else [])
    vistos, fora = ri.separar(nomes, vocab, grupos)
    batem = ri.fichas_que_batem(vistos, lanches, item.quantos, parecidos)
    ordem = ri.fichas_parecidas(vistos, lanches, peso, item.quantos, parecidos) if vistos else []
    parecidas = [(l, p, *cobertura(vistos, l, parecidos)) for l, p in ordem]
    frente, folga = ri.na_frente(ordem)
    exatas = contagem_exata(batem, item.quantos) if item.fechado else []
    # Só no lanche FECHADO: aberto, ainda pode vir ingrediente.
    fora_do_padrao = item.fechado and bool(vistos) and not batem
    falta = None
    if item.fechado and batem:
        que_batem = {id(l) for l, _ in batem}
        melhor = next(l for l, _ in ordem if id(l) in que_batem)
        sem = faltando(vistos, melhor, parecidos)
        if len(sem) == 1:
            falta = (melhor, sem)
    return Avaliado(item, vistos, fora, batem, parecidas, frente, folga, exatas, fora_do_padrao, falta)


@dataclass
class Montagem:
    de: str
    ate: str
    paradas: int
    quadros: list[str] = field(default_factory=list)
    itens: list[Item] = field(default_factory=list)
    avaliados: list[Avaliado] = field(default_factory=list)
    cenas: Counter = field(default_factory=Counter)
    perguntas: int = 0
    custo_centavos: float = 0.0
    borradas: int = 0
    erros: list[str] = field(default_factory=list)


CAMPOS_DO_ARQUIVO = ("de", "ate", "quadros", "perguntas", "custo_centavos", "erros", "item", "resultado")


def repassar(
    pasta: Path,
    fichas: dict,
    janelas: list[tuple[str, str]],
    cliente: Any,
    *,
    teto_centavos: float,
    pessoas: Callable[[np.ndarray], list[float] | None] | None,
    juntar_s: float = 300.0,
    max_s: float = 1200.0,
    intervalo_s: float = 20.0,
    quadros: int = 40,
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
    vocab = ri.vocabulario(lanches)
    da_loja = da_loja or {}
    instrucoes = INSTRUCOES + ri.texto_do_vocabulario(vocab, da_loja.get("descricoes"))
    parecidos, grupos = ri.grupos_de_parecidos(da_loja.get("parecidos"))
    peso = ri.pesos_por_raridade(lanches, parecidos)
    lista = montagens(r2.nas_janelas(r2.ler_paradas(pasta), janelas), juntar_s, max_s)
    feitas: list[Montagem] = []
    gasto = 0.0
    ultimo: float | None = None
    erros_seguidos = 0
    motivo_do_fim = "acabaram as montagens das janelas"
    fim = False
    for seq in lista:
        m = Montagem(de=seq[0]["na_loja"][:19], ate=seq[-1]["na_loja"][:19], paradas=len(seq))
        feitas.append(m)
        escolhidas = espacar(seq, intervalo_s, quadros)
        for n, p in enumerate(escolhidas, start=1):
            if ultimo is not None and gasto + ultimo > teto_centavos:
                m.erros.append("teto")
                motivo_do_fim = f"o teto de {teto_centavos:g} centavos: gastos {gasto:.2f}, e a próxima custaria perto de {ultimo:.2f}"
                fim = True
                break
            try:
                b64, borrou = rp.preparar_da_bancada((pasta / "recortes" / p["recorte"]).read_bytes(), pessoas)
            except (OSError, ValueError) as e:
                m.erros.append(f"recorte: {e}")
                continue
            m.borradas += int(borrou)
            m.quadros.append(p["recorte"])
            texto = (
                texto_da_tabela(m.itens)
                + f"\n\nA bancada às {p['na_loja'][11:19]} (quadro {n} de {len(escolhidas)} desta montagem). "
                "Devolva a tabela depois desta imagem."
            )
            try:
                resposta = criar_pedindo_a_ferramenta(
                    cliente,
                    ferramenta="responder",
                    max_tokens=TETO_DE_SAIDA,
                    max_tokens_livre=MAX_TOKENS_ESCOLHA_LIVRE + TETO_DE_SAIDA,
                    model=modelo,
                    system=[{"type": "text", "text": instrucoes, "cache_control": {"type": "ephemeral"}}],
                    tools=[FERRAMENTA],
                    messages=[{"role": "user", "content": [
                        {"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": b64}},
                        {"type": "text", "text": texto},
                    ]}],
                )
            except Exception as e:  # noqa: BLE001 — a chave recusada para tudo; o resto conta e segue
                m.erros.append(type(e).__name__)
                if r2._definitivo(e):
                    motivo_do_fim = f"erro que repetir não resolve: {type(e).__name__}"
                    fim = True
                    break
                erros_seguidos += 1
                if erros_seguidos >= r2.ERROS_SEGUIDOS:
                    motivo_do_fim = f"{erros_seguidos} erros seguidos"
                    fim = True
                    break
                continue
            erros_seguidos = 0
            uso = getattr(resposta, "usage", None)
            custo = r2.custo_centavos(modelo, uso, dolar) or 0.0
            gasto += custo
            ultimo = custo
            m.perguntas += 1
            m.custo_centavos += custo
            if getattr(resposta, "stop_reason", None) == "max_tokens":
                m.erros.append(f"cortada no teto de saída ({getattr(uso, 'output_tokens', None)} tokens)")
                continue
            try:
                dados = _extrair_resposta(resposta)
            except Exception as e:  # noqa: BLE001 — veio sem a ferramenta: erro deste quadro, a tabela fica como estava
                m.erros.append(f"sem resposta: {e}")
                continue
            if dados.get("cena"):
                m.cenas[str(dados["cena"])] += 1
            aplicar(m.itens, dados, p["recorte"])
        m.avaliados = [avaliar(i, vocab, lanches, peso, parecidos, grupos) for i in m.itens]
        dizer(
            f"{m.de[11:]}–{m.ate[11:]} · {len(m.quadros)} quadros · {m.perguntas} perguntas · "
            + (" | ".join(a.texto() for a in m.avaliados) or "nenhum lanche na tabela")
            + f" · {m.custo_centavos:.3f} centavo" + (f" · borradas {m.borradas}" if m.borradas else "")
            + (f" · erros: {'; '.join(m.erros)}" if m.erros else "")
        )
        if fim:
            break
    if saida is not None:
        saida.parent.mkdir(parents=True, exist_ok=True)
        with saida.open("w", newline="", encoding="utf-8") as f:
            w = csv.writer(f)
            w.writerow(CAMPOS_DO_ARQUIVO)
            for m in feitas:
                base = [m.de, m.ate, "|".join(m.quadros), m.perguntas, round(m.custo_centavos, 4), "; ".join(m.erros)]
                if not m.avaliados:
                    w.writerow([*base, "", "nenhum lanche na tabela"])
                for a in m.avaliados:
                    w.writerow([*base, a.item.numero, a.texto()])
    todos = [a for m in feitas for a in m.avaliados]
    return {
        "montagens": len(feitas),
        "perguntas": sum(m.perguntas for m in feitas),
        "erros": sum(len(m.erros) for m in feitas),
        "gastoCentavos": round(gasto, 4),
        "motivoDoFim": motivo_do_fim,
        "cenas": dict(sum((m.cenas for m in feitas), Counter())),
        "itens": len(todos),
        "comPao": sum(1 for a in todos if a.item.pao),
        "fechados": sum(1 for a in todos if a.item.fechado),
        "batemUma": sum(1 for a in todos if len(a.batem) == 1),
        "batemVarias": sum(1 for a in todos if len(a.batem) > 1),
        "nenhumaBate": sum(1 for a in todos if a.vistos and not a.batem),
        "naFrente": sum(1 for a in todos if a.frente is not None),
        "contagemExataUma": sum(1 for a in todos if len(a.exatas) == 1),
        "foraDoPadrao": sum(1 for a in todos if a.fora_do_padrao),
        "faltaUm": sum(1 for a in todos if a.falta is not None),
        "borradas": sum(m.borradas for m in feitas),
        "feitas": feitas,
    }


def main(argv: list[str] | None = None) -> int:
    if sys.stdout is not None:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    a = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    a.add_argument("pasta", type=Path)
    a.add_argument("--fichas", type=Path, default=Path(r"C:\Farol\agent\fichas.json"))
    a.add_argument("--janela", action="append", required=True)
    a.add_argument("--teto-centavos", type=float, required=True)
    a.add_argument("--juntar-s", type=float, default=300.0)
    a.add_argument("--max-s", type=float, default=1200.0)
    a.add_argument("--intervalo-s", type=float, default=20.0)
    a.add_argument("--quadros", type=int, default=40)
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
    pessoas = rp.pessoas_pelo_detector_do_agente()
    print(f"detector de pessoas do agente: {'pronto' if pessoas else 'NÃO há — todo recorte vai borrado'}", flush=True)
    import anthropic

    cliente = anthropic.Anthropic(api_key=chave, timeout=60.0, max_retries=2)
    r = repassar(
        args.pasta, fichas, [r2.janela(j) for j in args.janela], cliente,
        teto_centavos=args.teto_centavos, pessoas=pessoas, juntar_s=args.juntar_s, max_s=args.max_s,
        intervalo_s=args.intervalo_s, quadros=args.quadros, modelo=args.modelo, dolar=float(os.environ.get("FAROL_DOLAR", "5.40")), da_loja=da_loja,
        saida=args.pasta / "respostas" / f"{args.rodada}.csv", dizer=lambda s: print(s, flush=True),
    )
    print(
        f"FIM: {r['montagens']} montagens · {r['perguntas']} perguntas · {r['erros']} erro(s) · gasto "
        f"{r['gastoCentavos']:.3f} centavos · {r['itens']} itens na tabela — com pão definido {r['comPao']}, fechados "
        f"{r['fechados']}, batem com UMA ficha {r['batemUma']}, com várias {r['batemVarias']}, com nenhuma "
        f"{r['nenhumaBate']}, uma na frente {r['naFrente']}, contagem exata de uma só {r['contagemExataUma']}, fora do "
        f"padrão {r['foraDoPadrao']}, faltando um {r['faltaUm']} · recortes borrados {r['borradas']} · por quê parou: "
        f"{r['motivoDoFim']}",
        flush=True,
    )
    print(f"cenas: {r['cenas']}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
