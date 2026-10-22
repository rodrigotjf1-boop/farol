"""CLI do agente.

Três comandos, e os três funcionam sem a loja:

    farol-agent sandbox    — processa uma pasta de quadros pelo pipeline
    farol-agent sondar     — mede a qualidade de uma imagem ou pasta
    farol-agent laco       — roda o laço COMPLETO: gatilho → regra → fila →
                             juiz → alerta, contra material gravado

O `sondar` é o diagnóstico: diz se o detalhe real bate com a resolução
declarada, se está focado, se caiu para infravermelho e se o WDR dá conta.

O `laco` é o que permite afinar motor, limiar e janela de silêncio sem
gastar nem ir ao restaurante — com `--simulado` (padrão) o veredito é
determinístico por imagem, então duas versões do motor se comparam contra
exatamente o mesmo material.
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
from datetime import datetime, timedelta
from pathlib import Path

import cv2

from farol_agent.config import ErroDeConfig, carregar
from farol_agent.fila import Fila
from farol_agent.fontes.sandbox import FonteSandbox
from farol_agent.modelos import (
    RESOLUCOES,
    EventoGatilho,
    Frame,
    Regra,
    TipoRegra,
    Zona,
)
from farol_agent.ensaio import MODELOS as ENSAIO_MODELOS
from farol_agent.motor import MotorDeRegras
from farol_agent import imagens
from farol_agent.pipeline import dedupe, qualidade, recorte


# Zona padrão para quando não há configuração: o quadro inteiro.
ZONA_CHEIA = Zona(
    id="zona-cheia",
    nome="quadro inteiro",
    poligono=[(0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0)],
)


def _carregar_zona(caminho: str | None) -> Zona:
    if not caminho:
        return ZONA_CHEIA
    dados = json.loads(Path(caminho).read_text(encoding="utf-8"))
    return Zona(
        id=dados.get("id", "zona"),
        nome=dados.get("nome", "zona"),
        poligono=[tuple(p) for p in dados["poligono"]],
    )


def cmd_sandbox(args: argparse.Namespace) -> int:
    fonte = FonteSandbox(args.pasta, ponto_id=args.ponto, fps=args.fps)
    zona = _carregar_zona(args.zona)
    saida = Path(args.saida)
    saida.mkdir(parents=True, exist_ok=True)

    dedup = dedupe.Deduplicador(limiar=args.limiar_dedupe, memoria_seg=args.memoria)

    print(f"sandbox: {len(fonte)} quadros · {fonte.inicio:%d/%m %H:%M:%S} → {fonte.fim:%d/%m %H:%M:%S}")
    print(f"zona: {zona.nome} · resolução de envio: {args.lado_maior} px\n")

    enviados = 0
    repetidos = 0
    ts = fonte.inicio

    while ts <= fonte.fim:
        rajada = fonte.rajada(ts, quantidade=args.rajada)
        if not rajada:
            break

        bbox = zona.bbox(rajada[0].largura, rajada[0].altura)
        escolhido = qualidade.melhor_quadro(rajada, descartar=args.descartar, zona_bbox=bbox)
        if escolhido is None:
            ts = _avancar(ts, args.intervalo)
            continue

        f = recorte.recortar_zona(escolhido, zona, mascarar=args.mascarar)
        borrou = False
        if args.borrar_rosto:
            f, borrou = recorte.borrar_rostos(f)

        if dedup.repetido(f"{args.ponto}:{zona.id}", f.imagem, f.ts):
            repetidos += 1
            ts = _avancar(ts, args.intervalo)
            continue

        f = recorte.redimensionar(f, args.lado_maior)

        nome = saida / f"{f.ts:%Y%m%d_%H%M%S}_{zona.id}.jpg"
        imagens.escrever(str(nome), f.imagem, [cv2.IMWRITE_JPEG_QUALITY, args.jpeg])
        enviados += 1
        print(
            f"  {f.ts:%H:%M:%S}  {f.largura}×{f.altura}  "
            f"nitidez {escolhido.nitidez:7.1f}  "
            f"{'rosto borrado  ' if borrou else '':<15}→ {nome.name}"
        )

        ts = _avancar(ts, args.intervalo)

    print(f"\n{enviados} recortes gerados · {repetidos} descartados por repetição")
    if enviados + repetidos:
        print(f"economia por deduplicação: {repetidos / (enviados + repetidos):.0%}")
    return 0


def _avancar(ts: datetime, segundos: float) -> datetime:
    from datetime import timedelta

    return ts + timedelta(seconds=segundos)


def cmd_sondar(args: argparse.Namespace) -> int:
    """Mede a qualidade real da imagem, em vez de confiar na ficha técnica."""
    alvo = Path(args.caminho)
    arquivos = (
        sorted(p for p in alvo.iterdir() if p.suffix.lower() in {".jpg", ".jpeg", ".png"})
        if alvo.is_dir()
        else [alvo]
    )

    print(f"{'arquivo':<34} {'resolução':>11} {'detalhe':>8} {'nitidez':>9} {'satur.':>7} {'estour.':>8}")
    print("─" * 82)

    for arq in arquivos:
        img = imagens.ler(str(arq))
        if img is None:
            print(f"{arq.name:<34} {'ilegível':>11}")
            continue

        h, w = img.shape[:2]
        det = qualidade.detalhe_real(img)
        nit = qualidade.nitidez(img)
        sat = qualidade.saturacao_media(img)
        est, _cortado = qualidade.faixa_dinamica(img)

        print(
            f"{arq.name[:33]:<34} {f'{w}×{h}':>11} {det:>8.3f} {nit:>9.1f} "
            f"{sat:>7.2f} {est:>7.1%}"
        )

        if det < 0.08:
            print(f"{'':34} ⚠️  detalhe baixo: imagem provavelmente esticada de resolução menor (1080N?)")
        if sat < 0.05:
            print(f"{'':34} ⚠️  sem cor: está em infravermelho — regra que depende de cor não funciona aqui")
        if est > 0.05:
            print(f"{'':34} ⚠️  {est:.0%} dos pixels estourados: WDR insuficiente para a cena")

    return 0


def cmd_laco(args: argparse.Namespace) -> int:
    """Laço completo contra material gravado: gatilho → fila → juiz → alerta."""
    logging.basicConfig(
        level=logging.INFO if args.verboso else logging.WARNING,
        format="  [%(levelname)s] %(message)s",
    )

    try:
        ponto_id, regras = carregar(args.config)
    except ErroDeConfig as e:
        print(f"\n  ERRO de configuração: {e}\n", file=sys.stderr)
        return 1

    ativas = [r for r in regras if r.ativa]
    print(f"\nconfig: {len(regras)} regras, {len(ativas)} ativas · ponto {ponto_id}")
    if not ativas:
        print("\n  Nenhuma regra ativa. Regra nasce desligada de propósito —")
        print("  marque `ativa: true` no YAML depois de medir a acurácia.\n")
        return 1

    if args.nuvem:
        from farol_agent.juizes.nuvem import JuizNuvem
        from farol_agent.juizes.base import ErroDoJuiz

        try:
            juiz = JuizNuvem()
        except ErroDoJuiz as e:
            print(f"\n  ERRO: {e}\n", file=sys.stderr)
            return 1
        print(f"juiz: nuvem ({juiz.modelo}, escala para {juiz.modelo_forte})")
    else:
        from farol_agent.juizes.simulado import JuizSimulado

        juiz = JuizSimulado()
        print("juiz: simulado (nenhuma chamada de API, nenhum custo)")

    fonte = FonteSandbox(args.pasta, ponto_id=ponto_id, fps=args.fps)
    fila = Fila(args.fila)
    motor = MotorDeRegras(fila, regras, rajada=args.rajada, descartar=args.descartar)

    print(f"material: {len(fonte)} quadros · "
          f"{fonte.inicio:%d/%m %H:%M:%S} → {fonte.fim:%d/%m %H:%M:%S}")
    print(f"gatilho a cada {args.intervalo}s\n")

    enfileirados = silenciados = repetidos = 0
    alertas_total = []
    ts = fonte.inicio

    while ts <= fonte.fim:
        evento = EventoGatilho(ponto_id=ponto_id, ts=ts, origem="sandbox")
        p = motor.preparar(evento, fonte)
        enfileirados += len(p.enfileirados)
        silenciados += len(p.em_silencio)
        repetidos += len(p.repetidos)

        # Julga no mesmo passo: no agente real a drenagem é outro laço, mas
        # aqui interessa ver o alerta nascer junto da cena que o gerou.
        for a in motor.processar(juiz, ts, limite=args.limite):
            alertas_total.append(a)
            print(
                f"  🔔 {a.ts:%H:%M:%S}  [{a.severidade.value}] {a.regra_nome}"
                f"  conf {a.confianca:.2f}"
            )
            print(f"       {a.motivo}")
            print(f"       ações: {', '.join(a.acoes)}")

        ts += timedelta(seconds=args.intervalo)

    # Drena o que sobrou na fila depois do último gatilho.
    for a in motor.processar(juiz, ts, limite=1000):
        alertas_total.append(a)

    resumo = fila.resumo()
    custo = fila.custo_centavos(fonte.inicio - timedelta(days=1))

    print(f"\n  enfileirados {enfileirados} · "
          f"em silêncio {silenciados} · repetidos {repetidos}")
    print(f"  fila: {resumo}")
    print(f"  alertas: {len(alertas_total)}")
    print(f"  custo estimado: R$ {custo / 100:.4f}\n")

    fila.fechar()
    return 0


def _senha_do_dvr(args: argparse.Namespace) -> str:
    """Nunca pela linha de comando.

    Senha em argumento aparece no histórico do shell e na lista de
    processos — qualquer um na máquina a lê com `ps`. Vem do ambiente ou
    de prompt que não ecoa.
    """
    import os
    from getpass import getpass

    senha = os.environ.get("FAROL_DVR_SENHA")
    if senha:
        return senha
    return getpass(f"senha de {args.usuario}@{args.host}: ")


def cmd_dvr(args: argparse.Namespace) -> int:
    from farol_agent.dvr.dahua import ClienteDahua, ErroDoGravador
    from farol_agent.dvr.descoberta import limpar_arp, rede_local, varrer

    if args.acao == "descobrir":
        rede = args.rede or rede_local()
        if not rede:
            print("não descobri a rede desta máquina; informe com --rede", file=sys.stderr)
            return 1
        if args.limpar_arp:
            if limpar_arp():
                print("\ncache ARP esvaziado — a lista é o que responde AGORA")
            else:
                print("\nNÃO consegui esvaziar o cache ARP (precisa de administrador).")
                print("A lista pode trazer aparelho que já saiu da rede.")
        print(f"\nvarrendo {rede} … (portas 80, 554 e 37777, depois a tabela ARP)\n")
        achados = varrer(rede)
        if not achados:
            print("  nada respondeu, nem a ARP.")
            print("  O DVR está ligado e no mesmo switch/roteador que este PC?\n")
            return 1

        print(f"  {'IP':<16} {'MAC':<19} {'portas':<12} {'observação'}")
        print("  " + "─" * 76)
        for a in achados:
            portas = ",".join(str(p) for p in a.portas) if a.portas else "nenhuma"
            if a.realm:
                obs = str(a.realm)[:34]
            elif a.mac_local:
                obs = "MAC administrado localmente"
            else:
                obs = "só responde a ARP"
            marca = "  ⇐ parece gravador" if a.parece_gravador else ""
            print(f"  {a.host:<16} {(a.mac or '—'):<19} {portas:<12} {obs}{marca}")

        print()
        print(f"  {len(achados)} aparelhos. TODOS podem ser o gravador — a lista")
        print("  está ordenada por probabilidade, não filtrada.")
        print("  'MAC administrado localmente' é comum em celular, mas não é")
        print("  exclusivo dele (ERR-003): não descarte ninguém por esse motivo.")
        print()
        print("  TESTE DECISIVO: tire o cabo de rede do DVR, rode de novo, recoloque")
        print("  e rode outra vez. O IP que sumir e voltar é ele.\n")
        return 0

    cliente = ClienteDahua(
        args.host, args.usuario, _senha_do_dvr(args), porta=args.porta
    )

    try:
        if args.acao == "info":
            info = cliente.info()
            print()
            print(json.dumps(info, indent=2, ensure_ascii=False))
            print()
            canais = info.get("canais")
            if canais:
                print(f"  {canais} canais. URLs do main-stream:")
                for c in range(1, min(canais, 4) + 1):
                    print(f"    canal {c}: {cliente.url_rtsp_sem_segredo(c)}")
                if canais > 4:
                    print(f"    … e mais {canais - 4}")
                print()
            return 0

        if args.acao == "rtsp":
            print(cliente.url_rtsp(args.canal, sub=args.sub))
            return 0

        if args.acao == "canais":
            # Varre os canais e diz QUAIS têm câmera. Numa instalação,
            # "em que canal ficou essa câmera?" é a primeira pergunta, e
            # ela se responde medindo, não conferindo etiqueta de cabo.
            from farol_agent.fontes.rtsp import ErroDaFonte, FonteRTSP
            from farol_agent.pipeline import qualidade

            total = args.ate or (cliente.quantidade_de_canais() or 16)
            print(f"\nvarrendo canais 1 a {total} de {args.host} …")
            print("(cada canal leva alguns segundos; canal vazio demora mais)\n")
            print(f"  {'canal':>5}  {'resolução':>11}  {'detalhe':>8}  {'satur.':>7}  situação")
            print("  " + "─" * 62)

            com_camera = []
            for canal in range(1, total + 1):
                fonte = FonteRTSP(f"canal{canal}", cliente.url_rtsp(canal), abrir_sub=False)
                try:
                    quadros = fonte.rajada(datetime.now(), quantidade=3)
                except ErroDaFonte:
                    print(f"  {canal:>5}  {'—':>11}  {'—':>8}  {'—':>7}  não abriu")
                    continue
                finally:
                    fonte.fechar()

                if not quadros:
                    print(f"  {canal:>5}  {'—':>11}  {'—':>8}  {'—':>7}  sem transmissão")
                    continue

                melhor = quadros[-1]
                ok, porque = qualidade.cena_utilizavel(melhor.imagem)
                det = qualidade.detalhe_real(melhor.imagem)
                sat = qualidade.saturacao_media(melhor.imagem)
                situacao = "CÂMERA" if ok else (porque[:34] or "sem cena")
                if ok:
                    com_camera.append(canal)
                print(
                    f"  {canal:>5}  {f'{melhor.largura}×{melhor.altura}':>11}  "
                    f"{det:>8.3f}  {sat:>7.2f}  {situacao}"
                )

            print()
            if com_camera:
                lista = ", ".join(str(c) for c in com_camera)
                print(f"  {len(com_camera)} canal(is) com imagem: {lista}")
                print(f"\n  próximo: dvr quadro --host {args.host} "
                      f"--canal {com_camera[0]} --salvar camera.jpg\n")
            else:
                print("  nenhum canal com imagem — só telas de 'sem sinal'.\n")
            return 0

        if args.acao == "quadro":
            # Captura um quadro de verdade pelo RTSP e mede. Em canal sem
            # camera, muito gravador transmite uma tela de "sem sinal" —
            # e isso basta para validar a captura inteira antes de a
            # camera chegar.
            from farol_agent import imagens
            from farol_agent.fontes.rtsp import ErroDaFonte, FonteRTSP
            from farol_agent.pipeline import qualidade

            fonte = FonteRTSP(
                f"canal{args.canal}",
                cliente.url_rtsp(args.canal, sub=args.sub),
                abrir_sub=False,
            )
            tipo = "sub" if args.sub else "main"
            print(f"\nabrindo canal {args.canal} ({tipo}-stream) …")
            try:
                quadros = fonte.rajada(datetime.now(), quantidade=args.rajada)
            except ErroDaFonte as e:
                print(f"\n  ERRO: {e}", file=sys.stderr)
                if e.dica:
                    print(f"  {e.dica}", file=sys.stderr)
                return 1
            finally:
                fonte.fechar()

            if not quadros:
                print("\n  abriu, mas nenhum quadro veio.")
                print("  Canal sem câmera costuma ser isso: o gravador aceita a")
                print("  conexão e não transmite nada.\n")
                return 1

            melhor = qualidade.melhor_quadro(quadros, descartar=min(2, len(quadros) - 1))
            det = qualidade.detalhe_real(melhor.imagem)
            sat = qualidade.saturacao_media(melhor.imagem)
            est, cortado = qualidade.faixa_dinamica(melhor.imagem)

            print(f"\n  {len(quadros)} quadros · escolhido o mais nítido")
            print(f"  resolução : {melhor.largura}×{melhor.altura}")
            print(f"  nitidez   : {melhor.nitidez:.1f}")
            print(f"  detalhe   : {det:.3f}")
            print(f"  saturação : {sat:.2f}")
            print(f"  estourado : {est:.1%}   cortado: {cortado:.1%}")
            if det < 0.08:
                print("  ⚠️  detalhe baixo — imagem esticada (1080N?) ou tela fixa")
            if sat < 0.05:
                print("  ⚠️  sem cor — infravermelho, ou tela de 'sem sinal'")

            if args.salvar:
                if imagens.escrever(args.salvar, melhor.imagem):
                    print(f"\n  salvo em {args.salvar}")
                else:
                    print(f"\n  não consegui salvar em {args.salvar}", file=sys.stderr)
            print()
            return 0

        if args.acao == "eventos":
            print(f"\nouvindo {args.host} · códigos=[{args.codigos}] · Ctrl+C para parar")
            print("o MHDX fecha a conexão a cada evento; religar é o normal aqui\n")
            n = 0

            def religou(espera, houve_evento):
                # Mostrar a religação é o que separa "está ouvindo e nada
                # aconteceu" de "o caminho caiu" — as duas se parecem.
                if args.verboso or not houve_evento:
                    print(f"       … religando em {espera:.0f}s")

            for e in cliente.eventos(
                args.codigos, keepalive=args.keepalive, ao_religar=religou
            ):
                n += 1
                extra = f"  {json.dumps(e.dados, ensure_ascii=False)}" if e.dados else ""
                print(f"  [{n:>4}] {e.codigo:<22} {e.acao:<6} canal {e.canal:>2}{extra}")
                if args.limite and n >= args.limite:
                    break
            print(f"\n  {n} eventos recebidos\n")
            return 0

    except ErroDoGravador as e:
        print(f"\n  ERRO: {e}", file=sys.stderr)
        if e.dica:
            print(f"  {e.dica}", file=sys.stderr)
        print(file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print("\n  interrompido\n")
        return 0

    return 1


def _area_para_zona(texto: str | None) -> tuple[Zona | None, float]:
    """`--area x1,y1,x2,y2` em fração do quadro → zona retangular.

    Sem `--area`, devolve `(None, _)`: o quadro inteiro vai ao modelo. É a
    opção de análise completa — serve quando a cena toda é o objeto da
    pergunta, e paga com menos detalhe por centímetro.

    A margem vai a **zero** quando a área é explícita. Os 5% do padrão
    existem para polígono desenhado a olho, onde a folga ajuda; um
    retângulo que o usuário escolheu já é a resposta dele.
    """
    if not texto:
        return None, 0.0

    try:
        partes = [float(x) for x in texto.split(",")]
    except ValueError:
        raise SystemExit("--area quer quatro números: x1,y1,x2,y2 (fração 0..1)")
    if len(partes) != 4:
        raise SystemExit("--area quer quatro números: x1,y1,x2,y2 (fração 0..1)")

    x1, y1, x2, y2 = partes
    if not all(0.0 <= v <= 1.0 for v in partes):
        raise SystemExit("--area é em fração do quadro (0..1), não em pixels")
    if x2 <= x1 or y2 <= y1:
        raise SystemExit("--area precisa de x2 > x1 e y2 > y1")

    return (
        Zona(
            id="area",
            nome="área marcada",
            poligono=[(x1, y1), (x2, y1), (x2, y2), (x1, y2)],
        ),
        0.0,
    )


def _conferir_chave() -> str | None:
    """A chave parece uma chave? Devolve o motivo quando não parece.

    Conferir ANTES de pedir a senha do gravador e abrir o RTSP: sem isto,
    o comando captura, redimensiona e tenta julgar — seis vezes — para só
    então dizer que a chave não presta. Em 05/10/2026 foi exatamente o que
    aconteceu, duas vezes seguidas (ERR-010).

    Não valida a chave de verdade (só a API faz isso); pega o que é
    obviamente impossível, que é o caso que mais acontece.
    """
    import os

    chave = os.environ.get("ANTHROPIC_API_KEY", "")
    if not chave:
        return "ANTHROPIC_API_KEY não está definida nesta janela do terminal"
    if "..." in chave or "…" in chave:
        return (
            "ANTHROPIC_API_KEY contém reticências — o que está lá é o EXEMPLO "
            "de como a chave se parece, não uma chave"
        )
    if not chave.startswith("sk-ant-"):
        return "ANTHROPIC_API_KEY não começa com sk-ant-"
    if len(chave) < 40:
        return f"ANTHROPIC_API_KEY tem só {len(chave)} caracteres — é curta demais"
    return None


def _ensinar_a_chave() -> None:
    """Como pôr a chave, SEM imprimir um exemplo colável.

    Exemplo em bloco de comando é colado literalmente — foi o que gerou o
    ERR-010. Aqui se descreve a chave em vez de mostrar um valor falso: o
    que a pessoa copia é a chave dela, não a minha ilustração.
    """
    print("  Para pôr a chave nesta janela do PowerShell:", file=sys.stderr)
    print("    1. Abra  https://console.anthropic.com/settings/keys", file=sys.stderr)
    print("    2. Crie uma chave e copie o valor INTEIRO (~100 caracteres,",
          file=sys.stderr)
    print("       começa com sk-ant- e não tem reticências no meio).", file=sys.stderr)
    print("    3. Digite  $env:ANTHROPIC_API_KEY =  e, entre aspas, cole a chave.",
          file=sys.stderr)
    print("  Vale só para esta janela do terminal; fechou, tem que pôr de novo.",
          file=sys.stderr)
    print("  Ou rode com --simulado para provar a cadeia sem gastar nem precisar "
          "de chave.\n", file=sys.stderr)


def _erro_legivel(erro: str | None) -> str:
    """Traduz o despejo do SDK para uma frase que diz o que fazer.

    `AuthenticationError: Error code: 401 - {'type': 'error', 'error':
    {...}}` repetido seis vezes não ajuda ninguém a resolver nada.
    """
    bruto = str(erro or "")
    if "authentication_error" in bruto or "401" in bruto:
        return "a chave da API foi recusada (401). Confira ANTHROPIC_API_KEY"
    if "credit" in bruto.lower() or "billing" in bruto.lower():
        return "a conta da API está sem crédito"
    if "429" in bruto or "rate_limit" in bruto:
        return "a API pediu para ir mais devagar (429) — tente de novo em instantes"
    if "529" in bruto or "overloaded" in bruto:
        return "a API está sobrecarregada (529) — tente de novo em instantes"
    return bruto


def _mostrar_analise(i: int, r, marcou_area: bool, simulado: bool = False) -> None:
    """Uma linha de cabeçalho por análise, detalhes embaixo."""
    v = r.veredito

    if v is None:
        print(f"  {i:02d} · ✗ {_erro_legivel(r.erro)}")
        if not r.cena_utilizavel:
            print("       Isso não é falha do modelo: o canal não entregou cena.")
            print("       Câmera ligada nesse canal? Lente tampada? Ambiente escuro?")
        return

    marca = {
        "conforme": "✓",
        "nao_conforme": "✗",
        "nao_avaliavel": "?",
    }.get(v.resultado.value, "·")
    conf = f"{v.confianca:.0%}" if v.confianca is not None else "—"
    print(f"  {i:02d} · {marca} {v.resultado.value}  confiança {conf}  {r.ms_total} ms")
    if v.motivo:
        print(f"       {v.motivo}")

    detalhe = f"{r.enviado_largura}×{r.enviado_altura}, {r.enviado_bytes / 1024:.0f} kB"
    if r.px_por_cm:
        detalhe += f", {r.px_por_cm} px/cm no modelo"
    print(f"       enviado: {detalhe}")

    if v.tokens_entrada:
        custo = f", R$ {v.custo_centavos / 100:.4f}" if v.custo_centavos else ""
        print(f"       {v.modelo}: {v.tokens_entrada} entrada / "
              f"{v.tokens_saida} saída{custo}")

    # O simulador SORTEIA a confiança a partir do hash da imagem
    # (0,60 a 0,95). Diagnosticar essa oscilação como se fosse medida manda
    # alguém investigar foco e contraluz por causa de um número inventado —
    # aconteceu no primeiro uso em campo, 05/10/2026 (ERR-008).
    if simulado:
        print("       (a confiança acima é sorteada pelo simulador, não medida)")
        for aviso in r.avisos:
            print(f"       · {aviso}")
        return

    # Confiança baixa não é só um número: é o gancho da recomendação de
    # equipamento. Enquanto a tela não existe, o diagnóstico sai aqui — e
    # sai apontando a causa medida, não "troque a câmera".
    if v.confianca is not None and v.confianca < 0.70:
        print("       ⚠ confiança abaixo de 70% — este veredito não se sustenta.")
        if r.nitidez is not None and r.nitidez < 100:
            print(f"         nitidez {r.nitidez:.0f} (baixa): foco ou sujeira na lente.")
        if r.px_por_cm and r.px_por_cm < 3:
            print(f"         {r.px_por_cm} px/cm é pouco até para estado. Aproxime a "
                  "câmera, estreite a área ou suba o envio.")
        if r.estourado and r.estourado > 0.15:
            print(f"         {r.estourado:.0%} do quadro estourado: contraluz, "
                  "precisa de WDR.")
        if not marcou_area:
            print("         Sem área marcada o detalhe se dilui no quadro todo — "
                  "marcar a área costuma resolver sem trocar de câmera.")

    for aviso in r.avisos:
        print(f"       · {aviso}")


def cmd_analisar(args: argparse.Namespace) -> int:
    """Uma análise de verdade, do canal do gravador ao veredito.

    É o comando que fecha a cadeia. Até aqui o laço rodava contra material
    gravado e o gatilho se provava sozinho; este junta câmera ao vivo,
    critério escrito à mão e juiz — e mostra **a imagem que foi enviada**,
    porque veredito sem saber o que o modelo viu não se audita.
    """
    import time as relogio

    from farol_agent.analise import analisar
    from farol_agent.dvr.dahua import ClienteDahua, ErroDoGravador
    from farol_agent.fontes.rtsp import ErroDaFonte, FonteRTSP

    zona, margem = _area_para_zona(args.area)

    if args.simulado:
        from farol_agent.juizes.simulado import JuizSimulado

        juiz = JuizSimulado()
        print("\n⚠ juiz SIMULADO — veredito determinístico pela imagem, custo zero.")
        print("  Prova a cadeia inteira. Para julgar de verdade, tire o --simulado.")
    else:
        from farol_agent.juizes.base import ErroDoJuiz
        from farol_agent.juizes.nuvem import JuizNuvem

        # Antes de pedir a senha do gravador e abrir o RTSP: se a chave não
        # presta, nada do que vem depois tem como dar certo.
        problema = _conferir_chave()
        if problema:
            print(f"\n{problema}.\n", file=sys.stderr)
            _ensinar_a_chave()
            return 1

        try:
            # A chave NÃO escolhe modelo — quem escolhe é esta linha. Toda
            # análise vai ao barato; a cascata só reconsulta o forte quando
            # a confiança fica abaixo do limiar. `--so-haiku` desliga isso
            # e trava o custo por análise, que é o número que uma rede de
            # lojas precisa para orçar.
            from farol_agent.juizes.nuvem import MODELO_FORTE

            juiz = JuizNuvem(modelo_forte=None if args.so_haiku else MODELO_FORTE)
        except ErroDoJuiz as e:
            print(f"\nnão consegui preparar o juiz da nuvem: {e}\n", file=sys.stderr)
            _ensinar_a_chave()
            return 1

    try:
        cliente = ClienteDahua(
            args.host, usuario=args.usuario, senha=_senha_do_dvr(args), porta=args.porta
        )
        url = cliente.url_rtsp(args.canal, sub=args.sub)
    except ErroDoGravador as e:
        print(f"\nnão falei com o gravador: {e}", file=sys.stderr)
        if e.dica:
            print(f"  {e.dica}", file=sys.stderr)
        print(file=sys.stderr)
        return 1

    fonte = FonteRTSP(f"canal{args.canal}", url, abrir_sub=False)

    destino = Path(args.salvar_em)
    destino.mkdir(parents=True, exist_ok=True)

    print(f"\ncritério: {args.criterio}")
    area = f"marcada {args.area}" if args.area else "quadro inteiro"
    print(f"canal {args.canal} · envio {args.envio} · área: {area}")
    if args.repetir > 1:
        print(f"\n{args.repetir} análises a cada {args.intervalo:g}s — "
              "mexa na frente da câmera entre elas.\n")
    else:
        print()

    centavos = 0.0
    falhas = 0
    feitas = 0

    try:
        for i in range(1, args.repetir + 1):
            arquivo = destino / f"analise-{datetime.now():%H%M%S}-{i:02d}.jpg"
            try:
                r = analisar(
                    fonte,
                    juiz,
                    args.criterio,
                    zona=zona,
                    margem=margem,
                    envio=args.envio,
                    rajada=args.rajada,
                    largura_zona_cm=args.largura_cm,
                    referencias=[Path(r) for r in (args.referencia or [])] or None,
                    salvar_em=arquivo,
                )
            except ErroDaFonte as e:
                print(f"  {i:02d} · a fonte falhou: {e}")
                if e.dica:
                    print(f"       {e.dica}")
                falhas += 1
                break

            feitas += 1
            _mostrar_analise(i, r, bool(args.area), simulado=args.simulado)
            if r.veredito and r.veredito.custo_centavos:
                centavos += r.veredito.custo_centavos
            if r.veredito is None:
                falhas += 1

            # Chave recusada ou crédito acabado não melhora na repetição.
            # Insistir só enterra a causa no meio de N linhas iguais e
            # gasta captura à toa (ERR-010).
            if r.veredito is None and not r.recuperavel:
                if i < args.repetir:
                    print(f"\n  parei aqui: isso não melhora repetindo "
                          f"(faltavam {args.repetir - i} análises).")
                break

            if i < args.repetir:
                relogio.sleep(args.intervalo)
    except KeyboardInterrupt:
        print("\n  interrompido")

    print()
    if centavos and feitas:
        media = centavos / 100 / feitas
        print(f"custo de {feitas} análise(s): R$ {centavos / 100:.4f} "
              f"(R$ {media:.4f} cada)")
        # A conta que decide o produto: o preço de uma análise vezes o
        # volume de um dia de loja.
        print(f"  a 200 análises/dia numa loja: R$ {media * 200 * 30:.2f}/mês")
    print(f"imagens enviadas em {destino.resolve()}")
    print("  Abra-as: é exatamente o que o modelo viu. Veredito estranho quase")
    print("  sempre se explica aí — área torta, quadro borrado ou objeto fora.")
    print()

    return 1 if feitas == 0 or falhas == feitas else 0


def cmd_ensaio(args: argparse.Namespace) -> int:
    """Rejulga imagens já capturadas, para comparar modelo e prompt.

    Comparar contra a câmera ao vivo não responde nada: a cena muda entre
    uma execução e outra, e não se sabe se a diferença veio do modelo ou
    do que estava na mesa. Aqui o conjunto é fixo.
    """
    from farol_agent.ensaio import MODELOS, carregar_gabarito, imagens_de, rodar
    from farol_agent.juizes.base import ErroDoJuiz
    from farol_agent.juizes.nuvem import JuizNuvem

    problema = _conferir_chave()
    if problema:
        print(f"\n{problema}.\n", file=sys.stderr)
        _ensinar_a_chave()
        return 1

    try:
        gabarito = carregar_gabarito(args.gabarito)
    except (OSError, ValueError, json.JSONDecodeError) as e:
        print(f"\ngabarito inválido: {e}\n", file=sys.stderr)
        return 1

    arquivos = imagens_de(args.pasta)
    if not arquivos:
        print(f"\nnenhuma imagem em {args.pasta}\n", file=sys.stderr)
        return 1

    referencias = [Path(r) for r in (args.referencia or [])]
    for r in referencias:
        if not r.is_file():
            print(f"\nreferência não encontrada: {r}\n", file=sys.stderr)
            return 1

    modelo = MODELOS[args.modelo]
    try:
        # Sem cascata: o ensaio mede UM modelo. Deixar escalar misturaria
        # dois modelos na mesma linha e a comparação perderia o sentido.
        juiz = JuizNuvem(modelo=modelo, modelo_forte=None)
    except ErroDoJuiz as e:
        print(f"\n{e}\n", file=sys.stderr)
        return 1

    print(f"\nmodelo: {args.modelo} ({modelo})")
    print(f"critério: {args.criterio}")
    print(f"{len(arquivos)} imagens · {len(referencias)} referência(s)"
          f"{' · com gabarito' if gabarito else ''}\n")

    e = rodar(juiz, arquivos, args.criterio,
              referencias=referencias or None, gabarito=gabarito)

    for caso in e.casos:
        if caso.veredito is None:
            print(f"  {caso.arquivo.name:<28} ✗ {_erro_legivel(caso.erro)}")
            continue
        v = caso.veredito
        conf = f"{v.confianca:.0%}" if v.confianca is not None else "—"
        marca = {True: "✓", False: "✗", None: " "}[caso.acertou]
        print(f"  {caso.arquivo.name:<28} {marca} {v.resultado.value:<14} {conf:>4}"
              f"   {v.motivo or ''}"[:150])

    print()
    if e.acuracia is not None:
        print(f"acurácia: {e.acertos}/{len(e.com_gabarito)} "
              f"({e.acuracia:.0%})")
        confiantes = e.erros_confiantes
        if confiantes:
            # O número que decide se dá para confiar no produto. Um erro a
            # 95% passa pela cascata intocado, porque ela escala o que vem
            # com confiança BAIXA.
            print(f"⚠ {len(confiantes)} erro(s) com confiança ≥ 85% — "
                  "a cascata NÃO pega esta classe:")
            for c in confiantes:
                print(f"    {c.arquivo.name}: disse {c.veredito.resultado.value}, "
                      f"era {c.esperado.value}")
    else:
        print("sem gabarito: só os vereditos. Para medir acurácia, passe "
              "--gabarito com o que era verdade em cada imagem.")

    if e.centavos:
        print(f"custo: R$ {e.centavos / 100:.4f} "
              f"(R$ {e.centavos / 100 / len(e.casos):.4f} por imagem)")
    print()
    return 0


def cmd_detector(args: argparse.Namespace) -> int:
    """O detector local: instalar o modelo e olhar uma imagem com ele."""
    import os
    from pathlib import Path

    from farol_agent.juizes.base import ErroDoJuiz
    from farol_agent.juizes.detector import (
        MODELO_ARQUIVO,
        MODELO_NOME,
        OBJETOS,
        JuizDetector,
        MotorOnnx,
        instalar_modelo,
    )

    pasta = Path(args.pasta or os.environ.get("FAROL_MODELOS") or "modelos")

    try:
        if args.acao == "instalar":
            # Passo de INSTALAÇÃO, de propósito. O agente em serviço nunca
            # baixa modelo sozinho.
            print(f"instalando {MODELO_NOME} em {pasta.resolve()} (108 MB na primeira vez)…")
            caminho = instalar_modelo(pasta)
            motor = MotorOnnx(caminho)
            print(f"\n  pronto: {caminho}")
            print(f"  conferido pelo sha256 · roda em {motor.onde}")
            if motor.placa_reprovada:
                # Dito na instalação, que é quando tem alguém olhando a tela.
                print(f"  a placa de vídeo desta máquina {motor.placa_reprovada}:")
                print("  o detector roda no processador. Ele funciona; só não usa a placa.")
            if motor.openvino_recusado:
                print(f"  o OpenVINO desta máquina {motor.openvino_recusado}:")
                print("  o detector roda pelo ONNX Runtime. Ele funciona; só não ganha a velocidade do OpenVINO.")
            print("  reinicie o agente para ele passar a usar o detector.\n")
            return 0

        if args.acao == "objetos":
            print("\n  o detector local conhece: " + ", ".join(sorted(OBJETOS)) + "\n")
            return 0

        # olhar
        if not args.imagem:
            print("\n  ERRO: diga a imagem com --imagem\n", file=sys.stderr)
            return 2
        parametros = {"objeto": args.objeto, "minimo": args.minimo, "maximo": args.maximo}
        JuizDetector.atende(parametros)

        # A mesma porta do motor, antes do modelo. O detector lê "não vi"
        # como AUSÊNCIA, com confiança alta — e a tela de "sem sinal" do
        # gravador é um quadro onde ele não vê ninguém. Em serviço esse
        # quadro nunca chega ao juiz; pulando a porta, este comando mostrava
        # um alerta que o agente não daria (na loja, em 06/10/2026:
        # nao_conforme com 0,96 para a tela preta do gravador).
        from farol_agent import imagens
        from farol_agent.pipeline import qualidade

        bgr = imagens.ler(args.imagem)
        if bgr is not None:
            utilizavel, porque = qualidade.cena_utilizavel(bgr)
            if not utilizavel:
                print("\n  nao_avaliavel  (o agente não manda este quadro ao detector)")
                print(f"  {porque}\n")
                return 0

        juiz = JuizDetector(MotorOnnx(pasta / MODELO_ARQUIVO))
        v = juiz.julgar(Path(args.imagem), "", contexto={"parametros": parametros})
        print(f"\n  {v.resultado.value}  (confiança {v.confianca:.2f}, {v.latencia_ms} ms, {v.modelo})")
        print(f"  {v.motivo}\n")
        return 0
    except ErroDoJuiz as e:
        print(f"\n  ERRO: {e}\n", file=sys.stderr)
        return 1


def cmd_ingredientes(args: argparse.Namespace) -> int:
    """O juiz de ingrediente dos passos do lanche (A23.3): instalar o modelo, descer a base da loja agora, olhar uma
    imagem com ele."""
    import os

    from farol_agent.bancada_ao_vivo import INGREDIENTES
    from farol_agent.base_da_loja import BaseDaLoja
    from farol_agent.juizes.base import ErroDoJuiz
    from farol_agent.juizes.ingrediente import MODELO_NOME, JuizDaLoja, MotorDino, instalar_modelo

    logging.basicConfig(level=logging.INFO, format="  %(message)s")
    pasta = Path(args.pasta or os.environ.get("FAROL_MODELOS") or "modelos")
    base = BaseDaLoja.ao_lado(args.config)
    try:
        if args.acao == "instalar":
            # Passo de INSTALAÇÃO, de propósito. O agente em serviço nunca baixa modelo sozinho.
            print(f"instalando {MODELO_NOME} em {pasta.resolve()} (24 MB na primeira vez)…")
            caminho = instalar_modelo(pasta)
            MotorDino(caminho)
            print(f"\n  pronto: {caminho}")
            print("  conferido pelo sha256 · roda no processador")
            print(f"  nos passos do lanche, liga com {INGREDIENTES}=1 no ambiente do agente (e reinicie o agente).\n")
            return 0
        if args.acao == "base":
            # À mão, quando quem instala quiser; em serviço, a base desce sozinha com a loja fechada.
            from farol_agent.nuvem import ClienteNuvem, ErroDaNuvem

            token = os.environ.get("FAROL_AGENTE_TOKEN", "")
            if not token or not args.nuvem:
                print("\n  ERRO: a base desce com o endereço da API (--nuvem) e o token do agente (FAROL_AGENTE_TOKEN)\n",
                      file=sys.stderr)
                return 2
            try:
                d = base.descer(ClienteNuvem(args.nuvem, token, timeout=60))
            except ErroDaNuvem as e:
                print(f"\n  a base não desceu: {e}\n", file=sys.stderr)
                return 1
            print(f"\n  base da loja: {d.itens} ingrediente(s), {d.quadros} quadro(s); desceram {d.baixados}, saíram "
                  f"{d.apagados}" + (f"; {d.recusados} com o resumo errado (não ficaram)" if d.recusados else "")
                  + (f"; {d.sumiram} já não estavam na nuvem" if d.sumiram else "") + f"\n  em {base.raiz.resolve()}\n")
            return 0
        # olhar
        if not args.imagem:
            print("\n  ERRO: diga a imagem com --imagem\n", file=sys.stderr)
            return 2
        from farol_agent import imagens

        img = imagens.ler(args.imagem)
        if img is None:
            print("\n  ERRO: a imagem não abriu\n", file=sys.stderr)
            return 2
        juiz = JuizDaLoja(pasta, base)()
        if juiz is None:
            print("\n  sem o juiz de ingrediente agora (o motivo está na linha acima)\n", file=sys.stderr)
            return 1
        n = juiz.julgar(img)
        print(f"\n  {'comida' if n.comida() else 'sem ingrediente'}: o mais parecido é {n.nome} ({n.nota:.2f}); "
              f"sem contar o pão, {n.ingrediente} ({n.nota_ingrediente:.2f})\n")
        return 0
    except ErroDoJuiz as e:
        print(f"\n  ERRO: {e}\n", file=sys.stderr)
        return 1


def cmd_servir(args: argparse.Namespace) -> int:
    """Roda o agente contra a nuvem: configuração desce, comandos chegam.

    É o modo de produção do agente. Fica batendo, puxa a configuração
    quando ela muda e atende o que a nuvem pedir.
    """
    import os

    from farol_agent.configuracao import Sincronizador
    from farol_agent.nuvem import ClienteNuvem, ErroDaNuvem
    from farol_agent.servico import laco

    # INFO por padrão, ao contrário dos outros comandos. Este roda sozinho
    # num PC de loja, por semanas, sem ninguém olhando — e serviço calado é
    # indistinguível de serviço travado. Quando alguém finalmente for ver
    # por que a auditoria parou, o histórico precisa estar lá.
    logging.basicConfig(
        level=logging.DEBUG if args.verboso else logging.INFO,
        format="  %(asctime)s [%(levelname)s] %(message)s",
        datefmt="%H:%M:%S",
    )

    token = os.environ.get("FAROL_AGENTE_TOKEN", "")
    if not token:
        print("\nFAROL_AGENTE_TOKEN não está definida.", file=sys.stderr)
        print("  O token é entregue uma vez, no provisionamento, e vive no",
              file=sys.stderr)
        print("  ambiente do agente — nunca na linha de comando, que aparece",
              file=sys.stderr)
        print("  no histórico do shell e na lista de processos.\n", file=sys.stderr)
        return 1

    from farol_agent.nuvem import SABE

    # Sem a gravação de treino, o agente também não diz que sabe — senão o console prometeria o que a loja não faz.
    sabe = tuple(s for s in SABE if s != "treino") if getattr(args, "sem_treino", False) else SABE
    try:
        cliente = ClienteNuvem(args.nuvem, token, versao=args.versao or "0", sabe=sabe)
    except ErroDaNuvem as e:
        print(f"\n{e}\n", file=sys.stderr)
        return 1

    # Apresenta a máquina ANTES do laço: o heartbeat exige agente `ativo`,
    # e um agente recém-provisionado nasce `novo`. Sem isto a primeira
    # execução numa loja nova só produziria 403 sem dizer o que fazer.
    from farol_agent.maquina import arquivo_ao_lado, fingerprint

    impressao = fingerprint(arquivo_ao_lado(args.config))
    try:
        r = cliente.ativar(impressao, args.versao)
        print(
            "\nagente ativo"
            + (" (já estava)" if r.get("jaEstavaAtivo") else " — primeira ativação")
        )
    except ErroDaNuvem as e:
        print(f"\nnão consegui ativar: {e}", file=sys.stderr)
        if e.status == 409:
            # A trava funcionando. Dizer o que ela significa evita o
            # diagnóstico errado — não é token inválido, é token de outra
            # máquina.
            print("  Este token já está preso a outro computador. Trocar de",
                  file=sys.stderr)
            print("  equipamento exige emitir um token novo no console da",
                  file=sys.stderr)
            print("  distribuição — é a trava que impede um token copiado de",
                  file=sys.stderr)
            print("  virar um segundo agente.\n", file=sys.stderr)
        elif e.status == 401:
            print("  O token em FAROL_AGENTE_TOKEN não confere.\n", file=sys.stderr)
        else:
            print("  Vou seguir mesmo assim: se já houve ativação antes, o",
                  file=sys.stderr)
            print("  agente trabalha com a configuração que tem em disco.\n",
                  file=sys.stderr)
        if e.status in (401, 409):
            return 1

    sincronizador = Sincronizador(cliente, args.config, versao_app=args.versao)

    if sincronizador.config:
        c = sincronizador.config
        print(f"\nconfiguração v{c.versao} em disco: {c.loja_nome} · "
              f"{len(c.pontos)} ponto(s), {len(c.regras)} regra(s)")
    else:
        # Instalação nova, ou nuvem fora no primeiro boot. Não é falha: é
        # estado, e o laço resolve sozinho na primeira batida que passar.
        print("\nsem configuração local ainda — vou buscar na nuvem")

    print(f"batendo em {args.nuvem} a cada {args.intervalo:g}s. Ctrl+C para parar.\n")

    auditoria = None
    if not args.sem_auditoria:
        from farol_agent.auditoria import Auditoria

        auditoria = Auditoria(
            cliente, args.fila, intervalo_captura=args.intervalo_captura,
            intervalo_rapido=args.intervalo_rapido,
        )
        if sincronizador.config:
            auditoria.montar(sincronizador.config)
        # Thread própria: um julgamento na nuvem leva segundos, e uma
        # passada inteira pode levar minutos. No mesmo laço do heartbeat,
        # o console veria o agente como CAÍDO enquanto ele trabalhava —
        # o pior diagnóstico possível.
        auditoria.iniciar()
        print(f"auditoria ligada: captura a cada {args.intervalo_captura:g}s")
        if args.intervalo_rapido > 0:
            print(f"vigia: presença e contagem olhadas a cada {args.intervalo_rapido:g}s pelo fluxo menor")

    visor = None
    if args.visor:
        from datetime import datetime

        from farol_agent.visor import Visor

        def _emprestado(ponto_id: str):
            # Canal que a auditoria já mantém aberto: a página usa o quadro
            # dela em vez de abrir uma segunda conexão com o gravador.
            fonte = auditoria.fontes.get(ponto_id) if auditoria is not None else None
            if fonte is None or not getattr(fonte, "url_sub", None):
                return None
            f = fonte.quadro(datetime.now(), stream="sub")
            return (f.ts, f.imagem) if f is not None else None

        visor = Visor(lambda: sincronizador.config, porta=args.visor_porta, emprestado=_emprestado)
        if visor.iniciar():
            print(f"canais no navegador DESTE computador: {visor.endereco}")
        else:
            visor = None

    treino_em_fundo = None
    if not getattr(args, "sem_treino", False):
        from farol_agent.treino_servico import TreinoEmFundo

        # Thread própria, como a auditoria: buscar 30 minutos no gravador leva perto de meia hora.
        treino_em_fundo = TreinoEmFundo(cliente, args.config)
        treino_em_fundo.iniciar()
        print("gravação de treino ligada: lê o que o console pedir, com a loja fechada")

    from farol_agent.bancada_ao_vivo import (
        GUARDAR, INGREDIENTES, PASSOS, VARIAVEL, BancadaAoVivo, canais_ligados, guardar_quadros_ligado,
        ingredientes_ligados, passos_ligados,
    )

    bancada_ao_vivo = None
    base_em_fundo = None
    conferencia_em_fundo = None
    canais_ao_vivo = canais_ligados(os.environ.get(VARIAVEL))
    if canais_ao_vivo:
        # Uma linha de execução por canal, como a auditoria: um quadro por segundo do fluxo principal (A23.2).
        guardar = guardar_quadros_ligado(os.environ.get(GUARDAR))
        passos = passos_ligados(os.environ.get(PASSOS))
        juiz_de = None
        if passos and guardar and ingredientes_ligados(os.environ.get(INGREDIENTES)):
            from farol_agent.base_da_loja import BaseEmFundo
            from farol_agent.juizes.ingrediente import JuizDaLoja

            # A base da loja desce numa linha própria, com a loja fechada; o juiz se monta dela quando os passos pedem.
            base_em_fundo = BaseEmFundo(cliente, args.config)
            base_em_fundo.iniciar()
            juiz_de = JuizDaLoja(Path(os.environ.get("FAROL_MODELOS") or "modelos"), base_em_fundo.base)
            from farol_agent.passos_na_nuvem import VARIAVEL_POR_NOITE, ConferenciaEmFundo, por_noite

            # A noite lida por passos sobe para a conferência (uma amostra por noite), também com a loja fechada.
            n_por_noite = por_noite(os.environ.get(VARIAVEL_POR_NOITE))
            if n_por_noite:
                conferencia_em_fundo = ConferenciaEmFundo(cliente, args.config, canais_ao_vivo, por_noite=n_por_noite)
                conferencia_em_fundo.iniciar()
        bancada_ao_vivo = BancadaAoVivo(
            args.config, canais_ao_vivo, guardar_quadros=guardar, passos=passos, juiz_de=juiz_de,
        )
        bancada_ao_vivo.iniciar()
        print(
            f"bancada ao vivo LIGADA ({VARIAVEL}): canal {', '.join(map(str, canais_ao_vivo))} — "
            "um quadro por segundo, com a loja aberta"
            + (f"; guardando TODOS os quadros ({GUARDAR})" if guardar else "")
            + (f"; com os PASSOS de cada lanche ({PASSOS})" if passos and guardar else "")
            + (f"; os passos ({PASSOS}) pedem também {GUARDAR}: ficam desligados" if passos and not guardar else "")
            + (f"; com o JUIZ DE INGREDIENTE ({INGREDIENTES}): a base da loja desce com a loja fechada"
               if juiz_de is not None else "")
            + (f"; até {conferencia_em_fundo.por_noite} lanches de cada noite sobem para a conferência, com a loja "
               "fechada" if conferencia_em_fundo is not None else "")
        )

    from farol_agent.pipeline.recorte import borrao_ligado

    if not borrao_ligado():
        print("borrão de rosto DESLIGADO neste computador (FAROL_BORRAR_ROSTOS): as imagens saem como vieram")

    try:
        laco(
            sincronizador,
            cliente,
            intervalo=args.intervalo,
            voltas=args.voltas,
            auditoria=auditoria,
        )
    except KeyboardInterrupt:
        print("\n  parado\n")
    finally:
        if bancada_ao_vivo is not None:
            bancada_ao_vivo.parar()
        if conferencia_em_fundo is not None:
            conferencia_em_fundo.parar()
        if base_em_fundo is not None:
            base_em_fundo.parar()
        if treino_em_fundo is not None:
            treino_em_fundo.parar()
        if visor is not None:
            visor.parar()
        if auditoria is not None:
            auditoria.parar()
    return 0


def _forcar_utf8() -> None:
    """O console do Windows usa cp1252 e engasga em acento, régua e emoji.

    O agente roda em PC de loja com Windows, então isto não é conforto: sem
    reconfigurar, qualquer `print` com caractere fora do cp1252 derruba o
    processo com UnicodeEncodeError.
    """
    for fluxo in (sys.stdout, sys.stderr):
        try:
            fluxo.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, OSError):
            pass   # fluxo redirecionado ou já em UTF-8


def main(argv: list[str] | None = None) -> int:
    _forcar_utf8()
    p = argparse.ArgumentParser(prog="farol-agent", description="Agente do Farol")
    sub = p.add_subparsers(dest="comando", required=True)

    s = sub.add_parser("sandbox", help="processa uma pasta de quadros pelo pipeline")
    s.add_argument("pasta", help="pasta com os quadros gravados")
    s.add_argument("--ponto", default="ponto-teste")
    s.add_argument("--zona", help="JSON com o polígono da zona")
    s.add_argument("--saida", default="./saida")
    s.add_argument("--fps", type=float, default=1.0, help="taxa do material de origem")
    s.add_argument("--intervalo", type=float, default=5.0, help="segundos entre análises")
    s.add_argument("--rajada", type=int, default=6)
    s.add_argument("--descartar", type=int, default=2)
    s.add_argument("--lado-maior", type=int, default=640, dest="lado_maior")
    s.add_argument("--jpeg", type=int, default=85)
    s.add_argument("--limiar-dedupe", type=int, default=6, dest="limiar_dedupe")
    s.add_argument("--memoria", type=int, default=30, help="segundos de memória do dedupe")
    s.add_argument("--mascarar", action="store_true", help="escurece fora do polígono")
    s.add_argument("--sem-borrao", dest="borrar_rosto", action="store_false")
    s.set_defaults(func=cmd_sandbox, borrar_rosto=True)

    d = sub.add_parser("sondar", help="mede a qualidade real de uma imagem ou pasta")
    d.add_argument("caminho")
    d.set_defaults(func=cmd_sondar)

    l = sub.add_parser("laco", help="laço completo: gatilho → fila → juiz → alerta")
    l.add_argument("pasta", help="pasta com os quadros gravados")
    l.add_argument("--config", required=True, help="YAML com zonas e regras")
    l.add_argument("--fila", default="./fila.db", help="banco SQLite da fila")
    l.add_argument("--nuvem", action="store_true",
                   help="julga de verdade pela API (CUSTA DINHEIRO)")
    l.add_argument("--fps", type=float, default=1.0, help="taxa do material")
    l.add_argument("--intervalo", type=float, default=30.0,
                   help="segundos entre gatilhos simulados")
    l.add_argument("--rajada", type=int, default=6)
    l.add_argument("--descartar", type=int, default=2)
    l.add_argument("--limite", type=int, default=10,
                   help="itens julgados por passada")
    l.add_argument("--verboso", action="store_true")
    l.set_defaults(func=cmd_laco)

    v = sub.add_parser("dvr", help="fala com o gravador: acha, identifica e ouve eventos")
    v.add_argument("acao",
                   choices=["descobrir", "info", "eventos", "rtsp", "quadro", "canais"])
    v.add_argument("--rede", help="faixa a varrer, ex. 192.168.1.0/24 (padrão: a desta máquina)")
    v.add_argument("--limpar-arp", dest="limpar_arp", action="store_true",
                   help="esvazia o cache ARP antes de varrer (precisa de administrador)")
    v.add_argument("--host", help="IP do gravador")
    v.add_argument("--porta", type=int, default=80)
    v.add_argument("--usuario", default="admin")
    v.add_argument("--canal", type=int, default=1)
    v.add_argument("--sub", action="store_true", help="sub-stream em vez do main")
    v.add_argument("--codigos", default="All", help="ex.: VideoMotion,VideoLoss")
    v.add_argument("--keepalive", type=int, default=20)
    v.add_argument("--limite", type=int, default=0, help="para após N eventos (0 = sem fim)")
    v.add_argument("--verboso", action="store_true", help="mostra cada religação")
    v.add_argument("--rajada", type=int, default=6, help="quantos quadros capturar")
    v.add_argument("--salvar", help="grava o melhor quadro neste arquivo")
    v.add_argument("--ate", type=int, help="último canal a varrer (padrão: todos)")
    v.set_defaults(func=cmd_dvr)

    a = sub.add_parser("analisar",
                       help="análise real: canal do gravador → critério → veredito")
    a.add_argument("--host", required=True, help="IP do gravador")
    a.add_argument("--porta", type=int, default=80)
    a.add_argument("--usuario", default="admin")
    a.add_argument("--canal", type=int, default=1)
    a.add_argument("--sub", action="store_true", help="sub-stream em vez do main")
    a.add_argument("--criterio", required=True,
                   help="a pergunta, em português, do jeito que se falaria a um gerente")
    a.add_argument("--area", help="x1,y1,x2,y2 em fração do quadro (0..1). "
                                  "Sem isto, analisa o quadro inteiro")
    a.add_argument("--largura-cm", type=float, dest="largura_cm",
                   help="quanto a ÁREA cobre no mundo real, em cm — habilita o px/cm")
    a.add_argument("--envio", default="r640", choices=sorted(RESOLUCOES),
                   help="degrau de envio (padrão r640)")
    a.add_argument("--rajada", type=int, default=6, help="quadros capturados por análise")
    a.add_argument("--repetir", type=int, default=1, help="quantas análises seguidas")
    a.add_argument("--intervalo", type=float, default=4.0,
                   help="segundos entre análises, para dar tempo de mexer na cena")
    a.add_argument("--salvar-em", default="./analises", dest="salvar_em",
                   help="pasta onde ficam as imagens ENVIADAS")
    a.add_argument("--simulado", action="store_true",
                   help="não chama a API: prova a cadeia sem gastar")
    a.add_argument("--so-haiku", dest="so_haiku", action="store_true",
                   help="desliga a cascata: nunca reconsulta o modelo forte, "
                        "custo por análise fica travado")
    a.add_argument("--referencia", action="append",
                   help="foto do objeto/padrão correto desta loja; pode repetir")
    a.set_defaults(func=cmd_analisar, so_haiku=False)

    e = sub.add_parser("ensaio",
                       help="rejulga imagens já capturadas: compara modelo e prompt")
    e.add_argument("--pasta", required=True,
                   help="pasta com as imagens (ou uma imagem só)")
    e.add_argument("--criterio", required=True)
    e.add_argument("--modelo", default="haiku", choices=sorted(ENSAIO_MODELOS),
                   help="qual modelo julga (padrão haiku)")
    e.add_argument("--referencia", action="append",
                   help="foto do objeto/padrão correto desta loja; pode repetir")
    e.add_argument("--gabarito",
                   help="JSON {arquivo: resultado} com o que era verdade — habilita "
                        "a acurácia")
    e.set_defaults(func=cmd_ensaio)

    dt = sub.add_parser("detector",
                        help="detector local (presença e contagem): instala o modelo e testa")
    dt.add_argument("acao", choices=["instalar", "olhar", "objetos"])
    dt.add_argument("--pasta",
                    help="onde fica o modelo (padrão: FAROL_MODELOS ou ./modelos)")
    dt.add_argument("--imagem", help="imagem para o detector olhar (ação olhar)")
    dt.add_argument("--objeto", default="pessoa", help="o que procurar (padrão pessoa)")
    dt.add_argument("--minimo", type=int, default=1, help="pelo menos quantos (padrão 1)")
    dt.add_argument("--maximo", type=int, help="no máximo quantos")
    dt.set_defaults(func=cmd_detector)

    ig = sub.add_parser("ingredientes",
                        help="o juiz de ingrediente dos passos do lanche: instala o modelo, desce a base da loja, "
                             "olha uma imagem")
    ig.add_argument("acao", choices=["instalar", "base", "olhar"])
    ig.add_argument("--pasta", help="onde fica o modelo (padrão: FAROL_MODELOS ou ./modelos)")
    ig.add_argument("--config", default="./configuracao.json",
                    help="a configuração do agente: a base da loja fica ao lado (padrão ./configuracao.json)")
    ig.add_argument("--nuvem", help="endereço da API, ex. https://api.monitorfarol.com.br (ação base)")
    ig.add_argument("--imagem", help="imagem para o juiz olhar (ação olhar)")
    ig.set_defaults(func=cmd_ingredientes)

    sv = sub.add_parser("servir",
                        help="roda o agente contra a nuvem: config desce, comandos chegam")
    sv.add_argument("--nuvem", required=True,
                    help="endereço da API, ex. https://api.monitorfarol.com.br")
    sv.add_argument("--config", default="./configuracao.json",
                    help="onde guardar a configuração que desce (padrão ./configuracao.json)")
    sv.add_argument("--intervalo", type=float, default=10.0,
                    help="segundos entre batidas (padrão 10)")
    sv.add_argument("--versao", help="versão do agente, para o console mostrar")
    sv.add_argument("--voltas", type=int,
                    help="para após N batidas (sem isto, roda até Ctrl+C)")
    sv.add_argument("--verboso", action="store_true",
                    help="mostra também o detalhe de cada requisição")
    sv.add_argument("--fila", default="./fila.db",
                    help="banco SQLite da fila de análise (padrão ./fila.db)")
    sv.add_argument("--intervalo-captura", type=float, default=30.0,
                    dest="intervalo_captura",
                    help="segundos entre capturas de cada canal (padrão 30)")
    sv.add_argument("--intervalo-rapido", type=float, default=10.0,
                    dest="intervalo_rapido",
                    help="segundos entre as olhadas do vigia no fluxo menor, para presença "
                         "e contagem (padrão 10; 0 desliga)")
    sv.add_argument("--sem-auditoria", dest="sem_auditoria", action="store_true",
                    help="só sincroniza e atende comandos, sem analisar nada")
    sv.add_argument("--visor", action="store_true",
                    help="abre a página dos canais no navegador DESTE computador (só 127.0.0.1)")
    sv.add_argument("--visor-porta", type=int, default=8765, dest="visor_porta",
                    help="porta da página dos canais (padrão 8765)")
    sv.add_argument("--sem-treino", dest="sem_treino", action="store_true",
                    help="não lê as gravações de treino que o console pedir (o agente também deixa de dizer que sabe)")
    sv.set_defaults(func=cmd_servir, sem_auditoria=False, visor=False, sem_treino=False)

    args = p.parse_args(argv)
    return int(args.func(args))


if __name__ == "__main__":
    sys.exit(main())
